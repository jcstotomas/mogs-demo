import { assertEnabled } from '../src/gate.ts';
assertEnabled();
const {readFile,writeFile,mkdir}=await import('node:fs/promises');
const {LabService}=await import('../src/service.ts');
const {confined}=await import('../src/store.ts');
const {fileURLToPath}=await import('node:url');
const {DEFAULT_FACTS,hash,hashRecord}=await import('../src/contracts.ts');
const collection=process.argv.includes('--showcase')?'showcase':'fixtures';
const collectionRoot=new URL('../'+collection+'/',import.meta.url);
const source=await readFile(new URL('manifest.json',collectionRoot));
const manifest=JSON.parse(source.toString());
const service=new LabService('evaluation_'+Date.now());
try{
 const assets=[];
 for(const entry of manifest.assets){const bytes=await readFile(confined(fileURLToPath(collectionRoot).replace(/\/$/,''),entry.file??entry.filename));if(hash(bytes)!==entry.sha256)throw new Error('Frozen source hash differs: '+entry.filename);assets.push(await service.import({filename:entry.filename,base64:bytes.toString('base64'),context:entry.context}));}
 const initial=service.analyze({assetIds:assets.map(a=>a.id),facts:DEFAULT_FACTS});let run=service.run(initial.id);
 while(['queued','running'].includes(run.status)){await new Promise(resolve=>setTimeout(resolve,10));run=service.run(initial.id);}
 const outcomes=[];const claimed=new Set<string>();
 const normalize=(s:string)=>s.replace(/\s+/g,' ').trim();
 const observation=(s:string,ocr:boolean)=>ocr?normalize(s).replace(/[.!?]+$/,''):normalize(s);
 for(const entry of manifest.assets){const asset=assets.find(a=>a.filename===entry.filename)!;
  for(const expected of entry.expected){const unit=asset.extraction?.units.find(u=>!claimed.has(asset.id+':'+u.id)&&observation(u.text,u.locator.kind==='image')===observation(expected.text,u.locator.kind==='image')&&(expected.field?u.locator.kind==='html'&&u.locator.field===expected.field:!(u.locator.kind==='html'&&u.locator.field))&&(!expected.page||'page'in u.locator&&u.locator.page===expected.page));if(unit)claimed.add(asset.id+':'+unit.id);
   const finding=unit&&run.findings.find(f=>f.assetId===asset.id&&f.unitId===unit.id);const pass=!!finding&&finding.label===expected.label&&(expected.replacement===undefined?finding.replacement===null:finding.replacement===expected.replacement);
   outcomes.push({filename:entry.filename,text:expected.text,observedText:unit?.text??null,exactTextMatch:unit?.text===expected.text,matchRule:unit?.locator.kind==='image'?'whitespace and terminal punctuation only':'whitespace only',field:expected.field,page:expected.page,expectedLabel:expected.label,observedLabel:finding?.label??'missing',expectedReplacement:expected.replacement??null,observedReplacement:finding?.replacement??null,pass});
  }
 }
 const extra=run.findings.filter(f=>!claimed.has(f.assetId+':'+f.unitId)).map(f=>({assetId:f.assetId,text:f.original,label:f.label,replacement:f.replacement}));
 const report={contractVersion:'mogs-lab-evaluation-v1',collection,runId:run.id,createdAt:new Date().toISOString(),manifestHash:hash(source),factsHash:hashRecord(DEFAULT_FACTS),engine:run.engine,evidenceMode:'real local parsers and OCR; deterministic MOGS rules; synthetic corpus',assets:assets.length,surfaces:assets.reduce((a:Record<string,number>,b)=>(a[b.surface]=(a[b.surface]??0)+1,a),{}),units:run.counts.units,checked:run.counts.checked,expected:outcomes.length,passed:outcomes.filter(o=>o.pass).length,failed:outcomes.filter(o=>!o.pass).length,runStatus:run.status,coverage:assets.map(a=>({filename:a.filename,status:a.status,warnings:a.extraction?.warnings??[],error:a.error})),outcomes,unlabelledFindings:extra,errors:run.errors,durationMs:run.durationMs};
 await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/evaluation-'+run.id+'.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({runId:run.id,assets:report.assets,units:report.units,expected:report.expected,passed:report.passed,failed:report.failed,runStatus:run.status,misses:outcomes.filter(o=>!o.pass)},null,2));if(report.failed||assets.some(a=>a.status==='failed'))process.exitCode=1;
}finally{service.close();}
