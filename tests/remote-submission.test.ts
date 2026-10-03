import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { buildRemoteFixtures, seedRemoteFixtureDatabase, fixtureCombinedJudge, REMOTE_FIXTURE_TIME } from '../lib/runs/remote-fixtures';
import { RemoteDatabase } from '../lib/runs/remote-db';
import { assembleCandidate, assertSameBaseline } from '../lib/submission/candidate';
import { assembleRestoration } from '../lib/submission/restoration';
import { RemoteRecovery, type RecoveryRemote, type PullRequestState } from '../lib/submission/recovery';
import { assertStatusAllowed, EnforcementEvidenceSchema } from '../lib/submission/enforcement';
import { createPublicArtifact, createDeploymentMetadata } from '../lib/deployment/public-artifact';
import { observeBaseline } from '../lib/deployment/provenance';
import { BaselineSchema, DeploymentObservationSchema, SubmissionSchema, StatusEvidenceSchema, type Submission, type Baseline } from '../lib/runs/remote-types';
import { hashRecord, sha256 } from '../lib/hash';
import { extractRenderedAsset } from '../lib/assets/source';

const clock = () => new Date(REMOTE_FIXTURE_TIME);
function setup() { const f = buildRemoteFixtures(), db = new RemoteDatabase(':memory:', { clock }); seedRemoteFixtureDatabase(db, f); return { f, db }; }
async function submit(db: RemoteDatabase, f: ReturnType<typeof buildRemoteFixtures>) {
  const bundle = await assembleCandidate(db.export(f.state.run.id), f.baseSources, f.state.attempt.baseline, fixtureCombinedJudge(f), REMOTE_FIXTURE_TIME);
  const candidate = { ...bundle.candidate, candidateSha: sha256(bundle.candidate.commitMessage + bundle.candidate.treeHash).slice(0, 40) };
  const submission = SubmissionSchema.parse({ id: 'submission-' + f.state.attempt.id, launchAttemptId: f.state.attempt.id, runId: f.state.run.id, candidate, revision: 0, status: 'submitted', journal: 'pr_opened', operationId: 'fixture-operation', requestFingerprint: hashRecord({ fixture: candidate.id }), prNumber: 1, prUrl: 'https://github.com/jcstotomas/mogs-demo/pull/1', observedHeadSha: candidate.candidateSha, failure: null, createdAt: REMOTE_FIXTURE_TIME, updatedAt: REMOTE_FIXTURE_TIME });
  db.putSubmission(submission); return { submission, bundle };
}
class FakeRemote implements RecoveryRemote {
  pr: PullRequestState; failures: Array<{ sha: string; context: string }> = []; statuses = new Map<string, ReturnType<typeof StatusEvidenceSchema.parse>>();
  closeCalls = 0; readCalls = 0; loseCloseOnce = false; mergeOnRead: number | null = null;
  constructor(readonly f: ReturnType<typeof buildRemoteFixtures>, readonly submission: Submission) { this.pr = { number: submission.prNumber!, url: submission.prUrl!, headSha: submission.candidate.candidateSha!, baseSha: submission.candidate.baseSha, state: 'open', mergedSha: null }; }
  async readPullRequest() { this.readCalls++; if (this.readCalls === this.mergeOnRead) { this.pr.mergedSha = 'd'.repeat(40); this.pr.state = 'closed'; } return structuredClone(this.pr); }
  async postFailure(_s: Submission, sha: string, context: 'mogs/candidate' | 'mogs/preview', evidenceHash: string) { const status = StatusEvidenceSchema.parse({ context, sha, state: 'failure', producerAppId: this.f.state.attempt.baseline.target.statusProducerAppId, evidenceHash, statusUrl: 'https://fixture.invalid/status', at: REMOTE_FIXTURE_TIME }); this.failures.push({ sha, context }); this.statuses.set(sha + context, status); return status; }
  async readStatuses(_s: Submission, sha: string) { return [...this.statuses.values()].filter(status => status.sha === sha); }
  async closePullRequest() { this.closeCalls++; this.pr.state = 'closed'; if (this.loseCloseOnce) { this.loseCloseOnce = false; throw new Error('Lost close response after fake remote closure.'); } }
  async observeProduction(_s: Submission, deploymentId: string) { const before = this.f.state.facts.find(value => value.phase === 'before')!.snapshot; return DeploymentObservationSchema.parse({ id: 'fixture-failed-production', launchAttemptId: this.f.state.attempt.id, submissionId: this.submission.id, environment: 'production', deploymentId, url: 'https://mogs-fixture.invalid', candidateSha: this.submission.candidate.candidateSha, mergedSha: this.pr.mergedSha, deployedSha: this.pr.mergedSha, readiness: 'ready', verification: 'failed', inventoryHash: this.f.state.attempt.baseline.inventoryHash, factsHash: hashRecord(before), publishedFacts: before, sourceHashes: Object.fromEntries(this.f.state.attempt.baseline.assets.map(asset => [asset.assetId, asset.sourceHash])), blocks: [], failures: ['Synthetic deployment still exposes initial $30 facts.'], observedAt: REMOTE_FIXTURE_TIME }); }
}
function abandonRequest(f: ReturnType<typeof buildRemoteFixtures>, submission: Submission) { return { contractVersion: 2 as const, launchAttemptId: f.state.attempt.id, runId: f.state.run.id, expectedAttemptRevision: 0, expectedSubmissionRevision: submission.revision, idempotencyKey: 'fixture-abandon-' + f.state.attempt.id, reason: 'Provider-free recovery fixture.' }; }
function enforcement(baseline: Baseline, sha: string) { return EnforcementEvidenceSchema.parse({ repository: baseline.target.repository, baseRef: baseline.target.baseRef, producerAppId: baseline.target.statusProducerAppId, checks: ['mogs/candidate', 'mogs/preview'].map(context => ({ context, appId: baseline.target.statusProducerAppId })), strict: true, enforceAdmins: true, bypassActors: [], mergeQueue: false, autoMerge: false, probes: { pendingBlocked: true, failureBlocked: true, wrongHeadBlocked: true, currentHeadEligible: true }, testedSha: sha, verifiedAt: REMOTE_FIXTURE_TIME }); }

test('miniature combines four same-file corrections and onboarding while preserving the eligible email and threshold', async () => {
  const { f, db } = setup();
  try {
    const seen: string[] = [], bundle = await assembleCandidate(db.export(f.state.run.id), f.baseSources, f.state.attempt.baseline, fixtureCombinedJudge(f, p => { seen.push(p.id); if (p.sourceId === 'starter-price' && p.surface === 'web') assert.equal(p.after, 'Save 40% on Starter with annual billing.'); if (p.sourceId === 'annual-savings') assert.equal(p.before, 'Starter is $40 a month.'); }), REMOTE_FIXTURE_TIME);
    assert.equal(seen.length, 5);
    assert.deepEqual(bundle.candidate.files.map(file => file.path), ['content/email/onboarding.md', 'content/site/launch.md', 'data/facts.json']);
    assert.equal(bundle.images['content/email/eligible.md'], undefined);
    const web = extractRenderedAsset(createPublicArtifact({ sourceCommit: 'b'.repeat(40), mode: 'commit', seedManifestText: readFileSync('content/seed.json', 'utf8'), factText: bundle.images['data/facts.json'], sourceTexts: { ...f.baseSources, 'site/launch.md': bundle.images['content/site/launch.md'], 'email/onboarding.md': bundle.images['content/email/onboarding.md'] } }).routes.find(route => route.pathname === '/site/launch')!.html, 'https://mogs-fixture.invalid/site/launch');
    assert.equal(web.passages.find(p => p.sourceId === 'threshold')!.text, 'Get started for under $35 a month, billed monthly.');
    for (const p of f.state.passages.filter(p => p.assetId === 'web:site/launch.md' && !f.state.patches.some(patch => patch.passageId === p.id && patch.status === 'drafted'))) assert.equal(web.passages.find(observed => observed.id === p.id)!.text, p.text);
    assert.match(bundle.images['content/email/onboarding.md'], /\{\{ first_name \}\}/);
    assert.match(bundle.images['content/email/onboarding.md'], /ref=onboarding&step=1/);
    assert.equal(db.reviewActionCount(f.state.run.id), 0);
  } finally { db.close(); }
});

test('tampered approval, missing approval and wrong-model final judgment reject candidate assembly', async () => {
  const f = buildRemoteFixtures();
  const stale = structuredClone(f.state); stale.approvals[0].checkedPatchHash = sha256('tampered');
  await assert.rejects(assembleCandidate(stale, f.baseSources, f.state.attempt.baseline, fixtureCombinedJudge(f)), /Approval/);
  const unapproved = structuredClone(f.state); unapproved.groups[0].status = 'sealed'; unapproved.groups[0].approvalId = null;
  await assert.rejects(assembleCandidate(unapproved, f.baseSources, f.state.attempt.baseline, fixtureCombinedJudge(f)), /approval/i);
  await assert.rejects(assembleCandidate(f.state, f.baseSources, f.state.attempt.baseline, async (...args) => ({ ...await fixtureCombinedJudge(f)(...args), model: 'wrong-model' })), /failed checks/);
});

test('candidate checks the entire baseline, including an untouched protected source; timestamp-only re-observation remains fresh', async () => {
  const f = buildRemoteFixtures();
  assertSameBaseline(f.state.attempt.baseline, { ...f.state.attempt.baseline, observedAt: '2026-10-03T19:02:00.000Z' });
  await assert.rejects(assembleCandidate(f.state, { ...f.baseSources, 'email/eligible.md': f.baseSources['email/eligible.md'] + '\n' }, f.state.attempt.baseline, fixtureCombinedJudge(f)), /source missing or changed/);
  await assert.rejects(assembleCandidate(f.state, f.baseSources, { ...f.state.attempt.baseline, deployedSha: 'c'.repeat(40) }, fixtureCombinedJudge(f)), /Stale baseline/);
});

test('baseline observer checks exact rendered text on every asset, not just source hash metadata', async () => {
  const f = buildRemoteFixtures(), artifact = createPublicArtifact({ sourceCommit: f.state.attempt.baseline.baseSha, mode: 'seed', seedManifestText: readFileSync('content/seed.json', 'utf8'), factText: f.seedFactsText });
  const metadata = createDeploymentMetadata(JSON.stringify(artifact)), requests: string[] = [];
  const fakeFetch = (corrupt = false) => async (input: Parameters<typeof fetch>[0]) => { const pathname = new URL(String(input)).pathname; requests.push(pathname); const route = artifact.routes.find(route => route.pathname === pathname)!; const html = route.html + '<script type="application/json" id="deployment-meta">' + JSON.stringify(metadata) + '</script>'; return new Response(corrupt && pathname === '/assets/email/eligible' ? html.replace('Starter is $30 a month.', 'Starter is $999 a month.') : html, { status: 200, headers: { 'Content-Type': 'text/html' } }); };
  await observeBaseline(f.state.attempt.baseline, { sources: f.baseSources, publishedFacts: f.state.facts[0].snapshot, fetch: fakeFetch() as typeof fetch });
  assert.equal(requests.length, 4);
  await assert.rejects(observeBaseline(f.state.attempt.baseline, { sources: f.baseSources, publishedFacts: f.state.facts[0].snapshot, fetch: fakeFetch(true) as typeof fetch }), /Rendered text/);
  await assert.rejects(observeBaseline(f.state.attempt.baseline, { sources: { ...f.baseSources, 'email/eligible.md': f.baseSources['email/eligible.md'] + '\n' }, publishedFacts: f.state.facts[0].snapshot, fetch: fakeFetch() as typeof fetch }), /Source bytes differ/);
  const unmarked = async (input: Parameters<typeof fetch>[0]) => { const response = await fakeFetch()(input); return new Response((await response.text()).replace('</main>', '<p>Unmarked stale offer: $5 a month.</p></main>'), { status: 200, headers: { 'Content-Type': 'text/html' } }); };
  await assert.rejects(observeBaseline(f.state.attempt.baseline, { sources: f.baseSources, publishedFacts: f.state.facts[0].snapshot, fetch: unmarked as typeof fetch }), /Rendered text/);
});

test('lost close response keeps the active slot; replay observes closure with one human action', async () => {
  const { f, db } = setup();
  try {
    const { submission } = await submit(db, f), remote = new FakeRemote(f, submission); remote.loseCloseOnce = true;
    const recovery = new RemoteRecovery(db, remote, clock), request = abandonRequest(f, submission);
    assert.equal((await recovery.abandon(request)).status, 'unknown');
    assert.equal(db.activeAttempt(f.state.attempt.baseline.target)!.state, 'abandoning');
    assert.equal(db.reviewActionCount(f.state.run.id), 1);
    assert.equal((await recovery.abandon(request)).status, 'reconciled');
    assert.equal(db.activeAttempt(f.state.attempt.baseline.target), null);
    assert.equal(remote.closeCalls, 1);
    assert.equal(db.reviewActionCount(f.state.run.id), 1);
  } finally { db.close(); }
});

test('changed head retires both contexts on both SHAs; a fresh same-content attempt cannot re-enable the abandoned PR', async () => {
  const { f, db } = setup();
  try {
    const { submission } = await submit(db, f), remote = new FakeRemote(f, submission); remote.pr.headSha = 'c'.repeat(40);
    const recovery = new RemoteRecovery(db, remote, clock);
    assert.equal((await recovery.abandon(abandonRequest(f, submission))).status, 'reconciled');
    for (const sha of [submission.candidate.candidateSha!, remote.pr.headSha]) for (const context of ['mogs/candidate', 'mogs/preview']) assert.ok(remote.failures.some(status => status.sha === sha && status.context === context));
    const second = buildRemoteFixtures(randomUUID()); seedRemoteFixtureDatabase(db, second);
    const next = await submit(db, second);
    assert.equal(next.bundle.candidate.treeHash, (await assembleCandidate(f.state, f.baseSources, f.state.attempt.baseline, fixtureCombinedJudge(f))).candidate.treeHash);
    assert.notEqual(next.submission.candidate.candidateSha, submission.candidate.candidateSha);
    assert.notEqual(next.submission.candidate.branch, submission.candidate.branch);
    assert.throws(() => assertStatusAllowed(db.getAttempt(f.state.attempt.id)!, db.getSubmission(f.state.run.id)!, submission.candidate.candidateSha!, 'mogs/candidate', 'success', enforcement(f.state.attempt.baseline, submission.candidate.candidateSha!)), /Inactive/);
    assertStatusAllowed(db.getAttempt(second.state.attempt.id)!, next.submission, next.submission.candidate.candidateSha!, 'mogs/candidate', 'success', enforcement(second.state.attempt.baseline, next.submission.candidate.candidateSha!));
  } finally { db.close(); }
});

test('merge race remains locked until explicit reconciliation records actual failed deployed facts without source writes', async () => {
  const { f, db } = setup(), originalSources = hashRecord(buildRemoteFixtures().baseSources);
  try {
    const { submission } = await submit(db, f), remote = new FakeRemote(f, submission); remote.mergeOnRead = 2;
    const recovery = new RemoteRecovery(db, remote, clock);
    assert.equal((await recovery.abandon(abandonRequest(f, submission))).status, 'merged_observed');
    const current = db.getAttempt(f.state.attempt.id)!; assert.equal(current.state, 'merged_failure');
    assert.throws(() => seedRemoteFixtureDatabase(db, buildRemoteFixtures(randomUUID())), /already owns/);
    const request = { contractVersion: 2 as const, launchAttemptId: current.id, runId: current.runId, expectedAttemptRevision: current.revision, observedDeploymentId: 'fixture-failed-live-deployment', idempotencyKey: 'fixture-reconcile-merged-failure', reason: 'Record the synthetic actual old facts, not desired facts.' };
    assert.equal((await recovery.reconcile(request)).status, 'reconciled');
    assert.equal(db.getAttempt(current.id)!.state, 'reconciled_failure');
    assert.equal(db.observations(current.runId)[0].publishedFacts!.plans.starter.monthlyCents, 3000);
    assert.equal(db.observations(current.runId)[0].verification, 'failed');
    assert.equal(hashRecord(buildRemoteFixtures().baseSources), originalSources);
    assert.equal(db.reviewActionCount(current.runId), 2);
  } finally { db.close(); }
});

test('restoration shares the active target, restores exact seed bytes, and contributes no correction metrics', async () => {
  const { f, db } = setup();
  try {
    const { bundle, submission } = await submit(db, f), desiredText = bundle.images['data/facts.json'];
    const currentSources = { ...f.baseSources, 'site/launch.md': bundle.images['content/site/launch.md'], 'email/onboarding.md': bundle.images['content/email/onboarding.md'] };
    const artifact = createPublicArtifact({ sourceCommit: submission.candidate.candidateSha!, mode: 'commit', seedManifestText: readFileSync('content/seed.json', 'utf8'), factText: desiredText, sourceTexts: currentSources });
    const baseline = BaselineSchema.parse({ ...f.state.attempt.baseline, baseSha: artifact.sourceCommit, deployedSha: artifact.sourceCommit, inventoryHash: artifact.inventoryHash, factsHash: artifact.factsHash, factsFileHash: artifact.factsFileHash, assets: artifact.assets });
    const restoreAttempt = { ...f.state.attempt, id: randomUUID(), runId: 'fixture-restore-run', purpose: 'restoration' as const, seedRevision: 'e'.repeat(40), baseline, baselineHash: hashRecord(baseline), beforeFactsHash: artifact.factsHash, desiredFactsHash: f.state.attempt.beforeFactsHash };
    assert.throws(() => db.putAttempt(restoreAttempt), /already owns/);
    const restored = assembleRestoration(restoreAttempt, baseline, currentSources, f.seed, f.seedFactsText, REMOTE_FIXTURE_TIME);
    assert.equal(restored.candidate.purpose, 'restoration'); assert.deepEqual(restored.candidate.approvals, []); assert.deepEqual(restored.checks, {});
    assert.equal(restored.images['content/site/launch.md'], f.baseSources['site/launch.md']);
    assert.equal(restored.images['content/email/onboarding.md'], f.baseSources['email/onboarding.md']);
    assert.equal(restored.images['content/email/eligible.md'], undefined);
    assert.equal(restored.images['data/facts.json'], f.seedFactsText);
    assert.throws(() => assembleRestoration(restoreAttempt, baseline, currentSources, { sources: { ...f.seed.sources, 'site/extra.md': f.seed.sources['site/launch.md'] } }, f.seedFactsText), /extra assets/);
    assert.equal(restored.candidate.files.find(file => file.path === 'data/facts.json')!.beforeHash, artifact.factsFileHash);
  } finally { db.close(); }
});
