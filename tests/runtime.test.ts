import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MogsCoordinator, ServiceError, durableWrite } from '../lib/runs/service';
import { MogsDatabase } from '../lib/db';
import { parseSource, renderSource, extractRenderedAsset, replaceSourceBlocks } from '../lib/assets/source';
import { initialFacts } from '../lib/facts/derive';
import { hashRecord, sha256 } from '../lib/hash';
import { CheckNameSchema, type Judgment, type ManifestRow, type Patch, type Publication } from '../lib/types';

function sandbox(fault?: (index:number,file:string)=>void){
  const root=mkdtempSync(path.join(tmpdir(),'mogs-runtime-')),contentRoot=path.join(root,'content'),databasePath=path.join(root,'data/app.db'),factsPath=path.join(root,'data/facts.json');
  const seed=JSON.parse(readFileSync('content/seed.json','utf8')) as {sources:Record<string,{source:string}>};
  for(const [file,item] of Object.entries(seed.sources)){mkdirSync(path.dirname(path.join(contentRoot,file)),{recursive:true});writeFileSync(path.join(contentRoot,file),item.source);}
  mkdirSync(path.dirname(factsPath),{recursive:true});writeFileSync(factsPath,JSON.stringify(initialFacts(),null,2)+'\n');
  const manifest=readFileSync('content/manifest.jsonl','utf8').trim().split('\n').map(line=>JSON.parse(line) as ManifestRow);
  const read=(urls?:string[])=>{const assets=Object.keys(seed.sources).map(file=>{const surface=file.startsWith('site/')?'web':'email',url='http://localhost:3000'+(surface==='web'?'/':'/assets/')+file.slice(0,-3);return extractRenderedAsset(renderSource(parseSource(readFileSync(path.join(contentRoot,file),'utf8'),file,surface)),url);}).filter(a=>!urls||urls.includes(a.page.url));return{pages:assets.map(a=>a.page),passages:assets.flatMap(a=>a.passages)};};
  let checkCalls=0;
  const options={databasePath,contentRoot,factsPath,runtimeRoot:path.dirname(databasePath),mode:'eval' as const,actor:'test' as const,beforeReplace:fault,testDependencies:{
    discover:async()=>read(),crawl:async(urls:string[])=>read(urls),
    classify:async(runId,p,_page,_before,after)=>{const row=manifest.find(m=>m.passageId===p.id)!;return{runId,passageId:p.id,factVersion:after.version,relevant:1,kind:row.kind,audience:'new_customers',billing:'monthly',label:row.expectedLabel,confidence:null,probabilities:null,confidenceSource:'unavailable',adapter:'frontier',model:'claude-sonnet-5-5',escalatedBy:null} satisfies Judgment;},
    draft:async(runId,p,page,j,_before,after)=>{if(j.label!=='contradicting')return null;const row=manifest.find(m=>m.passageId===p.id)!;return{id:randomUUID(),runId,passageId:p.id,sourceId:p.sourceId,assetId:p.assetId,url:p.url,surface:p.surface,factVersion:after.version,kind:row.kind,target:row.target,original:p.text,replacement:row.expectedReplacement,rationale:'Deterministic test fixture.',withholdReason:row.expectedReplacement?null:'No deterministic replacement.',originalCapturedFileHash:page.sourceHash,expectedFileHash:page.sourceHash,expectedBlockHash:p.blockHash,expectedContextHash:p.contextHash,expectedMetadataHash:page.metadataHash,checks:[],revision:0,status:row.expectedReplacement?'drafted':'withheld',groupId:null,editedByHuman:false} satisfies Patch;},
    check:async(patch,p,page)=>{checkCalls++;return CheckNameSchema.options.filter(n=>n!=='tokens_kept'||patch.surface==='email').map(name=>({name,pass:p.text===patch.original&&p.blockHash===patch.expectedBlockHash&&p.contextHash===patch.expectedContextHash&&page.sourceHash===patch.expectedFileHash,detail:'Isolated fixture check.'}));},
    judge:async(runId,p,_page,_before,after)=>({runId,passageId:p.id,factVersion:after.version,relevant:1,kind:'direct_price',audience:'new_customers',billing:'monthly',label:'consistent',confidence:null,probabilities:null,confidenceSource:'unavailable',adapter:'frontier',model:'claude-sonnet-5-5',escalatedBy:null} satisfies Judgment),
  }} satisfies ConstructorParameters<typeof MogsCoordinator>[0];
  const coordinator=new MogsCoordinator(options);
  const start=async()=>{const request={changeId:initialFacts().change.id,expectedFactVersion:1,idempotencyKey:randomUUID()},response=await coordinator.confirm(request);await coordinator.processRun(response.runId);assert.equal((await coordinator.run(response.runId)).run.status,'ready');return{request,response};};
  return{root,options,coordinator,start,read,contentRoot,databasePath,factsPath,get checkCalls(){return checkCalls;},cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('isolated coordinator: idempotent confirm/approve, complete groups, sequential source revisions, protected email',async()=>{
  const s=sandbox();try{
    const {request,response}=await s.start(),first=await s.coordinator.confirm(request);assert.deepEqual(first,response);
    await assert.rejects(s.coordinator.confirm({...request,expectedFactVersion:2}),e=>e instanceof ServiceError&&e.code==='idempotency_conflict');
    const direct=(await s.coordinator.groups(response.runId)).groups.find(g=>g.key.includes(':direct_price:'))!;assert.equal(direct.eligibleIds.length,2);
    const protectedPath=path.join(s.contentRoot,'email/eligible.md'),protectedHash=sha256(readFileSync(protectedPath)),approve={runId:response.runId,expectedRevision:direct.revision,idempotencyKey:randomUUID()};
    const published=await s.coordinator.approve(direct.id,approve);assert.equal(published.status,'verified');assert.equal(published.actor,'test');assert.equal(published.files.length,2);
    const snapshots=published.files.map(f=>sha256(readFileSync(path.join(s.contentRoot,f.file))));assert.deepEqual(await s.coordinator.approve(direct.id,approve),published);assert.deepEqual(published.files.map(f=>sha256(readFileSync(path.join(s.contentRoot,f.file)))),snapshots);
    await assert.rejects(s.coordinator.approve(direct.id,{...approve,expectedRevision:99}),e=>e instanceof ServiceError&&e.code==='idempotency_conflict');
    const groups=await s.coordinator.groups(response.runId),savings=groups.groups.find(g=>g.key.includes(':annual_savings:'))!;assert.ok(savings.revision>0);assert.equal(savings.status,'sealed');
    const second=await s.coordinator.approve(savings.id,{runId:response.runId,expectedRevision:savings.revision,idempotencyKey:randomUUID()});assert.equal(second.status,'verified');assert.equal(second.files[0].beforeHash,published.files.find(f=>f.file==='site/launch.md')!.afterHash);
    assert.equal(sha256(readFileSync(protectedPath)),protectedHash);assert.equal((await s.coordinator.run(response.runId)).run.stats.reviewActions,0);assert.ok(s.checkCalls>2);
    const exportData=await s.coordinator.exportRun(response.runId);assert.equal(exportData.reviewEvents.filter(e=>e.action==='approve').length,2);assert.ok(exportData.patches.some(p=>p.status==='withheld'));assert.ok(exportData.reviewEvents.some(e=>e.action==='revision_advance'));
  }finally{s.cleanup();}
});
test('external source edit blocks a complete group before any member is published',async()=>{
  const s=sandbox();try{const {response}=await s.start(),group=(await s.coordinator.groups(response.runId)).groups.find(g=>g.key.includes(':direct_price:'))!,email=path.join(s.contentRoot,'email/onboarding.md'),before=readFileSync(email,'utf8'),web=path.join(s.contentRoot,'site/launch.md');writeFileSync(web,readFileSync(web,'utf8').replace('MOGS','EXTERNAL'));
    await assert.rejects(s.coordinator.approve(group.id,{runId:response.runId,expectedRevision:group.revision,idempotencyKey:randomUUID()}));assert.equal(readFileSync(email,'utf8'),before);assert.equal((await s.coordinator.groups(response.runId)).publications.length,0);assert.equal((await s.coordinator.groups(response.runId)).groups.find(g=>g.id===group.id)!.status,'blocked');
  }finally{s.cleanup();}
});
test('write failure restores all images and repeated approval returns recorded recovery',async()=>{
  const s=sandbox(index=>{if(index===1)throw new Error('Injected second file write failure.');});try{const {response}=await s.start(),group=(await s.coordinator.groups(response.runId)).groups.find(g=>g.key.includes(':direct_price:'))!,before=s.read().pages.map(p=>p.sourceHash),request={runId:response.runId,expectedRevision:group.revision,idempotencyKey:randomUUID()},result=await s.coordinator.approve(group.id,request);assert.equal(result.status,'recovered');assert.deepEqual(s.read().pages.map(p=>p.sourceHash),before);assert.deepEqual(await s.coordinator.approve(group.id,request),result);assert.equal((await s.coordinator.run(response.runId)).run.stats.published,0);
  }finally{s.cleanup();}
});
test('restart recovers a durable partial publication before accepting later mutations',async()=>{
  const s=sandbox();try{const {response}=await s.start(),data=await s.coordinator.exportRun(response.runId),group=data.groups.find(g=>g.key.includes(':direct_price:'))!,patches=data.patches.filter(p=>group.eligibleIds.includes(p.id)),at=new Date().toISOString();
    const files=patches.map(p=>{const page=data.pages.find(page=>page.assetId===p.assetId)!,source=readFileSync(path.join(s.contentRoot,page.file!),'utf8'),after=replaceSourceBlocks(parseSource(source,page.file!,p.surface),[{sourceId:p.sourceId,original:p.original,replacement:p.replacement!}],p.expectedFileHash);return{file:page.file!,beforeHash:sha256(source),afterHash:sha256(after),beforeSource:source,afterSource:after,state:'staged' as const};});
    const pub:Publication={id:randomUUID(),runId:response.runId,groupId:group.id,factVersion:data.run.factVersion,idempotencyKey:randomUUID(),requestFingerprint:hashRecord('interruption-fixture'),approvedRevision:group.revision,approvedMemberIds:group.eligibleIds,actor:'test',status:'writing',files,verification:[],createdAt:at,updatedAt:at,failure:null};
    const db=new MogsDatabase(s.databasePath);try{db.putPublication(pub);group.status='publishing';group.publicationId=pub.id;db.putGroup(group);}finally{db.close();}
    durableWrite(path.join(s.contentRoot,files[0].file),files[0].afterSource);
    const restarted=new MogsCoordinator(s.options);await restarted.recover();const recovered=(await restarted.groups(response.runId)).publications[0];assert.equal(recovered.status,'recovered');for(const file of files)assert.equal(sha256(readFileSync(path.join(s.contentRoot,file.file))),file.beforeHash);
  }finally{s.cleanup();}
});
test('restart confirmation recovery chooses committed facts; unfinished run becomes an explicit failure',async()=>{
  const s=sandbox();try{const request={changeId:initialFacts().change.id,expectedFactVersion:1,idempotencyKey:randomUUID()},beforeSource=readFileSync(s.factsPath,'utf8'),response=await s.coordinator.confirm(request),afterSource=readFileSync(s.factsPath,'utf8');writeFileSync(path.join(path.dirname(s.databasePath),'confirm-journal.json'),JSON.stringify({before:JSON.parse(beforeSource),after:JSON.parse(afterSource),runId:response.runId,beforeSource,afterSource}));writeFileSync(path.join(path.dirname(s.databasePath),'processing.json'),JSON.stringify({pid:2147483647,runId:response.runId,status:'running'}));writeFileSync(s.factsPath,beforeSource);const restarted=new MogsCoordinator(s.options);await restarted.recover();assert.equal(readFileSync(s.factsPath,'utf8'),afterSource);assert.equal((await restarted.run(response.runId)).run.status,'failed');assert.deepEqual(await restarted.confirm(request),response);
  }finally{s.cleanup();}
});
test('another coordinator polling a scheduled or active owner does not interrupt the run',async()=>{
  const s=sandbox();try{
    const response=await s.coordinator.confirm({changeId:initialFacts().change.id,expectedFactVersion:1,idempotencyKey:randomUUID()});
    const polling=new MogsCoordinator(s.options);assert.equal((await polling.run(response.runId)).run.status,'collecting');
    let release!:()=>void,started!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;}),classify=s.options.testDependencies.classify;
    s.options.testDependencies.classify=async(...args)=>{started();await barrier;return classify(...args);};
    const running=s.coordinator.processRun(response.runId);await entered;
    assert.equal((await new MogsCoordinator(s.options).run(response.runId)).run.status,'classifying');
    release();await running;assert.equal((await polling.run(response.runId)).run.status,'ready');
  }finally{s.cleanup();}
});
test('a source edit arriving during an asynchronous preflight check blocks the entire group',async()=>{
  const s=sandbox();try{const {response}=await s.start(),group=(await s.coordinator.groups(response.runId)).groups.find(g=>g.key.includes(':direct_price:'))!,check=s.options.testDependencies.check;
    let release!:()=>void,started!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
    s.options.testDependencies.check=async(...args)=>{const result=await check(...args);if(args[0].surface==='web'){started();await barrier;}return result;};
    const email=path.join(s.contentRoot,'email/onboarding.md'),emailBefore=readFileSync(email,'utf8'),publishing=s.coordinator.approve(group.id,{runId:response.runId,expectedRevision:group.revision,idempotencyKey:randomUUID()});await entered;
    const web=path.join(s.contentRoot,'site/launch.md');writeFileSync(web,readFileSync(web,'utf8').replace('MOGS','EXTERNAL'));release();await assert.rejects(publishing,e=>e instanceof ServiceError&&e.code==='stale');assert.equal(readFileSync(email,'utf8'),emailBefore);assert.equal((await s.coordinator.groups(response.runId)).publications.length,0);
  }finally{s.cleanup();}
});
