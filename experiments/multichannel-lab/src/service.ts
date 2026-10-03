import { readFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ContextSchema,FactsSchema,ExtractionSchema,CONTRACT_VERSION,DEFAULT_FACTS,hash,hashRecord,limits,type Asset,type LabRun,type Preview } from './contracts.ts';
import { assertEnabled,enabled } from './gate.ts';
import { Store,PACKAGE_ROOT,confined } from './store.ts';
import { extractAsset,EXTRACTOR_VERSION } from './extract.ts';
import { analyzeAsset,ENGINE } from './analyze.ts';
const ImportSchema=z.object({filename:z.string().min(1).max(200).refine(v=>!/[\\/\x00-\x1f]/.test(v),'Filename must not contain a path.'),base64:z.string().min(1).max(limits.requestBytes),context:ContextSchema.default({} as never)}).strict();
function countFindings(run:LabRun){run.counts.checked=run.findings.length;run.counts.suggestions=run.findings.filter(f=>f.replacement!==null).length;run.counts.unresolved=run.findings.filter(f=>f.label==='insufficient_context'||f.label==='contradicting'&&!f.replacement).length;}
function media(filename:string,bytes:Buffer):{mime:string;surface:Asset['surface']}{
 const ext=path.extname(filename).toLowerCase();
 if(ext==='.pdf'&&bytes.subarray(0,5).toString()==='%PDF-')return {mime:'application/pdf',surface:'deck'};
 if(ext==='.png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:'image/png',surface:'creative'};
 if(['.jpg','.jpeg'].includes(ext)&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {mime:'image/jpeg',surface:'creative'};
 if(['.html','.htm'].includes(ext)){try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/<(?:!doctype\s+html|html|body|div|p|h[1-6]|table|section|article)\b/i.test(text)&&!text.includes('\0'))return {mime:'text/html',surface:'email'};}catch{}}
 throw Object.assign(new Error('Use a valid UTF-8 HTML email, PDF deck, PNG, or JPEG; file contents must match the extension.'),{status:400});
}
export class LabService{
 readonly store:Store;private cancelled=new Set<string>();private processing=false;private closed=false;private imports=0;private importChain:Promise<unknown>=Promise.resolve();private extractor:typeof extractAsset;
 constructor(storage='default',options:{extractor?:typeof extractAsset}={}){
  assertEnabled();this.extractor=options.extractor??extractAsset;this.store=new Store(storage);
  for(const a of this.store.assets())if(a.status==='extracting')this.store.saveAsset({...a,status:'failed',error:'Extraction was interrupted. Reimport this file to retry.'});
  for(const r of this.store.runs())if(['queued','running'].includes(r.status))this.store.saveRun({...r,status:'failed',completedAt:new Date().toISOString(),errors:[...r.errors,'Analysis was interrupted; start a fresh run.']});
 }
 private assertLive(){assertEnabled();if(this.closed)throw Object.assign(new Error('Lab is stopping.'),{status:503});}
 private fresh(asset:Asset){if(hash(this.store.read(asset.original))!==asset.sourceHash)throw Object.assign(new Error('Original source bytes changed. Reimport before checking.'),{status:409});}
 state(){this.assertLive();return {assets:this.store.assets(),runs:this.store.runs().map(r=>this.run(r.id)),facts:DEFAULT_FACTS,engine:ENGINE};}
 async import(raw:unknown):Promise<Asset>{
  this.assertLive();if(this.imports>=10)throw Object.assign(new Error('Import queue is full.'),{status:429});this.imports++;
  const operation=this.importChain.then(()=>this.performImport(raw));this.importChain=operation.catch(()=>{});
  try{return await operation;}finally{this.imports--;}
 }
 private async performImport(raw:unknown):Promise<Asset>{
  this.assertLive();const input=ImportSchema.parse(raw);const context=ContextSchema.parse(input.context);
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64))throw Object.assign(new Error('Invalid base64 file.'),{status:400});
  const bytes=Buffer.from(input.base64,'base64');if(!bytes.length||bytes.length>limits.fileBytes)throw Object.assign(new Error('Files must be between 1 byte and 10 MB.'),{status:413});
  const type=media(input.filename,bytes),sourceHash=hash(bytes),contextHash=hashRecord(context);
  const revision=hashRecord({sourceHash,contextHash,filename:input.filename,extractor:EXTRACTOR_VERSION,previewContract:'sha256-v1'}),id='asset_'+revision.slice(0,32);
  let previous:Asset|undefined;try{previous=this.store.asset(id);}catch{}
  if(previous&&previous.status!=='failed'){this.fresh(previous);this.store.activate(previous);return this.store.asset(id);}
  if(!previous&&this.store.assets().length>=limits.assets)throw Object.assign(new Error('This lab is limited to 100 revisions. Use a new lab storage name for another corpus.'),{status:409});
  const base='assets/'+id,original=base+'/original'+path.extname(input.filename).toLowerCase();
  if(!existsSync(this.store.file(original)))this.store.write(original,bytes);else if(hash(this.store.read(original))!==sourceHash)throw Object.assign(new Error('Stored source changed; this revision cannot be reused.'),{status:409});
  const asset:Asset={id,revision,sourceHash,contextHash,filename:input.filename,...type,context,createdAt:new Date().toISOString(),status:'extracting',extraction:null,error:null,original,active:true};this.store.activate(asset);
  let scratch:string|undefined;
  try{
   scratch=await realpath(await mkdtemp(path.join(tmpdir(),'mogs-lab-extraction-')));const outputDir=scratch;this.assertLive();
   const extraction=ExtractionSchema.parse(await this.extractor({file:this.store.file(original),filename:input.filename,mime:type.mime,context,outputDir}));this.assertLive();
   for(const unit of extraction.units){unit.textHash=hash(unit.text);unit.contextHash=hashRecord({context,local:unit.context,extractor:extraction.extractor});}
   if(extraction.units.length>limits.units||new Set(extraction.units.map(u=>u.id)).size!==extraction.units.length)throw new Error('Extraction exceeded limits or returned duplicate locations.');
   for(const preview of extraction.previews){
    const source=confined(scratch,path.relative(scratch,preview.file));const rendered=await readFile(source);this.assertLive();this.fresh(asset);
    preview.hash=hash(rendered);preview.file=base+'/previews/'+randomUUID()+(preview.mime==='text/html'?'.html':'.png');this.store.write(preview.file,rendered);
   }
   asset.extraction=extraction;asset.status=extraction.status==='complete'?'ready':'partial';this.fresh(asset);
  }catch(error){if(this.closed||!enabled())throw error;asset.status='failed';asset.error=error instanceof Error?error.message:'Extraction failed.';}finally{if(scratch)await rm(scratch,{recursive:true,force:true});}
  this.assertLive();this.store.saveAsset(asset);return asset;
 }
 async demo(){this.assertLive();const manifest=JSON.parse(await readFile(path.join(PACKAGE_ROOT,'showcase/manifest.json'),'utf8'));
  const entries=Array.isArray(manifest)?manifest:manifest.assets;const assets:Asset[]=[];
  for(const entry of entries){this.assertLive();if(!entry.filename||/[\\/]/.test(entry.filename))throw new Error('Invalid fixture filename.');const bytes=await readFile(confined(path.join(PACKAGE_ROOT,'showcase'),entry.file??entry.filename));if(hash(bytes)!==entry.sha256)throw new Error('Campaign source hash differs: '+entry.filename);assets.push(await this.import({filename:entry.filename,base64:bytes.toString('base64'),context:entry.context??{}}));}return {assets};
 }
 analyze(raw:unknown):LabRun{
  this.assertLive();const {assetIds,facts}=z.object({assetIds:z.array(z.string()).min(1).max(limits.assets),facts:FactsSchema.default(DEFAULT_FACTS)}).strict().parse(raw);
  if(new Set(assetIds).size!==assetIds.length)throw Object.assign(new Error('Duplicate assets in run scope.'),{status:400});
  if(this.processing||this.store.runs().some(r=>['queued','running'].includes(r.status)))throw Object.assign(new Error('A lab scan is already in progress.'),{status:409});
  const assets=assetIds.map(id=>this.store.asset(id));for(const asset of assets){if(!asset.active||asset.status==='extracting')throw Object.assign(new Error('Select current assets whose extraction has finished.'),{status:409});this.fresh(asset);}
  const run:LabRun={assetSnapshots:assets.map(({original,active,...asset})=>asset),id:'lab_'+randomUUID(),contractVersion:CONTRACT_VERSION,createdAt:new Date().toISOString(),completedAt:null,status:'queued',facts,factsHash:hashRecord(facts),assetIds,revisions:Object.fromEntries(assets.map(a=>[a.id,a.revision])),engine:ENGINE,findings:[],errors:[],counts:{assets:assets.length,units:assets.reduce((n,a)=>n+(a.extraction?.units.length??0),0),checked:0,suggestions:0,unresolved:0},durationMs:0,stale:false};this.store.saveRun(run);setImmediate(()=>void this.process(run.id));return run;
 }
 private async process(id:string){
  if(this.processing||this.closed||!enabled()||this.cancelled.has(id))return;this.processing=true;
  let run=this.store.run(id);const start=performance.now();
  try{this.assertLive();run.status='running';this.store.saveRun(run);
   for(const assetId of run.assetIds){await new Promise<void>(resolve=>setImmediate(resolve));this.assertLive();if(this.cancelled.has(id))throw new Error('Analysis cancelled.');const asset=this.store.asset(assetId);this.fresh(asset);if(!asset.active||asset.revision!==run.revisions[assetId])throw new Error('Run source changed during analysis.');
    if(asset.status==='failed'){run.errors.push(asset.filename+': '+asset.error);continue;}
    if(asset.status==='partial')run.errors.push(asset.filename+': partial extraction; review coverage warnings.');
    const findings=analyzeAsset(asset,run.facts);if(findings.length!==asset.extraction!.units.length)throw new Error('The checker did not account for every extracted unit.');run.findings.push(...findings);run.counts.checked+=findings.length;this.store.saveRun(run);
   }
   run.counts.suggestions=run.findings.filter(f=>f.replacement!==null).length;run.counts.unresolved=run.findings.filter(f=>f.label==='insufficient_context'||f.label==='contradicting'&&!f.replacement).length;
   run.status=run.errors.length||run.counts.unresolved?'partial':'complete';
  }catch(error){run.status=this.closed||this.cancelled.has(id)?'cancelled':'failed';run.errors.push(error instanceof Error?error.message:'Analysis failed.');}
  finally{countFindings(run);run.completedAt=new Date().toISOString();run.durationMs=Math.round(performance.now()-start);if(!this.closed&&enabled()&&!this.cancelled.has(id))this.store.saveRun(run);this.processing=false;}
 }
 cancel(id:string){this.assertLive();const run=this.store.run(id);if(!['queued','running'].includes(run.status))return;this.cancelled.add(id);countFindings(run);this.store.saveRun({...run,status:'cancelled',completedAt:new Date().toISOString(),errors:[...run.errors,'Analysis cancelled; partial results are not a completed audit.']});}
 export(id:string){const run=this.run(id);if(!run.assetSnapshots)throw Object.assign(new Error('This older run has no frozen source manifest. Start a fresh scan before exporting.'),{status:409});return {reportKind:'experimental-multichannel-suggestions',publication:'none',run,sourceManifest:run.assetSnapshots.map(a=>({...a,extraction:a.extraction?{...a.extraction,previews:a.extraction.previews.map(({file,...preview})=>preview)}:null})),limitations:['Suggestions do not edit, approve, or publish an asset.','Partial extraction and unresolved findings remain explicit omissions.','Deck and creative sources are outside the launch publication inventory.']};}
 run(id:string):LabRun{
  this.assertLive();const run=this.store.run(id);run.stale=run.engine!==ENGINE||run.assetIds.some(id=>{try{const asset=this.store.asset(id);this.fresh(asset);return !asset.active||asset.revision!==run.revisions[id];}catch{return true;}});return run;
 }
 preview(id:string,page:number):{asset:Asset;preview:Preview;bytes:Buffer}{this.assertLive();const asset=this.store.asset(id);this.fresh(asset);const preview=asset.extraction?.previews.find(p=>p.page===page);if(!preview)throw Object.assign(new Error('Preview unavailable.'),{status:404});const bytes=this.store.read(preview.file);if(!preview.hash||hash(bytes)!==preview.hash)throw Object.assign(new Error('Preview bytes changed. Reimport into fresh lab storage before review.'),{status:409});return {asset,preview,bytes};}
 close(){if(this.closed)return;for(const r of this.store.runs())if(['queued','running'].includes(r.status)&&enabled())this.store.saveRun({...r,status:'cancelled',completedAt:new Date().toISOString(),errors:[...r.errors,'Lab stopped; pending results were discarded.']});this.closed=true;this.store.close();}
}
