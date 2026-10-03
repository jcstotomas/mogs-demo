import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { FactsSchema, hash, type Facts } from './contracts.ts';
import { PACKAGE_ROOT } from './store.ts';
import { assertEnabled } from './gate.ts';

// Mirrors lib/hash.ts deliberately; the lab's existing JSON hashes are a different contract.
export function launchStableJson(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(launchStableJson).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,val])=>JSON.stringify(key)+':'+launchStableJson(val)).join(',')+'}';
 return JSON.stringify(value);
}
export const launchHash=(value:unknown)=>hash(launchStableJson(value));
const Hash=z.string().regex(/^[a-f0-9]{64}$/);
const View=z.object({contractVersion:z.literal(2),baseline:z.object({baseSha:z.string().regex(/^[a-f0-9]{40}$/),deployedSha:z.string().regex(/^[a-f0-9]{40}$/),factsHash:Hash}).passthrough(),baselineHash:Hash,beforeFacts:z.unknown(),desiredFacts:z.unknown(),activeRunId:z.string().nullable(),enforcement:z.object({available:z.boolean(),message:z.string()})}).passthrough();
const Identity=z.object({launchAttemptId:z.uuid(),idempotencyKey:z.string().min(8).max(200)}).strict();
function copies(){return {before:JSON.parse(readFileSync(path.join(PACKAGE_ROOT,'fixtures/facts/facts.initial.json'),'utf8')),desired:JSON.parse(readFileSync(path.join(PACKAGE_ROOT,'fixtures/facts/facts.confirmed.json'),'utf8'))};}
export function mapLaunchFacts(before:any,desired:any):Facts {
 return FactsSchema.parse({company:desired.company,plan:'Starter',beforeMonthlyCents:before.plans.starter.monthlyCents,monthlyCents:desired.plans.starter.monthlyCents,annualCents:desired.plans.starter.annualCents,teamMonthlyCents:desired.plans.team.monthlyCents,legacyMonthlyCents:desired.change.legacyRateCents,legacyCutoff:desired.change.legacyCutoff});
}
/** Prepare only: no HTTP request, core database write, approval, submission, or merge. */
export function prepareLaunchHandoff(input:{facts:Facts;baselineView:unknown;launchAttemptId:string;idempotencyKey:string}) {
 assertEnabled();const facts=FactsSchema.parse(input.facts),view=View.parse(input.baselineView),identity=Identity.parse({launchAttemptId:input.launchAttemptId,idempotencyKey:input.idempotencyKey});
 if(launchHash(view.baseline)!==view.baselineHash||view.baseline.baseSha!==view.baseline.deployedSha)throw new Error('Refresh the launch baseline: its hash or deployed commit does not match.');
 if(view.activeRunId)throw new Error('The launch system already has an active run. Continue that run before preparing a new correction.');
 if(!view.enforcement.available)throw new Error('Launch merge checks are not ready: '+view.enforcement.message);
 const expected=copies();
 if(launchHash(view.beforeFacts)!==launchHash(expected.before)||launchHash(view.desiredFacts)!==launchHash(expected.desired))throw new Error('The launch fact contract has changed. Refresh compatibility before preparing this correction.');
 if(view.baseline.factsHash!==launchHash(view.beforeFacts))throw new Error('Observed launch facts do not match the baseline.');
 if(launchHash(facts)!==launchHash(mapLaunchFacts(expected.before,expected.desired)))throw new Error('This lab request does not match the launch system’s fixed Starter $30 to $40 change and protected facts.');
 return {
  kind:'launch-confirmation-proposal' as const,
  endpoint:'/api/v2/facts',method:'POST' as const,
  request:{contractVersion:2 as const,...identity,expectedFactVersion:1 as const,baselineHash:view.baselineHash},
  desiredFactsHash:launchHash(view.desiredFacts),
  baselineVerification:'Caller-supplied observation; the launch coordinator revalidates it on Confirm.',
  requiresHumanConfirm:true,
  carriesLabPatches:false,
  subsequentGates:['Full launch-corpus classification and checked drafts','Human approval of current complete groups','One checked PR per run','Separate human GitHub merge','Observed deployment and rendered verification'],
 };
}
