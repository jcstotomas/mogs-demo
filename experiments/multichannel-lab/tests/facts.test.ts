import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_FACTS, hash } from '../src/contracts.ts';
const read=(name:string)=>JSON.parse(readFileSync(new URL('../fixtures/facts/'+name,import.meta.url),'utf8'));
test('default lab facts map exactly from immutable copied core fact fixtures',()=>{
 const initial=read('facts.initial.json'),desired=read('facts.confirmed.json');
 assert.deepEqual(DEFAULT_FACTS,{company:desired.company,plan:'Starter',beforeMonthlyCents:initial.plans.starter.monthlyCents,monthlyCents:desired.plans.starter.monthlyCents,annualCents:desired.plans.starter.annualCents,teamMonthlyCents:desired.plans.team.monthlyCents,legacyMonthlyCents:desired.change.legacyRateCents,legacyCutoff:desired.change.legacyCutoff});
 assert.equal(initial.change.legacyCutoff,desired.change.legacyCutoff);
});
test('immutable copied fact bytes match recorded origin hashes',()=>{
 const provenance=read('provenance.json');
 assert.equal(provenance.originCommit,'b9d167987747b1ff171c0ae368e0f98c02f9b2fa');
 for(const entry of provenance.files) assert.equal(hash(readFileSync(new URL('../fixtures/'+entry.copy,import.meta.url))),entry.sha256);
});
