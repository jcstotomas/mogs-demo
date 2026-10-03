import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseSource, renderSource, extractRenderedAsset } from './assets/source';
import { confirmedFacts, initialFacts, targetForKind } from './facts/derive';
import { hashRecord } from './hash';
import { emptyStats, memberHash } from './runs/contracts';
import { CheckNameSchema, EvalReportSchema, GroupSchema, JudgmentSchema, PatchSchema, PublicationSchema, RunSchema, type Judgment, type ManifestRow, type Surface } from './types';
export const FIXTURE_TIME = '2026-10-03T19:00:00.000Z';
export function fixtureAssets(root = process.cwd()) {
  const specs: { fixture: string; file: string; surface: Surface; url: string }[] = [
    { fixture: 'site-roundtrip.md', file: 'site/contract.md', surface: 'web', url: 'http://localhost:3000/site/contract' },
    { fixture: 'email-onboarding.md', file: 'email/onboarding.md', surface: 'email', url: 'http://localhost:3000/assets/email/onboarding' },
    { fixture: 'email-eligible.md', file: 'email/eligible.md', surface: 'email', url: 'http://localhost:3000/assets/email/eligible' },
  ];
  return specs.map(spec => { const source = readFileSync(path.join(root, 'fixtures/sources', spec.fixture), 'utf8'); const asset = parseSource(source, spec.file, spec.surface); return { asset, ...extractRenderedAsset(renderSource(asset), spec.url, FIXTURE_TIME) }; });
}
export function buildFixtures() {
  const facts = initialFacts(), after = confirmedFacts(facts), assets = fixtureAssets(), pages = assets.map(a => a.page), passages = assets.flatMap(a => a.passages);
  const config = { adapter: 'frontier' as const, connection: 'anthropic_direct' as const, fixConnection: 'anthropic_direct' as const, judgeModel: 'claude-sonnet-5-5', fixModel: 'claude-sonnet-5-5', tRel: 0.2, tLabel: 0.7, concurrency: 4, timeoutMs: 20000, promptVersion: 'step0-v1' as const };
  const run = RunSchema.parse({ id: 'fixture-run', changeId: facts.change.id, factVersion: after.version, mode: 'fixture', scope: { assetIds: pages.map(p => p.assetId), urls: pages.map(p => p.url), corpusHash: hashRecord(pages.map(p => [p.assetId, p.sourceHash])) }, config, confirmedAt: FIXTURE_TIME, status: 'drafting', stats: emptyStats(), errors: [], updatedAt: FIXTURE_TIME });
  const pricePassages = passages.filter(p => p.sourceId === 'starter-price');
  const judgments = pricePassages.map(p => { const label = p.assetId.includes('eligible.md') ? 'valid_exception' : 'contradicting'; return JudgmentSchema.parse({ runId: run.id, passageId: p.id, factVersion: after.version, relevant: 0.99, kind: 'direct_price', audience: p.surface === 'email' && label === 'valid_exception' ? 'existing_customers' : 'new_customers', billing: 'monthly', label, confidence: null, probabilities: null, confidenceSource: 'unavailable', adapter: 'frontier', model: config.judgeModel, escalatedBy: null }); });
  for (const p of passages.filter(p => p.sourceId !== 'starter-price')) {
    const savings = p.sourceId === 'starter-savings';
    judgments.push(JudgmentSchema.parse({ runId: run.id, passageId: p.id, factVersion: after.version, relevant: savings ? 0.99 : 0, kind: savings ? 'annual_savings' : 'none', audience: pages.find(page => page.assetId === p.assetId)!.meta.audienceHint, billing: savings ? 'annual' : 'unspecified', label: savings ? 'contradicting' : 'unrelated', confidence: null, probabilities: null, confidenceSource: 'unavailable', adapter: 'frontier', model: config.judgeModel, escalatedBy: null }));
  }
  const patches = pricePassages.filter(p => !p.assetId.includes('eligible.md')).map((p, idx) => { const page = pages.find(page => page.assetId === p.assetId)!; return PatchSchema.parse({ id: 'fixture-patch-' + idx, runId: run.id, passageId: p.id, sourceId: p.sourceId, assetId: p.assetId, url: p.url, surface: p.surface, factVersion: after.version, kind: 'direct_price', target: targetForKind('direct_price', after), original: p.text, replacement: 'Starter is $40 a month.', rationale: 'Fixture: update the public monthly offer.', withholdReason: null, originalCapturedFileHash: page.sourceHash, expectedFileHash: page.sourceHash, expectedBlockHash: p.blockHash, expectedContextHash: p.contextHash, expectedMetadataHash: page.metadataHash, checks: CheckNameSchema.options.filter(name => name !== 'tokens_kept' || p.surface === 'email').map(name => ({ name, pass: true, detail: 'Fixture only, not a live provider result.' })), revision: 0, status: 'drafted', groupId: 'fixture-group', editedByHuman: false }); });
  const group = GroupSchema.parse({ id: 'fixture-group', runId: run.id, factVersion: after.version, key: '2:direct_price:40:usd:public', title: 'Starter public monthly price $30 to $40', memberIds: patches.map(p => p.id), eligibleIds: patches.map(p => p.id), excludedIds: [], bySurface: { web: { eligible: 1, excluded: 0 }, email: { eligible: 1, excluded: 0 } }, membershipHash: memberHash(patches.map(p => p.id)), revision: 0, sealedAt: FIXTURE_TIME, status: 'sealed', publicationId: null });
  run.stats.assetsIndexed = pages.length;
  run.stats.passagesIndexed = passages.length;
  run.stats.candidates = passages.length; // This fixture deliberately retains every block.
  run.stats.judged = judgments.length;
  run.stats.patchesDrafted = patches.length;
  run.stats.groups = 1;
  run.stats.firstSealedGroupMs = 0;
  for (const page of pages) run.stats.bySurface[page.surface].assets++;
  for (const p of passages) run.stats.bySurface[p.surface].passages++;
  for (const j of judgments) {
    run.stats.byLabel[j.label]++;
    if (j.label === 'contradicting') run.stats.bySurface[passages.find(p => p.id === j.passageId)!.surface].contradictions++;
  }
  for (const p of patches) run.stats.bySurface[p.surface].patches++;
  const publication = PublicationSchema.parse({ id: 'fixture-publication', runId: run.id, groupId: group.id, factVersion: after.version, idempotencyKey: 'fixture-approve', requestFingerprint: hashRecord({ runId: run.id, expectedRevision: 0, idempotencyKey: 'fixture-approve' }), approvedRevision: 0, approvedMemberIds: group.eligibleIds, actor: 'test', status: 'prepared', files: [], verification: [], createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME, failure: null });
  const manifest: ManifestRow[] = pricePassages.map((p, idx) => ({ id: 'fixture-row-' + idx, passageId: p.id, sourceId: p.sourceId, assetId: p.assetId, url: p.url, surface: p.surface, text: p.text, kind: 'direct_price', templateId: 'fixture-direct-pair', expectedLabel: judgments[idx].label, target: judgments[idx].label === 'contradicting' ? targetForKind('direct_price', after) : null, expectedReplacement: judgments[idx].label === 'contradicting' ? 'Starter is $40 a month.' : null, expectedWithhold: null, split: 'featured', author: 'agent', scenarioId: facts.scenarioId, expectedFactVersion: after.version }));
  const evaluation = EvalReportSchema.parse({ id: 'fixture-eval', runId: run.id, status: 'fixture', corpusHash: run.scope.corpusHash, labelHash: hashRecord(manifest), factHash: hashRecord(after), factVersion: after.version, config, contentRoot: 'data/eval/fixture/content', databasePath: 'data/eval/fixture/app.db', baseUrl: 'http://localhost:3100', scriptedApprovals: [], metrics: { detection: { numerator: 0, denominator: 0 } }, missingIds: [], errors: [], createdAt: FIXTURE_TIME });
  return { facts, after, assets, pages, passages, run, judgments, patches, group, publication, manifest, evaluation };
}
export function fixtureJudgmentForReplacement(original: Judgment): Judgment { return JudgmentSchema.parse({ ...original, label: 'consistent', probabilities: original.adapter === 'jev' ? { contradicting: 0.01, consistent: 0.96, valid_exception: 0.01, unrelated: 0.01, insufficient_context: 0.01 } : null }); }
