import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { MogsDatabase } from '../db';
import { FactSnapshotSchema, RunSchema, PublicationSchema, type FactSnapshot, type Run, type Patch, type Group, type Page, type Passage, type Publication, type ReviewEvent } from '../types';
import { ConfirmRequestSchema, ApproveRequestSchema, type ConfirmRequest, type ConfirmResponse, type FactsResponse, type RunResponse, type GroupsResponse, type ExportResponse, type ApproveRequest } from '../contracts/api';
import { confirmedFacts } from '../facts/derive';
import { hashRecord, sha256 } from '../hash';
import { parseSource, renderSource, extractRenderedAsset, replaceSourceBlocks } from '../assets/source';
import { discoverScope, crawlScope } from '../crawl';
import { prefilter, classifyPassage, draftPatch, checkPatch, groupDrafts } from '../pipeline';
import { runtimeProviderConfig, judge } from '../providers';
import { emptyStats, assertCanSeal, elapsedFromConfirmation } from './contracts';
import { assertFreshResult, assertPreflight, verificationPass } from '../publication/contracts';

type ErrorCode = 'validation'|'not_found'|'stale'|'busy'|'idempotency_conflict'|'provider_failure'|'runtime_failure'|'interrupted';
export class ServiceError extends Error {
  readonly retryable: boolean;
  constructor(readonly code: ErrorCode, message: string, readonly status = 409, readonly recordId?: string, readonly currentRevision?: number) {
    super(message); this.retryable = code === 'busy' || code === 'provider_failure' || code === 'interrupted';
  }
}
export function durableWrite(file: string, text: string): void {
  mkdirSync(path.dirname(file), {recursive:true});
  const temp = file+'.'+randomUUID()+'.tmp';
  const fd = openSync(temp, 'wx');
  try { writeFileSync(fd, text, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, file);
  const parent = openSync(path.dirname(file), 'r');
  try { fsyncSync(parent); } finally { closeSync(parent); }
}
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } }
interface Options {
  databasePath?: string; contentRoot?: string; factsPath?: string; runtimeRoot?: string; baseUrl?: string;
  mode?: 'live'|'eval'; actor?: 'human'|'test';
  // Fault injection is available only to an isolated test service.
  beforeReplace?: (index: number, file: string) => void;
  testDependencies?: { discover: typeof discoverScope; crawl: typeof crawlScope; classify: typeof classifyPassage; draft: typeof draftPatch; check: typeof checkPatch; judge: typeof judge };
}
interface ConfirmJournal { before: FactSnapshot; after: FactSnapshot; runId: string; beforeSource: string; afterSource: string }
export class MogsCoordinator {
  readonly databasePath: string; readonly contentRoot: string; readonly factsPath: string; readonly runtimeRoot: string; readonly baseUrl: string;
  private recovering: Promise<void>|null = null;
  private processing = new Map<string, Promise<void>>();
  private mutation = false;
  constructor(private options: Options = {}) {
    this.databasePath = path.resolve(options.databasePath ?? process.env.MOGS_DATABASE_PATH ?? 'data/app.db');
    this.contentRoot = path.resolve(options.contentRoot ?? process.env.MOGS_CONTENT_ROOT ?? 'content');
    this.factsPath = path.resolve(options.factsPath ?? process.env.MOGS_FACTS_PATH ?? 'data/facts.json');
    this.runtimeRoot = path.resolve(options.runtimeRoot ?? path.dirname(this.databasePath));
    this.baseUrl = options.baseUrl ?? process.env.MOGS_BASE_URL ?? 'http://localhost:3000';
    if (options.actor === 'test' && (!options.databasePath || !options.contentRoot || !options.factsPath || options.mode !== 'eval')) throw new Error('Test approval requires explicitly isolated evaluation paths.');
    if (options.actor === 'test' && (this.databasePath === path.resolve('data/app.db') || this.contentRoot === path.resolve('content') || this.factsPath === path.resolve('data/facts.json'))) throw new Error('Test approval cannot use live demo paths.');
    if ((options.testDependencies || options.beforeReplace) && options.actor !== 'test') throw new Error('Fault injection requires an isolated test service.');
  }
  private db<T>(fn: (db:MogsDatabase)=>T): T {
    const readers=path.join(this.runtimeRoot,'readers');mkdirSync(readers,{recursive:true});const lease=path.join(readers,randomUUID()+'.json');writeFileSync(lease,JSON.stringify({pid:process.pid}),{flag:'wx'});
    let db:MogsDatabase|undefined;
    try{
      if(existsSync(this.lockPath())){const lock=JSON.parse(readFileSync(this.lockPath(),'utf8')) as {pid:number;operation:string};if(lock.operation==='reset'&&alive(lock.pid))throw new ServiceError('busy','The live state is being reset.');}
      db=new MogsDatabase(this.databasePath);return db.transaction(()=>fn(db!));
    }finally{db?.close();unlinkSync(lease);}
  }
  private currentFacts(): FactSnapshot { return FactSnapshotSchema.parse(JSON.parse(readFileSync(this.factsPath,'utf8'))); }
  private lockPath(): string { return path.join(this.runtimeRoot,'runtime.lock'); }
  private journalPath(): string { return path.join(this.runtimeRoot,'confirm-journal.json'); }
  private processingPath():string {return path.join(this.runtimeRoot,'processing.json');}
  private owner():{pid:number;runId:string;status:'scheduled'|'running'}|null {return existsSync(this.processingPath())?JSON.parse(readFileSync(this.processingPath(),'utf8')):null;}
  private activeOwner(runId:string):boolean {const owner=this.owner();return owner!==null&&owner.runId===runId&&alive(owner.pid);}
  private async locked<T>(operation:'confirm'|'publish', fn:()=>Promise<T>): Promise<T> {
    if (this.mutation) throw new ServiceError('busy','Another mutation is in progress.');
    mkdirSync(this.runtimeRoot,{recursive:true});
    const file = this.lockPath();
    if (existsSync(file)) {
      const lock = JSON.parse(readFileSync(file,'utf8')) as {pid:number};
      if (alive(lock.pid)) throw new ServiceError('busy','The runtime is handling another mutation.');
      unlinkSync(file);
    }
    const fd = openSync(file,'wx');
    try { writeFileSync(fd,JSON.stringify({pid:process.pid,operation,startedAt:new Date().toISOString()})); fsyncSync(fd); } finally { closeSync(fd); }
    this.mutation = true;
    try { return await fn(); } finally { this.mutation=false; unlinkSync(file); }
  }
  private requireRun(db:MogsDatabase,id:string):Run { const run=db.getRun(id); if (!run) throw new ServiceError('not_found','Run not found.',404,id); return run; }
  private event(db:MogsDatabase,runId:string,groupId:string|null,patchId:string|null,action:ReviewEvent['action'],detail:string,actor:ReviewEvent['actor']='system',at=new Date().toISOString()):void {
    db.addReviewEvent({id:randomUUID(),runId,groupId,patchId,action,actor,detail,at});
  }
  private updateStats(db:MogsDatabase,run:Run):void {
    const patches=db.patches(run.id), publications=db.publications(run.id), events=db.reviewEvents(run.id);
    run.stats.published=patches.filter(p=>['published','verified','failed_verify'].includes(p.status)).length;
    run.stats.verified=patches.filter(p=>p.status==='verified').length;
    run.stats.reviewActions=db.reviewActionCount(run.id);
    const open=events.filter(e=>e.actor==='human'&&e.action==='open').sort((a,b)=>a.at.localeCompare(b.at))[0];
    const approval=events.filter(e=>e.actor==='human'&&e.action==='approve').sort((a,b)=>b.at.localeCompare(a.at))[0];
    run.stats.humanMs=open&&approval?Math.max(0,Date.parse(approval.at)-Date.parse(open.at)):0;
    run.stats.machineMs=(run.stats.allResultsReadyMs??0)+publications.reduce((sum,p)=>sum+Math.max(0,Date.parse(p.updatedAt)-Date.parse(p.createdAt)),0);
    run.updatedAt=new Date().toISOString(); db.putRun(run);
  }
  async recover(): Promise<void> {
    if (this.recovering) return this.recovering;
    this.recovering=this.locked('publish',async()=>{
      const journal=this.journalPath();
      if (existsSync(journal)) {
        const j=JSON.parse(readFileSync(journal,'utf8')) as ConfirmJournal;
        const actual=readFileSync(this.factsPath,'utf8');
        if (![sha256(j.beforeSource),sha256(j.afterSource)].includes(sha256(actual))) throw new ServiceError('interrupted','Confirmation recovery found an unexplained facts edit.',503);
        const committed=this.db(db=>db.getRun(j.runId));
        durableWrite(this.factsPath,committed?j.afterSource:j.beforeSource); unlinkSync(journal);
      }
      const run=this.db(db=>db.latestRun(this.options.mode??'live'));
      if (!run) return;
      for (const pub of this.db(db=>db.publications(run.id))) {
        if (['prepared','writing','recovering','blocked'].includes(pub.status)) await this.restore(pub,'Publication was interrupted; restored its recorded before images.');
        else if (pub.status==='published') {
          pub.status='failed_verify'; pub.failure='Verification was interrupted after publication.'; pub.updatedAt=new Date().toISOString();
          this.db(db=>{ db.putPublication(pub); const group=db.getGroup(run.id,pub.groupId)!; group.status='failed_verify';db.putGroup(group); for(const id of pub.approvedMemberIds){const p=db.getPatch(run.id,id)!;p.status='failed_verify';db.putPatch(p);} });
        }
      }
      this.db(db=>{const current=this.requireRun(db,run.id); if(['collecting','classifying','drafting'].includes(current.status)&&!this.activeOwner(run.id)){current.status='failed';current.errors.push({code:'interrupted',message:'Processing stopped when the runtime restarted. Reset before a new live run.'});}this.updateStats(db,current);});
    }).catch(error=>{this.recovering=null;throw error;});
    return this.recovering;
  }
  async facts():Promise<FactsResponse> { await this.recover(); return {facts:this.currentFacts(),runId:this.db(db=>db.latestRun(this.options.mode??'live')?.id??null)}; }
  async run(id:string):Promise<RunResponse> {await this.recover();return this.db(db=>({run:this.requireRun(db,id),groups:db.groups(id),publications:db.publications(id)}));}
  async groups(id:string):Promise<GroupsResponse> {await this.recover();return this.db(db=>{this.requireRun(db,id);return{runId:id,groups:db.groups(id),patches:db.patches(id),publications:db.publications(id)};});}
  async exportRun(id:string):Promise<ExportResponse> {await this.recover();return this.db(db=>({run:this.requireRun(db,id),pages:db.pages(id),passages:db.passages(id),judgments:db.judgments(id),groups:db.groups(id),patches:db.patches(id),publications:db.publications(id),reviewEvents:db.reviewEvents(id)}));}
  async confirm(input:ConfirmRequest):Promise<ConfirmResponse> {
    const request=ConfirmRequestSchema.parse(input); await this.recover();
    return this.locked('confirm',async()=>{
      const fingerprint=hashRecord(request);
      let replay:unknown;
      try {replay=this.db(db=>db.replay('confirm',request.idempotencyKey,fingerprint));} catch {throw new ServiceError('idempotency_conflict','This confirmation key was used with a different request.');}
      if(replay) return replay as ConfirmResponse;
      const beforeSource=readFileSync(this.factsPath,'utf8'),before=FactSnapshotSchema.parse(JSON.parse(beforeSource));
      const existing=this.db(db=>db.latestRun(this.options.mode??'live'));
      if(existing){if(existing.changeId!==request.changeId)throw new ServiceError('busy','A live change already exists.');if(request.expectedFactVersion!==existing.factVersion-1)throw new ServiceError('stale','Confirmation must refer to the original facts version.');const response={changeId:existing.changeId,factVersion:existing.factVersion,confirmedAt:existing.confirmedAt,runId:existing.id};this.db(db=>db.remember('confirm',request.idempotencyKey,fingerprint,response,existing.confirmedAt));return response;}
      if(before.phase!=='initial'||before.version!==request.expectedFactVersion||before.change.id!==request.changeId)throw new ServiceError('stale','The displayed facts are no longer the current initial facts.');
      const confirmedAt=new Date().toISOString();
      const scope=await (this.options.testDependencies?.discover??discoverScope)(this.baseUrl);
      if(scope.pages.length!==3||scope.pages.filter(p=>p.surface==='web').length!==1||scope.pages.filter(p=>p.surface==='email').length!==2)throw new ServiceError('validation','Gate 1 requires exactly one editable web page and two paired emails.',400);
      const after=confirmedFacts(before),afterSource=JSON.stringify(after,null,2)+'\n';
      const run=RunSchema.parse({id:randomUUID(),changeId:after.change.id,factVersion:after.version,mode:this.options.mode??'live',scope:{assetIds:scope.pages.map(p=>p.assetId),urls:scope.pages.map(p=>p.url),corpusHash:hashRecord(scope.pages.map(p=>[p.assetId,p.sourceHash]))},config:runtimeProviderConfig(),confirmedAt,status:'collecting',stats:emptyStats(),errors:[],updatedAt:confirmedAt});
      const response={changeId:run.changeId,factVersion:run.factVersion,confirmedAt,runId:run.id};
      durableWrite(this.journalPath(),JSON.stringify({before,after,runId:run.id,beforeSource,afterSource} satisfies ConfirmJournal));
      try {
        durableWrite(this.processingPath(),JSON.stringify({pid:process.pid,runId:run.id,status:'scheduled',startedAt:confirmedAt}));
        durableWrite(this.factsPath,afterSource);
        this.db(db=>db.transaction(()=>{db.putFacts(before);db.putFacts(after);db.putRun(run);for(const page of scope.pages)db.putPage(run.id,page);for(const p of scope.passages)db.putPassage(run.id,p);db.remember('confirm',request.idempotencyKey,fingerprint,response,confirmedAt);}));
      }catch(error){if(!this.db(db=>db.getRun(run.id))){durableWrite(this.factsPath,beforeSource);if(existsSync(this.processingPath()))unlinkSync(this.processingPath());}throw error;}
      unlinkSync(this.journalPath());return response;
    });
  }
  async processRun(id:string):Promise<void> {
    await this.recover();const existing=this.processing.get(id);if(existing)return existing;
    const owner=this.owner();if(this.activeOwner(id)&&!(owner?.pid===process.pid&&owner.status==='scheduled'))return;
    if(this.db(db=>this.requireRun(db,id)).status!=='collecting')return;
    durableWrite(this.processingPath(),JSON.stringify({pid:process.pid,runId:id,status:'running',startedAt:new Date().toISOString()}));
    const task=this.process(id).finally(()=>{this.processing.delete(id);if(existsSync(this.processingPath()))unlinkSync(this.processingPath());});this.processing.set(id,task);return task;
  }
  private async process(id:string):Promise<void> {
    let run=this.db(db=>this.requireRun(db,id));if(run.status!=='collecting')return;
    try{
      if(hashRecord(runtimeProviderConfig())!==hashRecord(run.config))throw new Error('Provider configuration changed after confirmation.');
      const before=this.db(db=>db.getFacts(run.factVersion-1))!,after=this.db(db=>db.getFacts(run.factVersion))!;
      const pages=this.db(db=>db.pages(id)),passages=this.db(db=>db.passages(id));
      run.status='classifying';run.stats.assetsIndexed=pages.length;run.stats.passagesIndexed=passages.length;
      for(const page of pages)run.stats.bySurface[page.surface].assets++;
      for(const p of passages)run.stats.bySurface[p.surface].passages++;
      const candidates=passages.filter(prefilter);run.stats.candidates=candidates.length;run.updatedAt=new Date().toISOString();this.db(db=>db.putRun(run));
      const outcomes=await mapLimit(candidates,run.config.concurrency,async p=>{
        const page=pages.find(page=>page.assetId===p.assetId)!;
        try{if(elapsedFromConfirmation(run,new Date().toISOString())>180_000)throw new ServiceError('provider_failure','The bounded run deadline was exceeded.',502);const j=await (this.options.testDependencies?.classify??classifyPassage)(id,p,page,before,after);this.db(db=>{db.putJudgment(j);const r=this.requireRun(db,id);r.stats.judged++;r.stats.byLabel[j.label]++;if(j.label==='contradicting')r.stats.bySurface[p.surface].contradictions++;r.updatedAt=new Date().toISOString();db.putRun(r);});return{p,page,j};}
        catch(error){this.db(db=>{const r=this.requireRun(db,id);r.errors.push({code:'provider_failure',message:safeMessage(error),passageId:p.id});db.putRun(r);});return null;}
      });
      run=this.db(db=>this.requireRun(db,id));if(run.errors.length)throw new Error('At least one classification failed; complete groups cannot be sealed.');
      run.status='drafting';run.updatedAt=new Date().toISOString();this.db(db=>db.putRun(run));
      const drafts=await mapLimit(outcomes.filter(o=>o!==null),run.config.concurrency,async outcome=>{
        const {p,page,j}=outcome;
        try{if(elapsedFromConfirmation(run,new Date().toISOString())>180_000)throw new ServiceError('provider_failure','The bounded run deadline was exceeded.',502);const patch=await (this.options.testDependencies?.draft??draftPatch)(id,p,page,j,before,after);if(!patch)return null;
          if(patch.status==='drafted'){patch.checks=await (this.options.testDependencies?.check??checkPatch)(patch,p,page,before,after,this.contentRoot);const current=this.source(page);if(current.page.sourceHash!==page.sourceHash){patch.checks=patch.checks.map(c=>c.name==='source_fresh'?{...c,pass:false,detail:'Source changed while an asynchronous draft/check was pending.'}:c);}const failed=patch.checks.filter(c=>!c.pass);if(failed.length){patch.status='withheld';patch.withholdReason=failed.map(c=>c.name+': '+c.detail).join('; ');}}
          this.db(db=>{db.putPatch(patch);const r=this.requireRun(db,id);if(patch.checks.some(c=>c.name==='rejudge_consistent'&&c.detail.startsWith('Replacement rejudge failed:')))r.errors.push({code:'provider_failure',message:'Replacement rejudge provider failed.',passageId:p.id});if(patch.checks.some(c=>c.name==='source_fresh'&&!c.pass))r.errors.push({code:'stale',message:'Source changed while drafting/checking.',passageId:p.id});if(patch.status==='drafted'){r.stats.patchesDrafted++;r.stats.bySurface[patch.surface].patches++;}else r.stats.withheld++;r.updatedAt=new Date().toISOString();db.putRun(r);});return patch;
        }catch(error){this.db(db=>{const r=this.requireRun(db,id);r.errors.push({code:'provider_failure',message:safeMessage(error),passageId:p.id});db.putRun(r);});return null;}
      });
      run=this.db(db=>this.requireRun(db,id));if(run.errors.length)throw new Error('Drafting/checking failed; full membership cannot be sealed.');
      if(elapsedFromConfirmation(run,new Date().toISOString())>180_000)throw new Error('The bounded run deadline was exceeded.');
      const patches=drafts.filter(p=>p!==null),groups=groupDrafts(run,patches),classifiedAssetIds=pages.map(p=>p.assetId);
      for(const group of groups){
        const members=patches.filter(p=>group.memberIds.includes(p.id)).map(p=>({...p,groupId:group.id}));
        if(group.eligibleIds.length){assertCanSeal(run,group,members,classifiedAssetIds,members.map(p=>p.id));group.status='sealed';group.sealedAt=new Date().toISOString();if(run.stats.firstSealedGroupMs===null)run.stats.firstSealedGroupMs=elapsedFromConfirmation(run,group.sealedAt);}else group.status='blocked';
        this.db(db=>db.transaction(()=>{db.putGroup(group);for(const p of members)db.putPatch(p);db.bindMembers(group);}));
      }
      run.stats.groups=groups.length;run.stats.allResultsReadyMs=elapsedFromConfirmation(run,new Date().toISOString());run.stats.machineMs=run.stats.allResultsReadyMs;run.status='ready';run.updatedAt=new Date().toISOString();this.db(db=>db.putRun(run));
    }catch(error){this.db(db=>{const r=this.requireRun(db,id);r.status='failed';r.errors.push({code:'runtime_failure',message:safeMessage(error)});r.updatedAt=new Date().toISOString();db.putRun(r);});}
  }
  async openGroup(groupId:string,runId:string):Promise<{openedAt:string}>{await this.recover();return this.db(db=>{this.requireRun(db,runId);const group=db.getGroup(runId,groupId);if(!group)throw new ServiceError('not_found','Group not found.',404,groupId);const prior=db.reviewEvents(runId).find(e=>e.groupId===groupId&&e.action==='open'&&e.actor===(this.options.actor??'human'));if(prior)return{openedAt:prior.at};this.event(db,runId,groupId,null,'open','Reviewer opened the complete correction group.',this.options.actor??'human');return{openedAt:db.reviewEvents(runId).at(-1)!.at};});}
  private source(page:Page):{page:Page;passages:Passage[];source:string}{
    if(!page.file)throw new ServiceError('stale','The asset has no editable source file.');
    const file=path.resolve(this.contentRoot,page.file);if(!file.startsWith(this.contentRoot+path.sep))throw new ServiceError('stale','Invalid source path.');
    const source=readFileSync(file,'utf8'),asset=parseSource(source,page.file,page.surface);
    return{...extractRenderedAsset(renderSource(asset),page.url),source};
  }
  private chain(db:MogsDatabase,patch:Patch,currentHash:string):{beforeFileHash:string;afterFileHash:string}[]{
    if(patch.expectedFileHash===currentHash)return[];
    const revisions=db.publications(patch.runId).filter(pub=>['published','verified','failed_verify'].includes(pub.status)).flatMap(pub=>pub.files.filter(f=>f.file===db.pages(patch.runId).find(p=>p.assetId===patch.assetId)?.file));
    const chain:{beforeFileHash:string;afterFileHash:string}[]=[];let expected=patch.expectedFileHash;
    for(const r of revisions)if(r.beforeHash===expected){chain.push({beforeFileHash:r.beforeHash,afterFileHash:r.afterHash});expected=r.afterHash;if(expected===currentHash)return chain;}
    throw new ServiceError('stale','Source changed outside a recorded application publication.',409,patch.id);
  }
  private async refresh(patch:Patch, page:Page, before:FactSnapshot, after:FactSnapshot):Promise<Patch>{
    const current=this.source(page),p=current.passages.find(p=>p.id===patch.passageId);if(!p||p.text!==patch.original)throw new ServiceError('stale','Source block missing or changed.',409,patch.id);
    const chain=this.db(db=>this.chain(db,patch,current.page.sourceHash));
    assertFreshResult({fileHash:patch.expectedFileHash,blockHash:patch.expectedBlockHash,contextHash:patch.expectedContextHash,metadataHash:patch.expectedMetadataHash},{fileHash:current.page.sourceHash,blockHash:p.blockHash,contextHash:p.contextHash,metadataHash:current.page.metadataHash},chain);
    const advanced=patch.expectedFileHash!==current.page.sourceHash||patch.expectedContextHash!==p.contextHash;
    const refreshed={...patch,expectedFileHash:current.page.sourceHash,expectedContextHash:p.contextHash};
    refreshed.checks=await (this.options.testDependencies?.check??checkPatch)(refreshed,p,current.page,before,after,this.contentRoot);
    const latest=this.source(page);if(latest.page.sourceHash!==current.page.sourceHash)throw new ServiceError('stale','Source changed while an asynchronous recheck was pending.',409,patch.id);
    if(refreshed.checks.some(c=>!c.pass))throw new ServiceError('stale','A blocking check failed: '+refreshed.checks.filter(c=>!c.pass).map(c=>c.name).join(', '),409,patch.id);
    if(advanced)refreshed.revision++;return refreshed;
  }
  async approve(groupId:string,input:ApproveRequest):Promise<Publication>{
    const request=ApproveRequestSchema.parse(input);await this.recover();
    return this.locked('publish',async()=>{
      const fingerprint=hashRecord({groupId,...request});
      let replay:unknown;try{replay=this.db(db=>db.replay('approve',request.idempotencyKey,fingerprint));}catch{throw new ServiceError('idempotency_conflict','This approval key was used with a different request.');}
      if(replay){const prior=replay as {publicationId:string};return this.db(db=>db.publications(request.runId).find(p=>p.id===prior.publicationId)!);}
      let run=this.db(db=>this.requireRun(db,request.runId));const group=this.db(db=>db.getGroup(run.id,groupId));if(!group)throw new ServiceError('not_found','Group not found in this run.',404,groupId);
      const prior=this.db(db=>db.publications(run.id).find(p=>p.groupId===groupId));if(prior)return prior;
      if(group.revision!==request.expectedRevision)throw new ServiceError('stale','Group revision changed. Refresh the review before approving.',409,groupId,group.revision);
      const approvalRequestedAt=new Date().toISOString();
      const before=this.db(db=>db.getFacts(run.factVersion-1))!,after=this.db(db=>db.getFacts(run.factVersion))!;
      if(hashRecord(this.currentFacts())!==hashRecord(after))throw new ServiceError('stale','Current facts changed after this run.');
      if(hashRecord(runtimeProviderConfig())!==hashRecord(run.config))throw new ServiceError('stale','Provider configuration changed after this run.');
      const all=this.db(db=>db.patches(run.id)),pages=this.db(db=>db.pages(run.id));assertPreflight(run,group,all.filter(p=>p.groupId===groupId));
      let eligible:Patch[];
      try{eligible=await mapLimit(all.filter(p=>group.eligibleIds.includes(p.id)),run.config.concurrency,p=>this.refresh(p,pages.find(page=>page.assetId===p.assetId)!,before,after));}
      catch(error){group.status='blocked';this.db(db=>db.putGroup(group));throw error;}
      // Any refreshed baseline changes require another review of the displayed revision.
      if(eligible.some(p=>p.revision!==all.find(old=>old.id===p.id)!.revision)){
        group.revision++;this.db(db=>{for(const p of eligible)db.putPatch(p);db.putGroup(group);this.event(db,run.id,group.id,null,'revision_advance','Application source revision revalidated; refresh review.');});
        throw new ServiceError('stale','The group was revalidated against a newer application revision. Review its updated revision.',409,group.id,group.revision);
      }
      const files:Publication['files']=[];
      for(const assetId of new Set(eligible.map(p=>p.assetId))){const page=pages.find(p=>p.assetId===assetId)!,current=this.source(page),members=eligible.filter(p=>p.assetId===assetId);if(members.some(p=>p.expectedFileHash!==current.page.sourceHash))throw new ServiceError('stale','A source changed during preflight.');const source=replaceSourceBlocks(parseSource(current.source,page.file!,page.surface),members.map(p=>({sourceId:p.sourceId,original:p.original,replacement:p.replacement!})),current.page.sourceHash);files.push({file:page.file!,beforeHash:current.page.sourceHash,afterHash:sha256(source),beforeSource:current.source,afterSource:source,state:'staged'});}
      const at=new Date().toISOString(),pub=PublicationSchema.parse({id:randomUUID(),runId:run.id,groupId:group.id,factVersion:run.factVersion,idempotencyKey:request.idempotencyKey,requestFingerprint:fingerprint,approvedRevision:group.revision,approvedMemberIds:group.eligibleIds,actor:this.options.actor??'human',status:'prepared',files,verification:[],createdAt:approvalRequestedAt,updatedAt:at,failure:null});
      this.db(db=>db.transaction(()=>{db.putPublication(pub);db.remember('approve',request.idempotencyKey,fingerprint,{publicationId:pub.id},at);group.status='publishing';group.publicationId=pub.id;db.putGroup(group);this.event(db,run.id,group.id,null,'approve','Approved complete revision '+group.revision,pub.actor,approvalRequestedAt);}));
      try{
        pub.status='writing';this.db(db=>db.putPublication(pub));
        for(const [index,file] of pub.files.entries()){
          const absolute=path.resolve(this.contentRoot,file.file);if(sha256(readFileSync(absolute))!==file.beforeHash)throw new Error('File changed after staging.');
          if(this.options.actor==='test')this.options.beforeReplace?.(index,absolute);
          durableWrite(absolute,file.afterSource);file.state='replaced';pub.updatedAt=new Date().toISOString();this.db(db=>db.putPublication(pub));
        }
        pub.status='published';pub.updatedAt=new Date().toISOString();group.status='published';this.db(db=>db.transaction(()=>{db.putPublication(pub);db.putGroup(group);for(const p of eligible){p.status='published';db.putPatch(p);}this.updateStats(db,run);}));
      }catch(error){await this.restore(pub,'Publication write failed: '+safeMessage(error));return this.db(db=>db.publications(run.id).find(p=>p.id===pub.id)!);}
      await this.revalidatePending(run,pub,pages,before,after);
      pub.verification=await mapLimit(eligible,run.config.concurrency,async patch=>{
        let sourceObserved=false,observedHash:string|null=null,judgment=null;
        try{const fresh=await (this.options.testDependencies?.crawl??crawlScope)([patch.url]),p=fresh.passages.find(p=>p.id===patch.passageId),page=fresh.pages.find(p=>p.assetId===patch.assetId);sourceObserved=Boolean(p&&page&&p.text===patch.replacement&&page.sourceHash===pub.files.find(f=>f.file===page.file)?.afterHash);observedHash=p?.blockHash??null;if(!p||!page)throw new Error('Source ID missing in served asset.');judgment=await (this.options.testDependencies?.judge??judge)(run.id,p,page,before,after);const pass=verificationPass(sourceObserved,judgment,run.config.tLabel,{runId:run.id,passageId:patch.passageId,factVersion:run.factVersion,adapter:run.config.adapter!,model:run.config.judgeModel});return{passageId:patch.passageId,url:patch.url,sourceObserved,observedHash,judgment,pass,detail:pass?'Exact served replacement and fresh model judgment passed.':'Served observation or model judgment failed.',checkedAt:new Date().toISOString()};}
        catch(error){return{passageId:patch.passageId,url:patch.url,sourceObserved,observedHash,judgment,pass:false,detail:safeMessage(error),checkedAt:new Date().toISOString()};}
      });
      const verified=pub.verification.every(v=>v.pass);pub.status=verified?'verified':'failed_verify';pub.failure=verified?null:'At least one served verification failed.';pub.updatedAt=new Date().toISOString();group.status=verified?'verified':'failed_verify';
      this.db(db=>db.transaction(()=>{db.putPublication(pub);db.putGroup(group);for(const p of eligible){p.status=pub.verification.find(v=>v.passageId===p.passageId)?.pass?'verified':'failed_verify';db.putPatch(p);}this.event(db,run.id,group.id,null,'verify',pub.failure??'Every approved patch passed served verification.');run=this.requireRun(db,run.id);this.updateStats(db,run);}));return pub;
    });
  }
  private async revalidatePending(run:Run,pub:Publication,pages:Page[],before:FactSnapshot,after:FactSnapshot):Promise<void>{
    const pending=this.db(db=>db.patches(run.id).filter(p=>p.status==='drafted'&&p.groupId!==pub.groupId&&pub.files.some(f=>f.file===pages.find(page=>page.assetId===p.assetId)?.file)));
    const affected=new Set<string>();
    await mapLimit(pending,run.config.concurrency,async patch=>{try{const refreshed=await this.refresh(patch,pages.find(page=>page.assetId===patch.assetId)!,before,after);this.db(db=>{db.putPatch(refreshed);this.event(db,run.id,patch.groupId,patch.id,'revision_advance','Recorded application publication chain and refreshed context checks passed.');});}catch(error){patch.status='stale';patch.revision++;patch.withholdReason=safeMessage(error);this.db(db=>db.putPatch(patch));}if(patch.groupId)affected.add(patch.groupId);});
    this.db(db=>{for(const id of affected){const g=db.getGroup(run.id,id)!;g.revision++;if(db.patches(run.id).some(p=>g.eligibleIds.includes(p.id)&&p.status!=='drafted'))g.status='blocked';db.putGroup(g);}});
  }
  private async restore(pub:Publication,reason:string):Promise<void>{
    pub.status='recovering';pub.updatedAt=new Date().toISOString();this.db(db=>db.putPublication(pub));
    try{
      for(const f of pub.files){const file=path.resolve(this.contentRoot,f.file);if(!file.startsWith(this.contentRoot+path.sep))throw new Error('Invalid journal path.');const actual=sha256(readFileSync(file));if(actual!==f.beforeHash&&actual!==f.afterHash)throw new Error('Recovery found an unexplained edit: '+f.file);if(actual===f.afterHash)durableWrite(file,f.beforeSource);f.state='restored';}
      pub.status='recovered';pub.failure=reason;
    }catch(error){pub.status='blocked';pub.failure=reason+' Recovery blocked: '+safeMessage(error);}
    pub.updatedAt=new Date().toISOString();this.db(db=>db.transaction(()=>{db.putPublication(pub);const g=db.getGroup(pub.runId,pub.groupId)!;g.status=pub.status==='blocked'?'blocked':'failed_publish';db.putGroup(g);this.event(db,pub.runId,pub.groupId,null,'recover',pub.failure!);const run=this.requireRun(db,pub.runId);this.updateStats(db,run);}));
    if(pub.status==='blocked')throw new ServiceError('interrupted',pub.failure!,503,pub.id);
  }
}
export async function mapLimit<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>):Promise<R[]>{const results:R[]=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;results[i]=await fn(items[i]);}}));return results;}
function safeMessage(error:unknown):string {return error instanceof ServiceError?error.message:error instanceof Error?error.name+': '+error.message.slice(0,500):'Unexpected runtime failure.';}
const shared=globalThis as typeof globalThis&{__mogsCoordinator?:MogsCoordinator};
function service():MogsCoordinator{return shared.__mogsCoordinator??=new MogsCoordinator();}
export const confirm=(request:ConfirmRequest)=>service().confirm(request);
export const processRun=(runId:string)=>service().processRun(runId);
export const approve=(groupId:string,request:ApproveRequest)=>service().approve(groupId,request);
export const openGroup=(groupId:string,runId:string)=>service().openGroup(groupId,runId);
export const facts=()=>service().facts();
export const run=(runId:string)=>service().run(runId);
export const groups=(runId:string)=>service().groups(runId);
export const exportRun=(runId:string)=>service().exportRun(runId);
