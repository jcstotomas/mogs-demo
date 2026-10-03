import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMiniatureEvaluation, type MiniaturePreparationInput } from '../lib/metrics/remote-preparation';
import { hashRecord, sha256 } from '../lib/hash';

function input(): MiniaturePreparationInput {
  return { sourceCommit: 'a'.repeat(40), seedManifestText: readFileSync('content/seed.json', 'utf8'), seedFactsText: readFileSync('data/seed/facts.json', 'utf8'), manifestText: readFileSync('content/manifest.jsonl', 'utf8'), registryText: readFileSync('fixtures/remote/coverage-miniature.json', 'utf8') };
}

test('isolated preparation freezes pristine sources, explicit desired facts and unscored miniature denominators', () => {
  const result = prepareMiniatureEvaluation(input());
  assert.equal(result.beforeFacts.plans.starter.monthlyCents, 3000);
  assert.equal(result.desiredFacts.plans.starter.monthlyCents, 4000);
  assert.equal(result.beforeFacts.version, 1); assert.equal(result.desiredFacts.version, 2);
  assert.equal(result.summary.status, 'prepared'); assert.equal(result.summary.evidenceKind, 'fixture_preparation');
  assert.deepEqual(result.summary.scope, { editableAssets: 3, editablePassages: 33, canonicalPricingAssets: 1, allAssets: 4, allPassages: 40 });
  assert.deepEqual(result.summary.expected, { featuredCases: 33, contradictions: 6, deterministicRepairs: 5, withheld: 1 });
  assert.ok(result.summary.independentHeldout.every(kind => kind.families === 0 && kind.eligibility === 'not_eligible'));
  assert.equal(result.summary.metrics, null); assert.equal(result.summary.publicationMode, null); assert.equal(result.summary.evaluationRunId, null);
  assert.ok(result.sources['site/launch.md'].includes('Starter is $30 a month.'));
  assert.equal(Object.keys(result.sources).length, 3);
});

test('changed seed/facts/label/registry bytes are rejected rather than evaluating mutable rehearsal state', () => {
  const mutations = [
    (f: MiniaturePreparationInput) => { f.seedFactsText += '\n'; },
    (f: MiniaturePreparationInput) => { f.manifestText += '\n'; },
    (f: MiniaturePreparationInput) => { f.seedManifestText = f.seedManifestText.replace('Starter is $30 a month.', 'Starter is $40 a month.'); },
    (f: MiniaturePreparationInput) => { f.registryText = f.registryText.replace('Starter is $30 a month.', 'Starter is $40 a month.'); },
  ];
  for (const mutate of mutations) { const f = input(); mutate(f); assert.throws(() => prepareMiniatureEvaluation(f)); }
});

test('a newly hashed manifest still must agree with independent frozen labels and desired targets', () => {
  const f = input(), rows = f.manifestText.trim().split('\n').map(line => JSON.parse(line));
  rows.find(row => row.passageId === 'web:site/launch.md#starter-price').expectedLabel = 'consistent';
  f.manifestText = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  const seed = JSON.parse(f.seedManifestText); seed.manifestHash = sha256(f.manifestText); f.seedManifestText = JSON.stringify(seed);
  const registry = JSON.parse(f.registryText); registry.labelHash = seed.manifestHash;
  const { registryHash: _old, ...payload } = registry; registry.registryHash = hashRecord(payload); f.registryText = JSON.stringify(registry);
  assert.throws(() => prepareMiniatureEvaluation(f), /Manifest\/registry label mismatch/);
});
