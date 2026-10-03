import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { createPublicArtifact } from '../deployment/public-artifact';
import { extractRenderedAsset } from '../assets/source';
import { confirmedFacts, targetForKind } from '../facts/derive';
import { hashRecord } from '../hash';
import { prefilter } from '../pipeline';
import { CheckNameSchema, FactSnapshotSchema, ProviderConfigSchema, type Judgment, type Passage } from '../types';
import { assembleCandidate, checkedPatchHash, type CandidateJudge } from '../submission/candidate';
import { emptyStats } from './contracts';
import { type RemoteDatabase } from './remote-db';
import { ApprovalSchema, BaselineSchema, LaunchAttemptSchema, RemoteExportSchema, RemoteGroupSchema, RemoteJudgmentSchema, RemotePatchSchema, RemoteRunSchema, ConfirmRequestSchema, ApproveRequestSchema, SubmitRequestSchema, AbandonRequestSchema, ReconcileRequestSchema, RestoreRequestSchema, SubmissionSchema, RecoverySchema, RemoteErrorSchema, type RemoteExport } from './remote-types';

export const REMOTE_FIXTURE_TIME = '2026-10-03T19:00:00.000Z';
export const REMOTE_FIXTURE_SHA = 'a'.repeat(40); // Synthetic test identity; never an observed Git/deployment commit.
export const REMOTE_FIXTURE_ATTEMPT = '00000000-0000-4000-8000-000000000001';
const readyAt = '2026-10-03T19:01:00.000Z';
const fixtureConfig = ProviderConfigSchema.parse({ adapter: 'frontier', connection: 'anthropic_direct', fixConnection: 'anthropic_direct', judgeModel: 'claude-sonnet-5-5', fixModel: 'claude-sonnet-5-5', tRel: 0.2, tLabel: 0.7, concurrency: 4, timeoutMs: 30000, promptVersion: 'gate1-v2' });
export interface RemoteFixtures { state: RemoteExport; baseSources: Record<string, string>; seed: { sources: Record<string, { source: string; hash: string }> }; seedFactsText: string }

/** Provider-free DTO fixture only. Fabricated judgments/checks are not model or remote gate evidence. */
export function buildRemoteFixtures(attemptId = REMOTE_FIXTURE_ATTEMPT): RemoteFixtures {
  const seedManifestText = readFileSync('content/seed.json', 'utf8'), seedFactsText = readFileSync('data/seed/facts.json', 'utf8');
  const seed = JSON.parse(seedManifestText) as RemoteFixtures['seed'] & { corpusHash: string };
  const before = FactSnapshotSchema.parse(JSON.parse(seedFactsText)), desired = confirmedFacts(before);
  const artifact = createPublicArtifact({ sourceCommit: REMOTE_FIXTURE_SHA, mode: 'seed', seedManifestText, factText: seedFactsText });
  const origin = 'https://mogs-fixture.invalid';
  const baseline = BaselineSchema.parse({ target: { repository: 'jcstotomas/mogs-demo', baseRef: 'main', productionOrigin: origin, vercelProjectId: 'fixture-project', vercelTeamId: 'fixture-team', statusProducerAppId: 12345 }, baseSha: REMOTE_FIXTURE_SHA, deployedSha: REMOTE_FIXTURE_SHA, deploymentId: 'fixture-deployment', deploymentUrl: origin, observedAt: REMOTE_FIXTURE_TIME, inventoryHash: artifact.inventoryHash, corpusHash: seed.corpusHash, factsHash: artifact.factsHash, factsFileHash: artifact.factsFileHash, assets: artifact.assets });
  const baselineHash = hashRecord(baseline), runId = 'fixture-run-' + attemptId;
  const attempt = LaunchAttemptSchema.parse({ contractVersion: 2, id: attemptId, runId, purpose: 'correction', seedRevision: null, baseline, baselineHash, beforeFactsHash: hashRecord(before), desiredFactsHash: hashRecord(desired), state: 'active', revision: 0, confirmedAt: REMOTE_FIXTURE_TIME, recoveryId: null, closedAt: null, closureReason: null });
  const extracted = artifact.routes.map(route => extractRenderedAsset(route.html, origin + route.pathname, REMOTE_FIXTURE_TIME));
  const pages = extracted.map(item => item.page), passages = extracted.flatMap(item => item.passages);
  const manifest = readFileSync('content/manifest.jsonl', 'utf8').trim().split('\n').map(line => JSON.parse(line) as { passageId: string; expectedLabel: Judgment['label']; kind: Judgment['kind']; expectedReplacement: string | null; expectedWithhold: string | null });
  const filteredPassageIds = passages.filter(p => !prefilter(p)).map(p => p.id);
  const judgments = passages.filter(prefilter).map(p => {
    const expected = manifest.find(row => row.passageId === p.id);
    const canonical = p.assetId === 'web:site/pricing.md';
    const label = expected?.expectedLabel ?? (canonical && p.sourceId === 'starter-monthly' ? 'contradicting' : canonical && p.sourceId === 'legacy-rule' ? 'valid_exception' : canonical && p.sourceId === 'starter-annual' ? 'consistent' : 'unrelated');
    const kind = expected?.kind ?? (canonical && ['starter-monthly', 'legacy-rule'].includes(p.sourceId) ? 'direct_price' : canonical && p.sourceId === 'starter-annual' ? 'other_pricing' : 'none');
    return RemoteJudgmentSchema.parse({ contractVersion: 2, launchAttemptId: attemptId, runId, passageId: p.id, factVersion: desired.version, relevant: label === 'unrelated' ? 0 : 1, kind, audience: p.sourceId === 'historical' ? 'historical' : pages.find(page => page.assetId === p.assetId)!.meta.audienceHint, billing: kind === 'annual_savings' || p.sourceId === 'annual-price' || p.sourceId === 'starter-annual' ? 'annual' : kind === 'other_pricing' || kind === 'none' ? 'unspecified' : 'monthly', label, confidence: null, probabilities: null, confidenceSource: 'unavailable', adapter: 'frontier', model: fixtureConfig.judgeModel, escalatedBy: null });
  });
  const patches = manifest.filter(row => row.expectedReplacement || row.expectedWithhold).map(row => {
    const p = passages.find(item => item.id === row.passageId)!, page = pages.find(item => item.assetId === p.assetId)!;
    const target = targetForKind(row.kind, desired), groupId = row.expectedReplacement ? 'fixture-group-' + attemptId + '-' + row.kind : null;
    return RemotePatchSchema.parse({ contractVersion: 2, launchAttemptId: attemptId, id: 'fixture-patch-' + p.id, runId, passageId: p.id, sourceId: p.sourceId, assetId: p.assetId, url: p.url, surface: p.surface, factVersion: desired.version, kind: row.kind, target, original: p.text, replacement: row.expectedReplacement, rationale: row.expectedReplacement ? 'Fabricated checked correction for contract fixture only.' : null, withholdReason: row.expectedWithhold, originalCapturedFileHash: page.sourceHash, expectedFileHash: page.sourceHash, expectedBlockHash: p.blockHash, expectedContextHash: p.contextHash, expectedMetadataHash: page.metadataHash, checks: row.expectedReplacement ? CheckNameSchema.options.filter(name => name !== 'tokens_kept' || p.surface === 'email').map(name => ({ name, pass: true, detail: 'Fabricated fixture check; no live provider result.' })) : [], revision: 0, status: row.expectedReplacement ? 'drafted' : 'withheld', groupId, editedByHuman: false });
  });
  const groups = ['direct_price', 'annual_savings', 'per_day', 'plan_gap'].map(kind => {
    const members = patches.filter(p => p.kind === kind && p.groupId), memberIds = members.map(p => p.id), target = members[0].target!;
    return RemoteGroupSchema.parse({ contractVersion: 2, id: members[0].groupId, runId, launchAttemptId: attemptId, factVersion: desired.version, key: [desired.version, kind, target.value, target.unit, target.scope].join(':'), title: 'Fixture ' + kind, memberIds, eligibleIds: memberIds, excludedIds: [], membershipHash: hashRecord([...memberIds].sort()), revision: 0, sealedAt: readyAt, status: 'approved', approvalId: 'fixture-approval-' + attemptId + '-' + kind });
  });
  const approvals = groups.map(group => ApprovalSchema.parse({ id: group.approvalId, launchAttemptId: attemptId, runId, groupId: group.id, revision: group.revision, membershipHash: group.membershipHash, eligibleIds: group.eligibleIds, desiredFactsHash: attempt.desiredFactsHash, actor: 'test', at: readyAt, requestFingerprint: hashRecord({ fixtureGroup: group.id }), checkedPatchHash: checkedPatchHash(patches.filter(p => group.eligibleIds.includes(p.id))) }));
  const stats = emptyStats();
  stats.assetsIndexed = pages.length; stats.passagesIndexed = passages.length; stats.candidates = judgments.length; stats.judged = judgments.length; stats.patchesDrafted = patches.filter(p => p.status === 'drafted').length; stats.withheld = patches.filter(p => p.status === 'withheld').length; stats.groups = groups.length; stats.machineMs = 60000; stats.firstSealedGroupMs = 60000; stats.allResultsReadyMs = 60000;
  for (const page of pages) stats.bySurface[page.surface].assets++;
  for (const p of passages) stats.bySurface[p.surface].passages++;
  for (const j of judgments) { stats.byLabel[j.label]++; if (j.label === 'contradicting') stats.bySurface[passages.find(p => p.id === j.passageId)!.surface].contradictions++; }
  for (const p of patches.filter(p => p.status === 'drafted')) stats.bySurface[p.surface].patches++;
  const run = RemoteRunSchema.parse({ contractVersion: 2, id: runId, launchAttemptId: attemptId, changeId: before.change.id, desiredFactVersion: desired.version, mode: 'fixture', baselineHash, scope: { assetIds: baseline.assets.map(asset => asset.assetId), urls: baseline.assets.map(asset => origin + asset.pathname), corpusHash: baseline.corpusHash, inventoryHash: baseline.inventoryHash }, config: fixtureConfig, confirmedAt: REMOTE_FIXTURE_TIME, deadlineAt: '2026-10-03T19:03:00.000Z', fullRunDeadlineMs: 180000, status: 'ready', filteredPassageIds, stats, errors: [], updatedAt: readyAt });
  const state = RemoteExportSchema.parse({ contractVersion: 2, attempt, facts: [{ launchAttemptId: attemptId, phase: 'before', version: before.version, hash: attempt.beforeFactsHash, snapshot: before }, { launchAttemptId: attemptId, phase: 'desired', version: desired.version, hash: attempt.desiredFactsHash, snapshot: desired }], run, pages, passages, groups, patches, judgments, approvals, submission: null, candidateChecks: null, observations: [], recoveries: [], reviewEvents: [] });
  return { state, baseSources: Object.fromEntries(Object.entries(seed.sources).map(([file, value]) => [file, value.source])), seed, seedFactsText };
}

/** Populate only an explicitly supplied test database; never opens the live v2 path. */
export function seedRemoteFixtureDatabase(db: RemoteDatabase, fixture: RemoteFixtures): void {
  const { state } = fixture;
  db.putAttempt(state.attempt);
  for (const facts of state.facts) db.putFacts(facts);
  db.putRun({ ...state.run, status: 'collecting', filteredPassageIds: [], stats: emptyStats(), updatedAt: REMOTE_FIXTURE_TIME });
  for (const page of state.pages) db.putPage(state.run.id, page);
  for (const p of state.passages) db.putPassage(state.run.id, p);
  db.putRun({ ...state.run, status: 'classifying', filteredPassageIds: [], stats: emptyStats(), updatedAt: REMOTE_FIXTURE_TIME });
  for (const j of state.judgments) db.putJudgment(j);
  db.putRun({ ...state.run, status: 'drafting' });
  for (const group of state.groups) db.putGroup({ ...group, status: 'collecting', sealedAt: null, approvalId: null });
  for (const p of state.patches) db.putPatch(p);
  for (const group of state.groups) db.putGroup({ ...group, status: 'sealed', approvalId: null });
  db.putRun(state.run);
  for (const approval of state.approvals) db.putApproval(approval);
  for (const group of state.groups) db.putGroup(group);
}
export function fixtureCombinedJudge(fixture: RemoteFixtures, inspect?: (p: Passage) => void): CandidateJudge {
  return async (_runId, passage) => {
    inspect?.(passage);
    const original = fixture.state.judgments.find(j => j.passageId === passage.id);
    if (!original) throw new Error('Fixture replacement has no synthetic judgment.');
    const { contractVersion: _v, launchAttemptId: _a, ...judgment } = original;
    return { ...judgment, label: 'consistent' }; // Explicitly synthetic; not a provider call.
  };
}


export const RemoteApiFixtureSchema = z.object({
  contractVersion: z.literal(2), evidenceKind: z.literal('fixture'), notice: z.string(), routes: z.record(z.string(), z.string()),
  requests: z.object({ confirm: ConfirmRequestSchema, approve: ApproveRequestSchema, submit: SubmitRequestSchema, abandon: AbandonRequestSchema, reconcile: ReconcileRequestSchema, restore: RestoreRequestSchema }).strict(),
  responses: z.object({ restore: z.object({ attempt: LaunchAttemptSchema, run: RemoteRunSchema }).strict(), confirm: z.object({ attempt: LaunchAttemptSchema, run: RemoteRunSchema }).strict(), approve: z.object({ approval: ApprovalSchema }).strict(), submit: z.object({ submission: SubmissionSchema }).strict(), abandon: z.object({ recovery: RecoverySchema }).strict(), reconcile: z.object({ recovery: RecoverySchema }).strict() }).strict(),
  export: RemoteExportSchema,
  errors: z.array(z.object({ httpStatus: z.number().int(), body: RemoteErrorSchema }).strict()).min(1),
}).strict();
export async function buildRemoteApiFixtures() {
  const f = buildRemoteFixtures(), { state } = f;
  const bundle = await assembleCandidate(state, f.baseSources, state.attempt.baseline, fixtureCombinedJudge(f), REMOTE_FIXTURE_TIME);
  const candidate = { ...bundle.candidate, candidateSha: 'b'.repeat(40) }; // Synthetic fixture SHA; no Git/PR write.
  const submission = SubmissionSchema.parse({ id: 'fixture-submission', launchAttemptId: state.attempt.id, runId: state.run.id, candidate, revision: 0, status: 'submitted', journal: 'pr_opened', operationId: 'fixture-submit-operation', requestFingerprint: hashRecord({ fixtureCandidate: candidate.id }), prNumber: 1, prUrl: 'https://github.com/jcstotomas/mogs-demo/pull/1', observedHeadSha: candidate.candidateSha, failure: null, createdAt: REMOTE_FIXTURE_TIME, updatedAt: REMOTE_FIXTURE_TIME });
  const changedArtifact = createPublicArtifact({ sourceCommit: candidate.candidateSha, mode: 'commit', seedManifestText: readFileSync('content/seed.json', 'utf8'), factText: bundle.images['data/facts.json'], sourceTexts: Object.fromEntries(Object.entries(f.baseSources).map(([file, source]) => [file, bundle.images['content/' + file] ?? source])) });
  const restoreBaseline = BaselineSchema.parse({ ...state.attempt.baseline, baseSha: changedArtifact.sourceCommit, deployedSha: changedArtifact.sourceCommit, inventoryHash: changedArtifact.inventoryHash, factsHash: changedArtifact.factsHash, factsFileHash: changedArtifact.factsFileHash, assets: changedArtifact.assets });
  const requests = {
    confirm: { contractVersion: 2, launchAttemptId: state.attempt.id, expectedFactVersion: 1, baselineHash: state.attempt.baselineHash, idempotencyKey: 'fixture-confirm-key' },
    approve: { contractVersion: 2, launchAttemptId: state.attempt.id, runId: state.run.id, expectedRevision: state.groups[0].revision, membershipHash: state.groups[0].membershipHash, idempotencyKey: 'fixture-approve-key' },
    submit: { contractVersion: 2, launchAttemptId: state.attempt.id, runId: state.run.id, expectedAttemptRevision: 0, baseSha: state.attempt.baseline.baseSha, bundleHash: candidate.bundleHash, approvals: state.groups.map(group => ({ groupId: group.id, revision: group.revision, membershipHash: group.membershipHash })), idempotencyKey: 'fixture-submit-key' },
    abandon: { contractVersion: 2, launchAttemptId: state.attempt.id, runId: state.run.id, expectedAttemptRevision: 0, expectedSubmissionRevision: 0, reason: 'Fixture stale submission; no real PR exists.', idempotencyKey: 'fixture-abandon-key' },
    reconcile: { contractVersion: 2, launchAttemptId: state.attempt.id, runId: state.run.id, expectedAttemptRevision: 2, observedDeploymentId: 'fixture-failed-deployment', reason: 'Fixture actual deployed state observation.', idempotencyKey: 'fixture-reconcile-key' },
    restore: { contractVersion: 2, launchAttemptId: '00000000-0000-4000-8000-000000000002', expectedFactVersion: 2, baselineHash: hashRecord(restoreBaseline), seedRevision: 'e'.repeat(40), idempotencyKey: 'fixture-restore-key' },
  };
  const restoreAttempt = LaunchAttemptSchema.parse({ ...state.attempt, id: requests.restore.launchAttemptId, runId: 'fixture-restoration-run', purpose: 'restoration', seedRevision: requests.restore.seedRevision, baseline: restoreBaseline, baselineHash: hashRecord(restoreBaseline), beforeFactsHash: state.attempt.desiredFactsHash, desiredFactsHash: state.attempt.beforeFactsHash });
  const restoreRun = RemoteRunSchema.parse({ ...state.run, id: restoreAttempt.runId, launchAttemptId: restoreAttempt.id, desiredFactVersion: 1, baselineHash: restoreAttempt.baselineHash, scope: { ...state.run.scope, assetIds: restoreBaseline.assets.map(asset => asset.assetId), urls: restoreBaseline.assets.map(asset => new URL(asset.pathname, restoreBaseline.target.productionOrigin).href), inventoryHash: restoreBaseline.inventoryHash }, status: 'collecting', filteredPassageIds: [], stats: emptyStats(), updatedAt: state.attempt.confirmedAt });
  const abandoned = RecoverySchema.parse({ id: 'fixture-abandon-operation', launchAttemptId: state.attempt.id, submissionId: submission.id, action: 'abandon', status: 'unknown', expectedAttemptRevision: 0, expectedSubmissionRevision: 0, requestFingerprint: hashRecord(requests.abandon), retiredShas: [candidate.candidateSha], statuses: [], prClosed: false, mergedSha: null, observedDeploymentId: null, failure: 'Synthetic lost close response; active slot remains locked.', createdAt: REMOTE_FIXTURE_TIME, updatedAt: REMOTE_FIXTURE_TIME });
  const reconciled = RecoverySchema.parse({ ...abandoned, id: 'fixture-reconcile-operation', action: 'reconcile', status: 'reconciled', expectedAttemptRevision: 2, requestFingerprint: hashRecord(requests.reconcile), retiredShas: [], mergedSha: 'd'.repeat(40), observedDeploymentId: requests.reconcile.observedDeploymentId, failure: null });
  return RemoteApiFixtureSchema.parse({ contractVersion: 2, evidenceKind: 'fixture', notice: 'Synthetic SHAs, provider labels/checks, timings, PR URL and deployment IDs are DTO examples only. No real remote operation or v2 gate was run.', routes: { confirm: 'POST /api/v2/facts', approve: 'POST /api/v2/groups/:id/approve', submit: 'POST /api/v2/runs/:id/submit', abandon: 'POST /api/v2/runs/:id/abandon', reconcile: 'POST /api/v2/runs/:id/reconcile', restore: 'POST /api/v2/restorations', export: 'GET /api/v2/runs/:id/export' }, requests, responses: { restore: { attempt: restoreAttempt, run: restoreRun }, confirm: { attempt: state.attempt, run: { ...state.run, status: 'collecting', filteredPassageIds: [], stats: emptyStats(), updatedAt: state.attempt.confirmedAt } }, approve: { approval: state.approvals[0] }, submit: { submission }, abandon: { recovery: abandoned }, reconcile: { recovery: reconciled } }, export: state, errors: [['validation', 400], ['not_found', 404], ['stale', 409], ['busy', 409], ['idempotency_conflict', 409], ['provider_failure', 502], ['remote_failure', 502], ['enforcement_unavailable', 503], ['unknown_remote_state', 409], ['interrupted', 409]].map(([code, httpStatus]) => ({ httpStatus, body: { error: { code, message: 'Fixture error: ' + code, retryable: ['provider_failure', 'remote_failure', 'unknown_remote_state', 'interrupted'].includes(String(code)) } } })) });
}
