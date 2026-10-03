import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_FACTS } from '../src/contracts.ts';
import { PACKAGE_ROOT } from '../src/store.ts';
import { launchHash,prepareLaunchHandoff } from '../src/launch-compatibility.ts';
const before=JSON.parse(readFileSync(path.join(PACKAGE_ROOT,'fixtures/facts/facts.initial.json'),'utf8'));
const desired=JSON.parse(readFileSync(path.join(PACKAGE_ROOT,'fixtures/facts/facts.confirmed.json'),'utf8'));
const baseline={baseSha:'a'.repeat(40),deployedSha:'a'.repeat(40),factsHash:launchHash(before)};
const view={contractVersion:2,baseline,baselineHash:launchHash(baseline),beforeFacts:before,desiredFacts:desired,activeRunId:null,enforcement:{available:true,message:'Fixture only'}};
const input={facts:DEFAULT_FACTS,baselineView:view,launchAttemptId:'12345678-1234-4123-8123-123456789abc',idempotencyKey:'compatibility-test'};
test('launch handoff preserves v2 identity, fact version and human boundaries',()=>{process.env.MOGS_MULTICHANNEL_ENABLED='1';try{const result=prepareLaunchHandoff(input);assert.equal(result.endpoint,'/api/v2/facts');assert.equal(result.request.expectedFactVersion,1);assert.equal(result.request.baselineHash,view.baselineHash);assert.equal(result.carriesLabPatches,false);assert.equal(result.requiresHumanConfirm,true);assert.equal(result.desiredFactsHash,launchHash(desired));}finally{delete process.env.MOGS_MULTICHANNEL_ENABLED;}});
test('launch handoff rejects disabled, changed facts, stale baseline, busy and unenforced launch',()=>{delete process.env.MOGS_MULTICHANNEL_ENABLED;assert.throws(()=>prepareLaunchHandoff(input),/disabled/);process.env.MOGS_MULTICHANNEL_ENABLED='1';try{
 assert.throws(()=>prepareLaunchHandoff({...input,facts:{...DEFAULT_FACTS,monthlyCents:4500}}),/does not match/);
 for(const altered of [{...view,baselineHash:'0'.repeat(64)},{...view,activeRunId:'run-active'},{...view,enforcement:{available:false,message:'not configured'}},{...view,desiredFacts:{...desired,effectiveDate:'2030-01-01'}}])assert.throws(()=>prepareLaunchHandoff({...input,baselineView:altered}));
}finally{delete process.env.MOGS_MULTICHANNEL_ENABLED;}});
