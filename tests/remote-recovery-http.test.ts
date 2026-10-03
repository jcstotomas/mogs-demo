import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRemoteHttpHandlers, type RemoteHttpRuntime } from '../app/api/v2/_lib/dispatch';
import { RemoteBaselineViewSchema, RemoteCandidateViewSchema, RemoteObserveRequestSchema } from '../lib/runs/remote-api';
import { RemoteDatabase } from '../lib/runs/remote-db';
import { RemoteCoordinator } from '../lib/runs/remote-service';
import { createPublicArtifact } from '../lib/deployment/public-artifact';
import { buildRemoteFixtures, seedRemoteFixtureDatabase, fixtureCombinedJudge, REMOTE_FIXTURE_TIME } from '../lib/runs/remote-fixtures';
import { DeploymentObservationSchema, RecoverySchema, RemoteErrorSchema, RemoteExportSchema, StatusEvidenceSchema, SubmissionSchema, type Submission } from '../lib/runs/remote-types';
import { assembleCandidate } from '../lib/submission/candidate';
import { RemoteRecovery, type RecoveryRemote, type PullRequestState } from '../lib/submission/recovery';
import { hashRecord, sha256 } from '../lib/hash';

// These tests use fabricated remote identities and no network/provider calls.
// They prove dispatch + durable recovery wiring, never an actual remote exercise.
const clock = () => new Date(REMOTE_FIXTURE_TIME);
const request = (runId: string, action: 'abandon' | 'reconcile', body: unknown) => new Request(`http://localhost:3104/api/v2/runs/${runId}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3104' }, body: JSON.stringify(body) });
const context = (runId: string) => ({ params: Promise.resolve({ runId }) });

class FakeRemote implements RecoveryRemote {
  pr: PullRequestState;
  readonly effects: string[] = [];
  readonly statuses = new Map<string, ReturnType<typeof StatusEvidenceSchema.parse>>();
  closeCalls = 0;
  readCalls = 0;
  observeCalls = 0;
  loseCloseOnce = false;
  mergeOnRead: number | null = null;
  observationOverrides: Partial<ReturnType<typeof DeploymentObservationSchema.parse>> = {};
  constructor(readonly fixture: ReturnType<typeof buildRemoteFixtures>, readonly submission: Submission) {
    this.pr = { number: submission.prNumber!, url: submission.prUrl!, headSha: submission.candidate.candidateSha!, baseSha: submission.candidate.baseSha, state: 'open', mergedSha: null };
  }
  async readPullRequest() {
    this.readCalls++;
    if (this.readCalls === this.mergeOnRead) { this.pr.state = 'closed'; this.pr.mergedSha = 'd'.repeat(40); }
    return structuredClone(this.pr);
  }
  async postFailure(_submission: Submission, sha: string, statusContext: 'mogs/candidate' | 'mogs/preview', evidenceHash: string) {
    this.effects.push(`failure:${sha}:${statusContext}`);
    const status = StatusEvidenceSchema.parse({ context: statusContext, sha, state: 'failure', producerAppId: this.fixture.state.attempt.baseline.target.statusProducerAppId, evidenceHash, statusUrl: 'https://fixture.invalid/status', at: REMOTE_FIXTURE_TIME });
    this.statuses.set(`${sha}:${statusContext}`, status);
    return status;
  }
  async readStatuses(_submission: Submission, sha: string) { return [...this.statuses.values()].filter(status => status.sha === sha); }
  async closePullRequest() {
    this.closeCalls++;
    this.effects.push('close');
    this.pr.state = 'closed';
    if (this.loseCloseOnce) { this.loseCloseOnce = false; throw new Error('Synthetic close response lost after fixture PR closed.'); }
  }
  async observeProduction(_submission: Submission, deploymentId: string) {
    this.observeCalls++;
    const before = this.fixture.state.facts.find(facts => facts.phase === 'before')!.snapshot;
    return DeploymentObservationSchema.parse({ id: 'fixture-failed-production', launchAttemptId: this.fixture.state.attempt.id, submissionId: this.submission.id, environment: 'production', deploymentId, url: 'https://mogs-fixture.invalid', candidateSha: this.submission.candidate.candidateSha, mergedSha: this.pr.mergedSha, deployedSha: this.pr.mergedSha, readiness: 'ready', verification: 'failed', inventoryHash: this.fixture.state.attempt.baseline.inventoryHash, factsHash: hashRecord(before), publishedFacts: before, sourceHashes: Object.fromEntries(this.fixture.state.attempt.baseline.assets.map(asset => [asset.assetId, asset.sourceHash])), blocks: [], failures: ['Fixture production still exposes initial $30 facts.'], observedAt: REMOTE_FIXTURE_TIME, ...this.observationOverrides });
  }
}

function handlers(db: RemoteDatabase, remote: FakeRemote, actor: 'human' | 'test' = 'human', restore?: RemoteHttpRuntime['restore']) {
  const recovery = new RemoteRecovery(db, remote, clock, actor);
  const unused = () => { throw new Error('Unexpected non-recovery dispatch.'); };
  const runtime: RemoteHttpRuntime = {
    baseline: async () => unused(), confirm: async () => unused(), approve: unused,
    run: runId => db.export(runId), candidate: async () => unused(), submit: async () => unused(),
    abandon: async input => ({ recovery: await recovery.abandon(input) }),
    reconcile: async input => ({ recovery: await recovery.reconcile(input) }),
    restore: restore ?? (async () => unused()), observe: async () => unused(),
  };
  return createRemoteHttpHandlers(runtime, { baseline: RemoteBaselineViewSchema, candidate: RemoteCandidateViewSchema, observe: RemoteObserveRequestSchema }, unused);
}

async function setup(mode: 'fixture' | 'live' = 'fixture') {
  const directory = mkdtempSync(path.join(tmpdir(), 'mogs-recovery-http-'));
  const databasePath = path.join(directory, 'fixture.sqlite');
  const db = new RemoteDatabase(databasePath, { clock }), fixture = buildRemoteFixtures();
  fixture.state.run.mode = mode;
  seedRemoteFixtureDatabase(db, fixture);
  const bundle = await assembleCandidate(db.export(fixture.state.run.id), fixture.baseSources, fixture.state.attempt.baseline, fixtureCombinedJudge(fixture), REMOTE_FIXTURE_TIME);
  const candidate = { ...bundle.candidate, candidateSha: sha256(bundle.candidate.commitMessage + bundle.candidate.treeHash).slice(0, 40) };
  const submission = SubmissionSchema.parse({ id: 'fixture-submission-' + fixture.state.attempt.id, launchAttemptId: fixture.state.attempt.id, runId: fixture.state.run.id, candidate, revision: 0, status: 'submitted', journal: 'pr_opened', operationId: 'fixture-operation', requestFingerprint: hashRecord({ fixture: candidate.id }), prNumber: 1, prUrl: 'https://github.com/jcstotomas/mogs-demo/pull/1', observedHeadSha: candidate.candidateSha, failure: null, createdAt: REMOTE_FIXTURE_TIME, updatedAt: REMOTE_FIXTURE_TIME });
  db.putSubmission(submission);
  const remote = new FakeRemote(fixture, submission);
  return { directory, databasePath, db, fixture, submission, bundle, remote };
}
function abandonBody(fixture: ReturnType<typeof buildRemoteFixtures>, submission: Submission) {
  return { contractVersion: 2, launchAttemptId: fixture.state.attempt.id, runId: fixture.state.run.id, expectedAttemptRevision: 0, expectedSubmissionRevision: submission.revision, idempotencyKey: 'fixture-http-abandon-' + fixture.state.attempt.id, reason: 'Explicit fixture retirement of a stale submitted candidate.' };
}
async function recoveryBody(response: Response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['recovery']);
  return RecoverySchema.parse(body.recovery);
}

test('fixture HTTP abandonment retires candidate/current heads before confirmed close and releases the SQLite target slot', async () => {
  const h = await setup(), runId = h.fixture.state.run.id;
  try {
    h.remote.pr.headSha = 'c'.repeat(40);
    const result = await recoveryBody(await handlers(h.db, h.remote).postAbandon(request(runId, 'abandon', abandonBody(h.fixture, h.submission)), context(runId)));
    assert.equal(result.status, 'reconciled');
    assert.equal(result.prClosed, true);
    assert.deepEqual(result.retiredShas, [h.submission.candidate.candidateSha, h.remote.pr.headSha]);
    const expected = result.retiredShas.flatMap(sha => ['mogs/candidate', 'mogs/preview'].map(statusContext => `failure:${sha}:${statusContext}`));
    assert.deepEqual(h.remote.effects, [...expected, 'close']);
    assert.equal(result.statuses.length, 4);
    assert.ok(result.statuses.every(status => status.state === 'failure' && status.producerAppId === h.fixture.state.attempt.baseline.target.statusProducerAppId));
    assert.equal(h.db.getAttempt(h.fixture.state.attempt.id)!.state, 'abandoned');
    assert.equal(h.db.getSubmission(runId)!.status, 'closed');
    assert.equal(h.db.activeAttempt(h.fixture.state.attempt.baseline.target), null);
    const exported = RemoteExportSchema.parse(h.db.export(runId));
    assert.equal(exported.run.mode, 'fixture');
    assert.equal(exported.submission!.prUrl, h.submission.prUrl);
    assert.deepEqual(exported.approvals, h.fixture.state.approvals);
    assert.equal(exported.reviewEvents.length, 1);
    // Reservation succeeds only after remote retirement and PR closure readback.
    seedRemoteFixtureDatabase(h.db, buildRemoteFixtures(randomUUID()));
  } finally { h.db.close(); rmSync(h.directory, { recursive: true, force: true }); }
});

test('fixture HTTP close-response loss stays locked across restart; identical retry observes closure without duplicate review or close', async () => {
  const h = await setup(), runId = h.fixture.state.run.id, body = abandonBody(h.fixture, h.submission);
  let db = h.db;
  try {
    h.remote.loseCloseOnce = true;
    const first = await recoveryBody(await handlers(db, h.remote).postAbandon(request(runId, 'abandon', body), context(runId)));
    assert.equal(first.status, 'unknown');
    assert.equal(first.prClosed, false);
    assert.equal(h.remote.pr.state, 'closed');
    assert.equal(db.activeAttempt(h.fixture.state.attempt.baseline.target)!.state, 'abandoning');
    assert.equal(db.getSubmission(runId)!.status, 'submitted');
    assert.throws(() => db.putAttempt(buildRemoteFixtures(randomUUID()).state.attempt), /already owns/);
    db.close(); db = new RemoteDatabase(h.databasePath, { clock });
    assert.equal(db.getRecovery(first.id)!.status, 'unknown');
    const resumed = await recoveryBody(await handlers(db, h.remote).postAbandon(request(runId, 'abandon', body), context(runId)));
    assert.equal(resumed.id, first.id);
    assert.equal(resumed.status, 'reconciled');
    assert.equal(resumed.prClosed, true);
    assert.equal(h.remote.closeCalls, 1);
    assert.equal(db.reviewActionCount(runId), 1);
    assert.equal(db.recoveries(runId).length, 1);
    assert.equal(db.activeAttempt(h.fixture.state.attempt.baseline.target), null);
    const calls = h.remote.readCalls;
    const terminalReplay = await recoveryBody(await handlers(db, h.remote).postAbandon(request(runId, 'abandon', body), context(runId)));
    assert.deepEqual(terminalReplay, resumed);
    assert.equal(h.remote.readCalls, calls);
    assert.equal(db.reviewActionCount(runId), 1);
  } finally { db.close(); rmSync(h.directory, { recursive: true, force: true }); }
});

test('fixture HTTP merge-race reconciliation validates strict DTO and observed deployment before recording failure, without source writes', async () => {
  const h = await setup(), runId = h.fixture.state.run.id;
  const sourceHash = hashRecord(h.fixture.baseSources), candidateHash = hashRecord(h.bundle.images);
  try {
    h.remote.mergeOnRead = 2;
    const http = handlers(h.db, h.remote);
    const abandoned = await recoveryBody(await http.postAbandon(request(runId, 'abandon', abandonBody(h.fixture, h.submission)), context(runId)));
    assert.equal(abandoned.status, 'merged_observed');
    assert.equal(h.remote.closeCalls, 0);
    const attempt = h.db.getAttempt(h.fixture.state.attempt.id)!;
    assert.equal(attempt.state, 'merged_failure');
    assert.equal(h.db.activeAttempt(attempt.baseline.target)!.id, attempt.id);
    const body = { contractVersion: 2, launchAttemptId: attempt.id, runId, expectedAttemptRevision: attempt.revision, observedDeploymentId: 'fixture-failed-production-deployment', idempotencyKey: 'fixture-http-reconcile-merged-failure', reason: 'Capture fixture observed production facts; retain the failed outcome.' };
    for (const [pathRunId, input, status, code] of [
      [runId, { ...body, contractVersion: 1 }, 400, 'validation'],
      [runId, { ...body, override: true }, 400, 'validation'],
      ['different-run', body, 400, 'validation'],
      [runId, { ...body, launchAttemptId: 'different-attempt' }, 404, 'not_found'],
      [runId, { ...body, expectedAttemptRevision: attempt.revision + 1 }, 409, 'stale'],
    ] as const) {
      const response = await http.postReconcile(request(pathRunId, 'reconcile', input), context(pathRunId));
      assert.equal(response.status, status);
      assert.equal(RemoteErrorSchema.parse(await response.json()).error.code, code);
    }
    assert.equal(h.remote.observeCalls, 0);
    assert.equal(h.db.reviewActionCount(runId), 1);
    h.remote.observationOverrides = { deploymentId: 'different-fixture-deployment' };
    const unconfirmed = await recoveryBody(await http.postReconcile(request(runId, 'reconcile', body), context(runId)));
    assert.equal(unconfirmed.status, 'unknown');
    assert.equal(h.db.activeAttempt(attempt.baseline.target)!.state, 'merged_failure');
    assert.deepEqual(h.db.observations(runId), []);
    h.remote.observationOverrides = {};
    const reconciled = await recoveryBody(await http.postReconcile(request(runId, 'reconcile', body), context(runId)));
    assert.equal(reconciled.id, unconfirmed.id);
    assert.equal(reconciled.status, 'reconciled');
    assert.equal(reconciled.mergedSha, h.remote.pr.mergedSha);
    assert.equal(reconciled.observedDeploymentId, body.observedDeploymentId);
    const observation = h.db.observations(runId)[0];
    assert.equal(observation.environment, 'production');
    assert.equal(observation.deployedSha, h.remote.pr.mergedSha);
    assert.equal(observation.publishedFacts!.plans.starter.monthlyCents, 3000);
    assert.equal(observation.verification, 'failed');
    assert.equal(h.db.getFacts(attempt.id, 'desired')!.snapshot.plans.starter.monthlyCents, 4000);
    assert.equal(h.db.getAttempt(attempt.id)!.state, 'reconciled_failure');
    assert.equal(h.db.activeAttempt(attempt.baseline.target), null);
    assert.equal(h.db.reviewActionCount(runId), 2);
    assert.equal(h.remote.effects.filter(effect => effect === 'close').length, 0);
    assert.equal(hashRecord(h.fixture.baseSources), sourceHash);
    assert.equal(hashRecord(h.bundle.images), candidateHash);
    const observations = h.remote.observeCalls;
    const replay = await recoveryBody(await http.postReconcile(request(runId, 'reconcile', body), context(runId)));
    assert.deepEqual(replay, reconciled);
    assert.equal(h.remote.observeCalls, observations);
    assert.equal(h.db.reviewActionCount(runId), 2);
  } finally { h.db.close(); rmSync(h.directory, { recursive: true, force: true }); }
});

test('scripted fixture restoration and abandonment API events stay test-labeled with zero human action credit', async () => {
  const h = await setup(), runId = h.fixture.state.run.id;
  try {
    const http = handlers(h.db, h.remote, 'test');
    assert.equal((await recoveryBody(await http.postAbandon(request(runId, 'abandon', abandonBody(h.fixture, h.submission)), context(runId)))).status, 'reconciled');
    assert.deepEqual(h.db.reviewEvents(runId).map(event => [event.action, event.actor]), [['abandon', 'test']]);
    assert.equal(h.db.reviewActionCount(runId), 0);

    const before = h.fixture.state.facts.find(facts => facts.phase === 'desired')!.snapshot;
    const desired = h.fixture.state.facts.find(facts => facts.phase === 'before')!.snapshot;
    const artifact = createPublicArtifact({ sourceCommit: 'c'.repeat(40), mode: 'commit', seedManifestText: readFileSync('fixtures/remote/miniature/seed.json', 'utf8'), factText: JSON.stringify(before, null, 2) + '\n', sourceTexts: h.fixture.baseSources });
    const baseline = { ...h.fixture.state.attempt.baseline, baseSha: artifact.sourceCommit, deployedSha: artifact.sourceCommit, assets: artifact.assets, inventoryHash: artifact.inventoryHash, factsHash: artifact.factsHash, factsFileHash: artifact.factsFileHash };
    const coordinator = new RemoteCoordinator({ databasePath: h.databasePath, clock, actor: 'test' });
    const restorationHttp = handlers(h.db, h.remote, 'test', async body => coordinator.startRestoration(body, { baseline, beforeFacts: before, desiredFacts: desired, config: h.fixture.state.run.config, mode: 'fixture' }));
    const body = { contractVersion: 2, launchAttemptId: randomUUID(), expectedFactVersion: before.version, seedRevision: h.fixture.state.attempt.baseline.baseSha, baselineHash: hashRecord(baseline), idempotencyKey: 'fixture-http-scripted-restoration' };
    const response = await restorationHttp.postRestoration(new Request('http://localhost:3104/api/v2/restorations', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3104' }, body: JSON.stringify(body) }));
    assert.equal(response.status, 200);
    const started = await response.json();
    assert.equal(started.run.mode, 'fixture');
    assert.deepEqual(h.db.reviewEvents(started.run.id).map(event => [event.action, event.actor]), [['restore', 'test']]);
    assert.equal(h.db.reviewActionCount(started.run.id), 0);
    const restoreAbandon = { contractVersion: 2, launchAttemptId: started.attempt.id, runId: started.run.id, expectedAttemptRevision: started.attempt.revision, expectedSubmissionRevision: null, reason: 'Fixture restoration cancelled before submission.', idempotencyKey: 'fixture-http-abandon-restoration' };
    const effects = [...h.remote.effects];
    assert.equal((await recoveryBody(await restorationHttp.postAbandon(request(started.run.id, 'abandon', restoreAbandon), context(started.run.id)))).status, 'reconciled');
    assert.deepEqual(h.remote.effects, effects);
    assert.deepEqual(h.db.reviewEvents(started.run.id).map(event => [event.action, event.actor]), [['restore', 'test'], ['abandon', 'test']]);
    assert.equal(h.db.reviewActionCount(started.run.id), 0);
  } finally { h.db.close(); rmSync(h.directory, { recursive: true, force: true }); }
});

test('scripted fixture reconciliation retains failed observation and test actor without human recovery credit', async () => {
  const h = await setup(), runId = h.fixture.state.run.id;
  try {
    const attempt = h.db.getAttempt(h.fixture.state.attempt.id)!;
    h.db.putAttempt({ ...attempt, state: 'merged_failure', revision: attempt.revision + 1 });
    h.remote.pr = { ...h.remote.pr, state: 'closed', mergedSha: 'd'.repeat(40) };
    const body = { contractVersion: 2, launchAttemptId: attempt.id, runId, expectedAttemptRevision: attempt.revision + 1, observedDeploymentId: 'fixture-scripted-failed-deployment', reason: 'Scripted fixture captures failed public state without human review credit.', idempotencyKey: 'fixture-http-scripted-reconciliation' };
    const reconciled = await recoveryBody(await handlers(h.db, h.remote, 'test').postReconcile(request(runId, 'reconcile', body), context(runId)));
    assert.equal(reconciled.status, 'reconciled');
    assert.equal(h.db.getAttempt(attempt.id)!.state, 'reconciled_failure');
    assert.equal(h.db.observations(runId)[0].verification, 'failed');
    assert.deepEqual(h.db.reviewEvents(runId).map(event => [event.action, event.actor]), [['reconcile', 'test']]);
    assert.equal(h.db.reviewActionCount(runId), 0);
  } finally { h.db.close(); rmSync(h.directory, { recursive: true, force: true }); }
});

test('test recovery actor rejects a live run before journal, events, remote calls or idempotency replay', async () => {
  // The fabricated run is marked live solely to test the mode boundary.
  const h = await setup('live'), runId = h.fixture.state.run.id;
  try {
    const http = handlers(h.db, h.remote, 'test'), attempt = h.db.getAttempt(h.fixture.state.attempt.id)!;
    const abandon = abandonBody(h.fixture, h.submission);
    const reconcile = { contractVersion: 2, launchAttemptId: attempt.id, runId, expectedAttemptRevision: attempt.revision, observedDeploymentId: 'fixture-live-boundary-deployment', reason: 'Invalid scripted live recovery.', idempotencyKey: 'fixture-http-block-scripted-live-reconciliation' };
    for (const [action, body] of [['abandon', abandon], ['reconcile', reconcile]] as const) {
      const response = await (action === 'abandon' ? http.postAbandon : http.postReconcile)(request(runId, action, body), context(runId));
      assert.equal(response.status, 400);
      assert.equal(RemoteErrorSchema.parse(await response.json()).error.code, 'validation');
      assert.equal(h.db.replay('v2.' + action, body.idempotencyKey, hashRecord(body)), null);
    }
    assert.deepEqual(h.db.getAttempt(attempt.id), attempt);
    assert.deepEqual(h.db.recoveries(runId), []);
    assert.deepEqual(h.db.reviewEvents(runId), []);
    assert.deepEqual(h.remote.effects, []);
    assert.equal(h.remote.readCalls, 0);
    assert.equal(h.remote.observeCalls, 0);

    // A script cannot use an existing human journal to bypass the live guard.
    h.remote.loseCloseOnce = true;
    const humanResult = await recoveryBody(await handlers(h.db, h.remote).postAbandon(request(runId, 'abandon', abandon), context(runId)));
    assert.equal(humanResult.status, 'unknown');
    const beforeReplay = h.db.export(runId), remoteCalls = h.remote.readCalls;
    const rejectedReplay = await http.postAbandon(request(runId, 'abandon', abandon), context(runId));
    assert.equal(rejectedReplay.status, 400);
    assert.deepEqual(h.db.export(runId), beforeReplay);
    assert.equal(h.remote.readCalls, remoteCalls);
  } finally { h.db.close(); rmSync(h.directory, { recursive: true, force: true }); }
});
