/** Real provider integration against an isolated copy. Approvals are test-only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { MogsCoordinator } from '../lib/runs/service';
import { loadLocalEnv } from '../lib/providers/env';
import { hashRecord, sha256 } from '../lib/hash';
import { type ManifestRow } from '../lib/types';

loadLocalEnv();
const root=path.resolve(process.env.MOGS_GATE1_ROOT??'/private/tmp/mogs-gate1-live');
const contentRoot=path.join(root,'content'),factsPath=path.join(root,'data/facts.json'),databasePath=path.join(root,'data/app.db'),baseUrl=process.env.MOGS_BASE_URL??'http://localhost:3100';
const seed=JSON.parse(readFileSync('content/seed.json','utf8')) as {sources:Record<string,{source:string;hash:string}>;manifestHash:string;initialFactHash:string};
if(process.argv[2]==='prepare'){
  if(existsSync(databasePath))throw new Error('Use a fresh isolated root for every real-provider gate.');
  for(const [file,item] of Object.entries(seed.sources)){mkdirSync(path.dirname(path.join(contentRoot,file)),{recursive:true});writeFileSync(path.join(contentRoot,file),item.source);}
  mkdirSync(path.dirname(factsPath),{recursive:true});writeFileSync(factsPath,readFileSync('data/seed/facts.json'));
  console.log(JSON.stringify({prepared:true,root,baseUrl,actor:'test',scope:'miniature-gate-1'}));
}else{
  process.env.MOGS_CONTENT_ROOT=contentRoot;
  const coordinator=new MogsCoordinator({databasePath,contentRoot,factsPath,runtimeRoot:path.dirname(databasePath),baseUrl,mode:'eval',actor:'test'});
  const request={changeId:'starter-monthly-30-to-40',expectedFactVersion:1,idempotencyKey:randomUUID()},confirmed=await coordinator.confirm(request);
  assert.deepEqual(await coordinator.confirm(request),confirmed);
  await coordinator.processRun(confirmed.runId);
  const initial=await coordinator.exportRun(confirmed.runId);
  mkdirSync('data/evidence',{recursive:true});
  const evidencePath=path.resolve('data/evidence/gate1-'+confirmed.runId+'.json');
  // Preserve the actual outcome before evaluating any gate assertions.
  writeFileSync(evidencePath,JSON.stringify({stage:'processed',actor:'test',root,initial},null,2)+'\n');
  assert.equal(initial.run.status,'ready',JSON.stringify(initial.run.errors));
  const manifest=readFileSync('content/manifest.jsonl','utf8').trim().split('\n').map(line=>JSON.parse(line) as ManifestRow);
  const wrong=manifest.filter(m=>m.expectedLabel==='contradicting');
  assert.ok(wrong.every(m=>initial.judgments.some(j=>j.passageId===m.passageId&&j.label==='contradicting')),'Every featured wrong claim must be detected.');
  assert.ok(!initial.patches.some(p=>manifest.find(m=>m.passageId===p.passageId)?.expectedLabel!=='contradicting'),'Protected and ambiguous claims must have no proposals.');
  const legacy=initial.judgments.find(j=>j.passageId==='email:email/eligible.md#starter-price');assert.equal(legacy?.label,'valid_exception');
  assert.ok(initial.patches.some(p=>p.kind==='threshold'&&p.status==='withheld'));
  const pristineLegacy=sha256(readFileSync(path.join(contentRoot,'email/eligible.md')));
  const approvals=[];
  for(const kind of ['direct_price','annual_savings','per_day','plan_gap']){
    const data=await coordinator.groups(confirmed.runId),group=data.groups.find(g=>g.key.includes(':'+kind+':'))!;
    assert.equal(group?.status,'sealed','Required correction group must be fully checked: '+kind);
    if(kind==='direct_price'){assert.equal(group.eligibleIds.length,2);assert.equal(group.bySurface.email.eligible,1);assert.equal(group.bySurface.web.eligible,1);}
    const approval={runId:confirmed.runId,expectedRevision:group.revision,idempotencyKey:randomUUID()};
    const result=await coordinator.approve(group.id,approval);approvals.push(result);
    writeFileSync(evidencePath,JSON.stringify({stage:kind,actor:'test',root,initial,approvals,final:await coordinator.exportRun(confirmed.runId)},null,2)+'\n');
    assert.equal(result.status,'verified',JSON.stringify(result.verification));
    assert.deepEqual(await coordinator.approve(group.id,approval),result);
  }
  const final=await coordinator.exportRun(confirmed.runId);assert.equal(final.run.stats.reviewActions,0);assert.equal(sha256(readFileSync(path.join(contentRoot,'email/eligible.md'))),pristineLegacy);
  for(const row of manifest){if(row.expectedLabel!=='contradicting'){const source=readFileSync(path.join(contentRoot,row.assetId.split(':')[1]),'utf8');assert.ok(source.includes('\n'+row.text+'\n'),'Protected block changed: '+row.passageId);}}
  const evidence={stage:'complete',actor:'test',root,provenance:{seedRevision:process.env.MOGS_SEED_REVISION??'unrecorded',corpusHash:initial.run.scope.corpusHash,labelHash:seed.manifestHash,factHash:hashRecord(JSON.parse(readFileSync(factsPath,'utf8'))),scope:'one editable web page + two emails; canonical pricing outside run'},initial,approvals,final};
  writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({passed:true,runId:confirmed.runId,adapter:final.run.config.adapter,model:final.run.config.judgeModel,stats:final.run.stats,groups:final.groups.map(g=>({key:g.key,status:g.status,revision:g.revision,members:g.memberIds.length})),approvals:'test-only, isolated content',evidencePath}));
}
