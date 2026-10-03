import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSource, renderSource, extractRenderedAsset } from '../lib/assets/source';
import { hashRecord, sha256 } from '../lib/hash';
import { CoverageRegistrySchema, DETERMINISTIC_KINDS, assertCoverageResolution, freezeCoverageRegistry, scoreCoverage, type CoverageOutcome, type CoverageRegistry, type CoverageRegistryInput } from '../lib/metrics/coverage-contract';

const fixture = CoverageRegistrySchema.parse(JSON.parse(readFileSync('fixtures/remote/coverage-miniature.json', 'utf8')));
function payload(registry: CoverageRegistry): CoverageRegistryInput { const { registryHash: _hash, ...data } = structuredClone(registry); return data; }
/** Fake identities test the scoring contract; they are not planted corpus cases or provider evidence. */
function syntheticHeldout(): CoverageRegistry {
  const data = payload(fixture);
  data.id = 'synthetic-contract-scoring-only';
  for (const kind of DETERMINISTIC_KINDS) for (let i = 1; i <= 5; i++) {
    const familyId = `synthetic-${kind}-${i}`, assetId = `web:site/${familyId.replaceAll('_', '-')}.md`, sourceId = 'contract-case';
    const text = `Synthetic ${kind} family ${i}: the stale assertion.`, passageId = assetId + '#' + sourceId;
    data.assets.push({ assetId, surface: 'web', editable: true, sourceHash: sha256(text) });
    data.cases.push({ passageId, assetId, sourceId, surface: 'web', editable: true, text, textHash: sha256(text), kind, expectedLabel: 'contradicting', target: data.targets[kind], expectedReplacement: text.replace('stale', 'checked'), expectedWithhold: null, familyId, templateId: familyId, split: 'heldout', authoredBy: 'agent' });
    data.families.push({ familyId, kind, templateId: familyId, split: 'heldout', authoredBy: 'agent', memberPassageIds: [passageId], representativePassageId: passageId });
  }
  return freezeCoverageRegistry(data);
}
function completeOutcomes(registry: CoverageRegistry): CoverageOutcome[] {
  return registry.cases.map(item => {
    const repair = item.expectedLabel === 'contradicting' && item.target !== null;
    return { passageId: item.passageId, status: 'complete', detected: item.expectedLabel === 'contradicting', checkedRepair: repair, previewVerified: repair, productionVerified: repair, proposed: repair };
  });
}

test('miniature coverage registry is fixture evidence with zero independent held-out representatives', () => {
  assert.equal(fixture.evidenceKind, 'fixture');
  assert.equal(fixture.assets.length, 3);
  assert.equal(fixture.cases.length, 33);
  assert.equal(fixture.families.length, 17);
  const score = scoreCoverage(fixture, []);
  assert.equal(score.independentGateEligibility, 'not_eligible');
  for (const item of score.perKind) {
    assert.equal(item.independentFamilies, 0);
    assert.equal(item.requiredSuccesses, null);
    for (const metric of Object.values(item.metrics)) assert.deepEqual(metric, { numerator: 0, denominator: 0, pass: null });
  }
});

test('every miniature registry passage resolves once against pristine source and exact hashes', () => {
  const seed = JSON.parse(readFileSync('fixtures/remote/miniature/seed.json', 'utf8')) as { sources: Record<string, { source: string; hash: string }> };
  const observed = Object.entries(seed.sources).map(([file, value]) => extractRenderedAsset(renderSource(parseSource(value.source, file, file.startsWith('site/') ? 'web' : 'email')), 'http://localhost:3000/' + file.slice(0, -3)));
  const passages = observed.flatMap(item => item.passages), assets = observed.map(item => item.page);
  assertCoverageResolution(fixture, passages, assets);
  assert.throws(() => assertCoverageResolution(fixture, passages.slice(1), assets), /exactly once/);
  assert.throws(() => assertCoverageResolution(fixture, [...passages, passages[0]], assets), /exactly once/);
  assert.throws(() => assertCoverageResolution(fixture, passages.map((item, index) => index ? item : { ...item, text: 'Externally changed.' }), assets), /source mismatch/);
  assert.throws(() => assertCoverageResolution(fixture, passages, assets.map((item, index) => index ? item : { ...item, sourceHash: sha256('wrong') })), /source hashes/);
});

test('registry hash protects labels, split, membership and selected representatives', () => {
  const tampered = structuredClone(fixture);
  tampered.cases[0].expectedLabel = 'consistent';
  assert.throws(() => CoverageRegistrySchema.parse(tampered), /immutable payload/);
  const { registryHash, ...data } = fixture;
  assert.equal(registryHash, hashRecord(data));
});

test('representatives must resolve once to eligible deterministic editable-web contradictions', () => {
  const registry = syntheticHeldout(), family = registry.families.find(item => item.representativePassageId !== null)!;
  const missing = payload(registry); missing.families.find(item => item.familyId === family.familyId)!.representativePassageId = 'web:site/missing.md#missing';
  assert.throws(() => freezeCoverageRegistry(missing), /resolve once/);
  const duplicate = payload(registry); duplicate.cases.push(structuredClone(duplicate.cases.find(item => item.passageId === family.representativePassageId)!));
  assert.throws(() => freezeCoverageRegistry(duplicate), /Duplicate passage/);
  const readonly = payload(registry), selected = readonly.cases.find(item => item.passageId === family.representativePassageId)!;
  selected.editable = false; readonly.assets.find(item => item.assetId === selected.assetId)!.editable = false;
  assert.throws(() => freezeCoverageRegistry(readonly), /editable-web/);
  const protectedCase = payload(registry), protectedSelected = protectedCase.cases.find(item => item.passageId === family.representativePassageId)!;
  protectedSelected.expectedLabel = 'consistent'; protectedSelected.target = null; protectedSelected.expectedReplacement = null;
  assert.throws(() => freezeCoverageRegistry(protectedCase), /eligible contradiction/);
  const wrongTarget = payload(registry); wrongTarget.cases.find(item => item.passageId === family.representativePassageId)!.target!.value = 999;
  assert.throws(() => freezeCoverageRegistry(wrongTarget), /pinned desired values/);
});

test('featured and tuning selections cannot enter held-out independent gates', () => {
  const data = payload(fixture), direct = data.families.find(item => item.familyId === 'featured-direct-pair')!;
  direct.representativePassageId = 'web:site/launch.md#starter-price';
  assert.throws(() => freezeCoverageRegistry(data), /Featured\/tuning/);
  const synthetic = payload(syntheticHeldout()), selected = synthetic.families.find(item => item.representativePassageId !== null)!;
  selected.split = 'tuning'; for (const item of synthetic.cases.filter(item => item.familyId === selected.familyId)) item.split = 'tuning';
  assert.throws(() => freezeCoverageRegistry(synthetic), /Featured\/tuning/);
});

test('copies stay in one family and contribute workload rows without another independent success', () => {
  const data = payload(syntheticHeldout()), original = data.cases.find(item => item.split === 'heldout')!, family = data.families.find(item => item.familyId === original.familyId)!;
  const assetId = 'web:site/synthetic-copy.md', passageId = assetId + '#' + original.sourceId;
  data.assets.push({ assetId, surface: 'web', editable: true, sourceHash: sha256('synthetic copied asset') });
  data.cases.push({ ...original, assetId, passageId }); family.memberPassageIds.push(passageId);
  const copied = freezeCoverageRegistry(data), score = scoreCoverage(copied, completeOutcomes(copied));
  assert.equal(score.perKind.find(item => item.kind === original.kind)!.independentFamilies, 5);
  assert.equal(score.perKind.find(item => item.kind === original.kind)!.metrics.detected.denominator, 5);
  assert.equal(score.workload.heldoutContradictingWebRows, 21);
  const inflated = payload(copied), copiedCase = inflated.cases.find(item => item.passageId === passageId)!;
  copiedCase.familyId = 'inflated-copy'; copiedCase.templateId = 'inflated-copy';
  inflated.families.find(item => item.familyId === original.familyId)!.memberPassageIds = [original.passageId];
  inflated.families.push({ familyId: 'inflated-copy', templateId: 'inflated-copy', kind: original.kind, split: 'heldout', authoredBy: 'agent', memberPassageIds: [passageId], representativePassageId: passageId });
  assert.throws(() => freezeCoverageRegistry(inflated), /Identical wording/);
});

test('synthetic five-family per-kind gates require four successes using the same full denominator', () => {
  const registry = syntheticHeldout(), representatives = new Set(registry.families.filter(item => item.representativePassageId !== null && item.kind === 'direct_price').map(item => item.representativePassageId!));
  const outcomes = completeOutcomes(registry).filter(item => item.passageId !== [...representatives][0]);
  const passing = scoreCoverage(registry, outcomes).perKind.find(item => item.kind === 'direct_price')!;
  assert.equal(passing.requiredSuccesses, 4);
  for (const metric of Object.values(passing.metrics)) assert.deepEqual(metric, { numerator: 4, denominator: 5, pass: true });
  const three = scoreCoverage(registry, outcomes.filter(item => item.passageId !== [...representatives][1])).perKind.find(item => item.kind === 'direct_price')!;
  for (const metric of Object.values(three.metrics)) assert.deepEqual(metric, { numerator: 3, denominator: 5, pass: false });
  const observed = completeOutcomes(registry), failedId = [...representatives][0];
  const separated = scoreCoverage(registry, observed.map(item => item.passageId === failedId ? { ...item, productionVerified: false } : item)).perKind.find(item => item.kind === 'direct_price')!;
  assert.equal(separated.metrics.previewVerified.numerator, 5);
  assert.equal(separated.metrics.productionVerified.numerator, 4);
});

test('filtered/error/withheld deterministic results and protected proposals cannot disappear from denominators', () => {
  const registry = syntheticHeldout(), ids = registry.families.filter(item => item.kind === 'per_day' && item.representativePassageId !== null).map(item => item.representativePassageId!);
  const outcomes = completeOutcomes(registry).map(item => item.passageId === ids[0] ? { ...item, status: 'filtered' as const, detected: false, checkedRepair: false, previewVerified: false, productionVerified: false, proposed: false } : item.passageId === ids[1] ? { ...item, checkedRepair: false, previewVerified: false, productionVerified: false, proposed: false } : item);
  const score = scoreCoverage(registry, outcomes), daily = score.perKind.find(item => item.kind === 'per_day')!;
  assert.deepEqual(daily.metrics.detected, { numerator: 4, denominator: 5, pass: true });
  assert.deepEqual(daily.metrics.checkedRepair, { numerator: 3, denominator: 5, pass: false });
  const errored = scoreCoverage(registry, outcomes.map(item => item.passageId === ids[2] ? { ...item, status: 'error' as const, detected: false, checkedRepair: false, previewVerified: false, productionVerified: false } : item)).perKind.find(item => item.kind === 'per_day')!;
  assert.deepEqual(errored.metrics.detected, { numerator: 3, denominator: 5, pass: false });
  for (const surface of ['web', 'email']) for (const label of ['consistent', 'valid_exception', 'unrelated', 'insufficient_context']) assert.ok(score.protections.find(item => item.surface === surface && item.label === label)!.denominator > 0);
  const ambiguous = registry.cases.find(item => item.expectedLabel === 'insufficient_context' && item.surface === 'email')!;
  const unsafe = scoreCoverage(registry, outcomes.map(item => item.passageId === ambiguous.passageId ? { ...item, proposed: true } : item));
  assert.equal(unsafe.protections.find(item => item.surface === 'email' && item.label === 'insufficient_context')!.pass, false);
  const unresolved = scoreCoverage(registry, outcomes.filter(item => item.passageId !== ambiguous.passageId));
  assert.equal(unresolved.protections.find(item => item.surface === 'email' && item.label === 'insufficient_context')!.unresolved, 1);
  assert.equal(unresolved.protections.find(item => item.surface === 'email' && item.label === 'insufficient_context')!.pass, false);
});
