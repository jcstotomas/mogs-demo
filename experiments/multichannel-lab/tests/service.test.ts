import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { LabService } from '../src/service.ts';
import { RUNTIME_ROOT } from '../src/store.ts';
import { DEFAULT_FACTS } from '../src/contracts.ts';
const html='<h1>Starter for new customers</h1><p>Starter is $30 a month.</p><p>Annual billing stays $288 a year.</p>';
const input=(filename='check.html')=>({filename,base64:Buffer.from(html).toString('base64'),context:{audience:'new_customers',legacyEligible:false}});
async function complete(service:LabService,id:string){for(let i=0;i<100;i++){const run=service.run(id);if(!['queued','running'].includes(run.status))return run;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Run timed out.');}
async function withService(name:string,fn:(service:LabService)=>Promise<void>){process.env.MOGS_MULTICHANNEL_ENABLED='1';const storage='test_'+name;rmSync(path.join(RUNTIME_ROOT,storage),{recursive:true,force:true});const service=new LabService(storage);try{await fn(service);}finally{service.close();rmSync(path.join(RUNTIME_ROOT,storage),{recursive:true,force:true});delete process.env.MOGS_MULTICHANNEL_ENABLED;}}
test('real import is idempotent, full scan accounted, changed context invalidates prior findings',()=>withService('revision',async service=>{
 const a=await service.import(input());assert.equal(a.status,'ready');assert.ok(a.extraction?.units.every(u=>u.textHash&&u.contextHash));const again=await service.import(input());assert.equal(again.id,a.id);
 const run=await complete(service,service.analyze({assetIds:[a.id],facts:DEFAULT_FACTS}).id);assert.equal(run.counts.checked,a.extraction!.units.length);assert.ok(run.findings.some(f=>f.replacement?.includes('$40')));assert.equal(run.stale,false);
 const revised=await service.import({...input(),context:{audience:'existing_customers',legacyEligible:true}});assert.notEqual(revised.revision,a.revision);assert.equal(service.run(run.id).stale,true);
 assert.throws(()=>service.analyze({assetIds:[a.id],facts:DEFAULT_FACTS}),/current assets/);
}));
test('bad file contents are rejected and parser failures are persisted in coverage',()=>withService('failures',async service=>{
 await assert.rejects(service.import({filename:'fake.png',base64:Buffer.from(html).toString('base64')}),/contents must match/);
 await assert.rejects(service.import({...input(),filename:'../escape.html'}));
 const broken=await service.import({filename:'broken.pdf',base64:Buffer.from('%PDF-1.7 broken').toString('base64'),context:{}});assert.equal(broken.status,'failed');assert.ok(broken.error);
 const run=await complete(service,service.analyze({assetIds:[broken.id],facts:DEFAULT_FACTS}).id);assert.equal(run.status,'partial');assert.equal(run.counts.assets,1);assert.equal(run.errors.length,1);
}));
test('stale bytes block analysis and previews; duplicate scope rejected',()=>withService('freshness',async service=>{
 const a=await service.import(input());assert.throws(()=>service.analyze({assetIds:[a.id,a.id],facts:DEFAULT_FACTS}),/Duplicate/);writeFileSync(service.store.file(a.original),'changed');assert.throws(()=>service.preview(a.id,1),/changed/);assert.throws(()=>service.analyze({assetIds:[a.id],facts:DEFAULT_FACTS}),/changed/);
}));
test('stop cancels queued work and a restart retains the cancelled record',async()=>{
 process.env.MOGS_MULTICHANNEL_ENABLED='1';const name='test_cancel';rmSync(path.join(RUNTIME_ROOT,name),{recursive:true,force:true});const service=new LabService(name);const a=await service.import(input());const queued=service.analyze({assetIds:[a.id],facts:DEFAULT_FACTS});service.close();await new Promise(resolve=>setImmediate(resolve));const restored=new LabService(name);try{assert.equal(restored.run(queued.id).status,'cancelled');assert.equal(restored.run(queued.id).findings.length,0);}finally{restored.close();rmSync(path.join(RUNTIME_ROOT,name),{recursive:true,force:true});delete process.env.MOGS_MULTICHANNEL_ENABLED;}
});
test('preview tampering is rejected independently of unchanged source bytes',()=>withService('preview_integrity',async service=>{
 const a=await service.import(input());const preview=service.preview(a.id,1);assert.ok(preview.preview.hash);writeFileSync(service.store.file(preview.preview.file),'altered preview');assert.throws(()=>service.preview(a.id,1),/Preview bytes changed/);
}));
test('cancelled extraction can only finish in disposable scratch, never publish late previews',async()=>{
 process.env.MOGS_MULTICHANNEL_ENABLED='1';const name='test_extract_cancel';rmSync(path.join(RUNTIME_ROOT,name),{recursive:true,force:true});
 let release!:()=>void,started!:()=>void;const waiting=new Promise<void>(r=>{release=r;});const ready=new Promise<void>(r=>{started=r;});let scratch='';
 const service=new LabService(name,{extractor:async input=>{scratch=input.outputDir;started();await waiting;const file=path.join(scratch,'late.html');writeFileSync(file,'late');return {surface:'email',extractor:'fixture-cancel-test',units:[],previews:[{page:1,file,mime:'text/html',width:1,height:1}],status:'partial',warnings:['fixture'],pages:1};}});
 const importing=service.import(input());const rejected=assert.rejects(importing,/stopping/);await ready;const original=service.store.assets()[0]!;service.close();release();await rejected;
 const {existsSync}=await import('node:fs');assert.equal(existsSync(path.join(RUNTIME_ROOT,name,'assets',original.id,'previews')),false);assert.equal(existsSync(scratch),false);
 const restored=new LabService(name);try{assert.equal(restored.store.asset(original.id).status,'failed');assert.equal(restored.store.asset(original.id).extraction,null);}finally{restored.close();rmSync(path.join(RUNTIME_ROOT,name),{recursive:true,force:true});delete process.env.MOGS_MULTICHANNEL_ENABLED;}
});

test('export freezes source provenance and coverage while cancellation cannot become complete',()=>withService('export_cancel',async service=>{
 const a=await service.import(input());const run=await complete(service,service.analyze({assetIds:[a.id],facts:DEFAULT_FACTS}).id);
 const exported=service.export(run.id);assert.equal(exported.reportKind,'experimental-multichannel-suggestions');assert.equal(exported.publication,'none');assert.equal(exported.sourceManifest[0].sourceHash,a.sourceHash);assert.equal(exported.sourceManifest[0].context.audience,'new_customers');assert.ok(exported.sourceManifest[0].extraction?.units[0].context);assert.ok(!JSON.stringify(exported.sourceManifest).includes('original.html'));
 await service.import({...input(),context:{audience:'existing_customers',legacyEligible:true}});const stale=service.export(run.id);assert.equal(stale.run.stale,true);assert.equal(stale.sourceManifest[0].context.audience,'new_customers');
 const current=service.state().assets.find(x=>x.active)!;const pending=service.analyze({assetIds:[current.id],facts:DEFAULT_FACTS});service.cancel(pending.id);await new Promise(r=>setTimeout(r,20));assert.equal(service.run(pending.id).status,'cancelled');
}));

test('cancelling a partly scanned run preserves truthful finding counts',()=>withService('partial_cancel',async service=>{
 const a=await service.import(input('first.html'));const b=await service.import(input('second.html'));
 const run=service.analyze({assetIds:[a.id,b.id],facts:DEFAULT_FACTS});
 for(let i=0;i<20;i++){await new Promise<void>(r=>setImmediate(r));const progress=service.run(run.id);if(progress.findings.length){service.cancel(run.id);break;}}
 const cancelled=service.run(run.id);assert.equal(cancelled.status,'cancelled');assert.ok(cancelled.findings.some(f=>f.replacement));assert.equal(cancelled.counts.suggestions,cancelled.findings.filter(f=>f.replacement).length);assert.equal(cancelled.counts.checked,cancelled.findings.length);
}));
