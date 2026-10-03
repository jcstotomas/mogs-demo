import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DEFAULT_FACTS,hash } from '../src/contracts.ts';
import { PACKAGE_ROOT } from '../src/store.ts';
import { prepareLaunchHandoff,launchHash,mapLaunchFacts } from '../src/launch-compatibility.ts';
import { assertEnabled } from '../src/gate.ts';
assertEnabled();
const verificationId='launch-compatibility-'+randomUUID();
const evidenceFile=path.join(PACKAGE_ROOT,'evidence',verificationId+'.json');
try {
const core=path.resolve(process.env.MOGS_CORE_ROOT??path.join(PACKAGE_ROOT,'../..'));
const load=(file:string)=>import(pathToFileURL(path.join(core,file)).href);
const [{buildFixtures,FIXTURE_TIME},{BaselineSchema,ConfirmRequestSchema},{RemoteBaselineViewSchema},{RemoteCoordinator},{RemoteDatabase},{hashRecord,sha256}]=await Promise.all([
 load('lib/fixtures.ts'),load('lib/runs/remote-types.ts'),load('lib/runs/remote-api.ts'),load('lib/runs/remote-service.ts'),load('lib/runs/remote-db.ts'),load('lib/hash.ts'),
]);
const oldCwd=process.cwd();process.chdir(core);let f:any;try{f=buildFixtures();}finally{process.chdir(oldCwd);}
const origin='https://mogs-lab-compatibility.invalid';
const pages=f.pages.map((p:any)=>({...p,url:origin+new URL(p.url).pathname}));
const passages=f.passages.map((p:any)=>({...p,url:origin+new URL(p.url).pathname}));
const assets=pages.map((p:any)=>({assetId:p.assetId,path:p.file===null?null:'content/'+p.file,pathname:new URL(p.url).pathname,surface:p.surface,editable:p.editable,sourceHash:p.sourceHash,metadataHash:p.metadataHash,sourceIds:passages.filter((unit:any)=>unit.assetId===p.assetId).map((unit:any)=>unit.sourceId)}));
const baseline=BaselineSchema.parse({target:{repository:'mogs/lab-compatibility',baseRef:'main',productionOrigin:origin,vercelProjectId:'fixture-project',vercelTeamId:'fixture-team',statusProducerAppId:17},baseSha:'a'.repeat(40),deployedSha:'a'.repeat(40),deploymentId:'fixture-baseline',deploymentUrl:origin,observedAt:FIXTURE_TIME,inventoryHash:hashRecord(assets),corpusHash:hashRecord(pages.map((p:any)=>[p.assetId,p.sourceHash])),factsHash:hashRecord(f.facts),factsFileHash:sha256(JSON.stringify(f.facts,null,2)+'\n'),assets});
const view=RemoteBaselineViewSchema.parse({contractVersion:2,baseline,baselineHash:hashRecord(baseline),beforeFacts:f.facts,desiredFacts:f.after,activeRunId:null,enforcement:{available:true,message:'Isolated fixture; no live enforcement claim.'}});
assert.equal(launchHash(baseline),hashRecord(baseline));assert.deepEqual(mapLaunchFacts(f.facts,f.after),DEFAULT_FACTS);
const proposal=prepareLaunchHandoff({facts:DEFAULT_FACTS,baselineView:view,launchAttemptId:randomUUID(),idempotencyKey:randomUUID()});
const request=ConfirmRequestSchema.parse(proposal.request);
const sandbox=mkdtempSync(path.join(tmpdir(),'mogs-lab-launch-compatibility-'));
try{
 const databasePath=path.join(sandbox,'remote/app.db'),legacyPath=path.join(sandbox,'legacy.db');
 const coordinator=new RemoteCoordinator({databasePath,legacyPath,actor:'test',clock:()=>new Date(FIXTURE_TIME)});
 const input={baseline,beforeFacts:f.facts,desiredFacts:f.after,config:f.run.config,pages,passages,mode:'fixture'};
 const started=coordinator.confirm(request,input);const replay=coordinator.confirm(request,input);assert.deepEqual(replay,started);
 assert.deepEqual(started.run.scope.assetIds,assets.map((a:any)=>a.assetId));assert.equal(started.attempt.desiredFactsHash,proposal.desiredFactsHash);assert.equal(started.run.mode,'fixture');
 const db=new RemoteDatabase(databasePath,{legacyPath,clock:()=>new Date(FIXTURE_TIME)});
 try{assert.equal(db.getSubmission(started.run.id),null);assert.equal(db.getGroup(started.run.id,'lab-group'),null);}finally{db.close();}
 assert.throws(()=>prepareLaunchHandoff({facts:{...DEFAULT_FACTS,monthlyCents:4500},baselineView:view,launchAttemptId:randomUUID(),idempotencyKey:randomUUID()}),/does not match/);
 const sources=['lib/runs/remote-types.ts','lib/runs/remote-api.ts','lib/runs/remote-service.ts','lib/types.ts','lib/facts/derive.ts','lib/hash.ts'];
 const report={verificationId,result:'passed',evidenceKind:'isolated-core-coordinator-fixture',createdAt:new Date().toISOString(),coreCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:core,encoding:'utf8'}).trim(),coreFiles:Object.fromEntries(sources.map(file=>[file,hash(readFileSync(path.join(core,file)))])),checks:['actual current v2 baseline and Confirm schemas accepted','lab facts equal canonical launch desired facts','stable hash parity','actual core coordinator created isolated fixture run','confirmation replay idempotent','only core inventory in launch run','no group approval or submission manufactured','unsupported $45 launch change rejected'],runId:started.run.id,launchAttemptId:started.attempt.id,assets:assets.length,proposal,publication:'none',liveDeploymentVerified:false};
 writeFileSync(evidenceFile,JSON.stringify(report,null,2)+'\n');
 process.stdout.write(JSON.stringify({result:'passed',checks:report.checks.length,coreCommit:report.coreCommit,runId:report.runId,assets:report.assets,publication:report.publication})+'\n');
}finally{rmSync(sandbox,{recursive:true,force:true});}

}catch(error){writeFileSync(evidenceFile,JSON.stringify({verificationId,result:'failed',evidenceKind:'isolated-core-coordinator-fixture',createdAt:new Date().toISOString(),error:error instanceof Error?error.message:'Verification failed',publication:'none'},null,2)+'\n');throw error;}
