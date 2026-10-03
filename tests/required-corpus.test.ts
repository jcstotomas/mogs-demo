import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareRequiredEvaluation } from '../lib/metrics/remote-preparation';
import { parseSource, renderSource, extractRenderedAsset } from '../lib/assets/source';
import { prefilter } from '../lib/pipeline';

const input = () => ({ sourceCommit: 'a'.repeat(40), seedManifestText: readFileSync('content/seed.json', 'utf8'), seedFactsText: readFileSync('data/seed/facts.json', 'utf8'), manifestText: readFileSync('content/manifest.jsonl', 'utf8'), registryText: readFileSync('fixtures/remote/coverage-required-22.json', 'utf8') });

test('required corpus resolves 22 assets, pristine miniature images and all independent representatives before provider execution', () => {
  const prepared = prepareRequiredEvaluation(input());
  assert.deepEqual(prepared.summary.scope, { editableAssets: 21, editablePassages: 103, canonicalPricingAssets: 1, allAssets: 22, allPassages: 110 });
  assert.deepEqual(prepared.summary.expected, { featuredCases: 33, contradictions: 40, deterministicRepairs: 37, withheld: 3 });
  assert.ok(prepared.summary.independentHeldout.every(item => item.families === 5 && item.eligibility === 'eligible'));
  assert.equal(prepared.summary.metrics, null);
  const miniature = JSON.parse(readFileSync('fixtures/remote/miniature/seed.json', 'utf8'));
  for (const [file, image] of Object.entries(miniature.sources) as Array<[string, { source: string }]>) assert.equal(prepared.sources[file], image.source);
  const allPassages = Object.entries(prepared.sources).flatMap(([file, source]) => {
    const asset = parseSource(source, file, file.startsWith('site/') ? 'web' : 'email');
    return extractRenderedAsset(renderSource(asset), 'http://127.0.0.1:3100/' + file.slice(0, -3)).passages;
  });
  assert.equal(allPassages.length, 103);
  for (const family of prepared.registry.families.filter(item => item.representativePassageId !== null)) {
    const passage = allPassages.find(item => item.id === family.representativePassageId);
    assert.ok(passage && prefilter(passage), family.familyId + ' must stay in the candidate denominator');
  }
  const unknown = allPassages.find(item => item.id === 'web:site/account-rules.md#unknown-eligibility')!;
  assert.ok(![unknown.heading, unknown.before, unknown.after].some(text => text?.includes('before 2026-10-03')));
  const eligiblePreheader = prepared.registry.cases.find(item => item.passageId === 'email:email/eligible.md#email-preheader')!;
  assert.equal(eligiblePreheader.expectedLabel, 'unrelated');
  assert.equal(eligiblePreheader.kind, 'none');
});

test('required preparation rejects changed inventory and labels rather than shrinking the frozen workload', () => {
  const missing = input(), seed = JSON.parse(missing.seedManifestText);
  delete seed.sources['site/starter-offer.md'];
  missing.seedManifestText = JSON.stringify(seed);
  assert.throws(() => prepareRequiredEvaluation(missing));
  const relabeled = input(); relabeled.manifestText = relabeled.manifestText.replace('"expectedLabel":"contradicting"', '"expectedLabel":"consistent"');
  assert.throws(() => prepareRequiredEvaluation(relabeled));
});
