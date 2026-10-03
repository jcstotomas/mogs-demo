import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { hashRecord } from '../lib/hash';
import { initialFacts, confirmedFacts } from '../lib/facts/derive';
import { createPublicArtifact } from '../lib/deployment/public-artifact';
import { RemoteDatabase, RemoteStateError } from '../lib/runs/remote-db';
import { RemoteCoordinator } from '../lib/runs/remote-service';
import { buildRemoteFixtures, seedRemoteFixtureDatabase, REMOTE_FIXTURE_TIME } from '../lib/runs/remote-fixtures';
import { abandonRemote, approveRemote, confirmRemote, getRemoteRun, observeRemoteRun, prepareRemoteCandidate, reconcileRemote, restoreRemote, submitRemote } from '../lib/runs/remote-runtime';
import type { Baseline, RemoteRun } from '../lib/runs/remote-types';

// These are isolated database/configuration fixtures. No actual remote action or reviewer credit.
const primary: Baseline['target'] = { repository: 'jcstotomas/mogs-demo', baseRef: 'main', productionOrigin: 'https://mogs-demo.vercel.app', vercelProjectId: 'prj_hT55y9ozmq67qLkneP8csBNUuVTr', vercelTeamId: 'fixture-team', statusProducerAppId: 12345 };
const recovery: Baseline['target'] = { ...primary, baseRef: 'codex/recovery-base', productionOrigin: 'https://mogs-recovery.vercel.app', vercelProjectId: 'fixture-recovery-project' };
const clock = () => new Date(REMOTE_FIXTURE_TIME);
const validation = (error: unknown) => error instanceof RemoteStateError && error.code === 'validation' && /must match the configured runtime/.test(error.message);

async function environment<T>(target: Baseline['target'], databasePath: string, testMode: boolean, operation: () => T | Promise<T>): Promise<T> {
  const values: Record<string, string | undefined> = {
    MOGS_GITHUB_REPOSITORY: target.repository, MOGS_GITHUB_BASE_REF: target.baseRef,
    MOGS_PRODUCTION_ORIGIN: target.productionOrigin, MOGS_VERCEL_PROJECT_ID: target.vercelProjectId,
    MOGS_VERCEL_TEAM_ID: target.vercelTeamId, MOGS_STATUS_PRODUCER_APP_ID: String(target.statusProducerAppId),
    MOGS_REMOTE_DATABASE_PATH: databasePath, MOGS_REMOTE_TEST_MODE: testMode ? '1' : undefined,
  };
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]])), savedFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('Unexpected network in isolation test.'); };
  try { const result = await operation(); assert.equal(networkCalls, 0, 'Rejected or replayed local state must not reach network operations.'); return result; }
  finally {
    globalThis.fetch = savedFetch;
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

function fixture(target: Baseline['target'], mode: RemoteRun['mode']) {
  const data = buildRemoteFixtures();
  data.state.attempt.baseline.target = target;
  data.state.attempt.baseline.deploymentUrl = target.productionOrigin;
  data.state.attempt.baselineHash = hashRecord(data.state.attempt.baseline);
  data.state.run.baselineHash = data.state.attempt.baselineHash;
  data.state.run.mode = mode;
  data.state.run.scope.urls = data.state.attempt.baseline.assets.map(asset => new URL(asset.pathname, target.productionOrigin).href);
  for (const record of [...data.state.pages, ...data.state.passages, ...data.state.patches]) record.url = new URL(new URL(record.url).pathname, target.productionOrigin).href;
  data.state.approvals = [];
  for (const group of data.state.groups) { group.status = 'sealed'; group.approvalId = null; }
  return data;
}
function setup(target: Baseline['target'], mode: RemoteRun['mode']) {
  const directory = mkdtempSync(path.join(tmpdir(), 'mogs-runtime-isolation-')), databasePath = path.join(directory, 'test.db');
  const db = new RemoteDatabase(databasePath, { clock }), data = fixture(target, mode);
  seedRemoteFixtureDatabase(db, data);
  return { directory, databasePath, db, data, dispose: () => { db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('test runtime rejects copied main/live state before approval, candidate, submission, observation or recovery effects', async () => {
  const h = setup(primary, 'live'), { attempt, run, groups } = h.data.state;
  const snapshot = h.db.export(run.id);
  const approve = { contractVersion: 2, launchAttemptId: attempt.id, runId: run.id, expectedRevision: groups[0].revision, membershipHash: groups[0].membershipHash, idempotencyKey: 'isolation-approve' };
  const submit = { contractVersion: 2, launchAttemptId: attempt.id, runId: run.id, expectedAttemptRevision: 0, baseSha: attempt.baseline.baseSha, bundleHash: '0'.repeat(64), approvals: [], idempotencyKey: 'isolation-submit' };
  const abandon = { contractVersion: 2, launchAttemptId: attempt.id, runId: run.id, expectedAttemptRevision: 0, expectedSubmissionRevision: null, reason: 'Fixture rejection.', idempotencyKey: 'isolation-abandon' };
  const reconcile = { contractVersion: 2, launchAttemptId: attempt.id, runId: run.id, expectedAttemptRevision: 0, observedDeploymentId: 'fixture-deployment', reason: 'Fixture rejection.', idempotencyKey: 'isolation-reconcile' };
  try {
    await environment(recovery, h.databasePath, true, async () => {
      assert.throws(() => getRemoteRun(run.id), validation);
      assert.throws(() => approveRemote(groups[0].id, approve), validation);
      await assert.rejects(prepareRemoteCandidate(run.id), validation);
      await assert.rejects(submitRemote(submit), validation);
      await assert.rejects(observeRemoteRun(run.id), validation);
      await assert.rejects(abandonRemote(abandon), validation);
      await assert.rejects(reconcileRemote(reconcile), validation);
    });
    assert.deepEqual(h.db.export(run.id), snapshot);
  } finally { h.dispose(); }
});

test('test runtime also rejects a live-mode record with the recovery target', async () => {
  const h = setup(recovery, 'live'), { attempt, run, groups } = h.data.state, snapshot = h.db.export(h.data.state.run.id);
  try {
    await environment(recovery, h.databasePath, true, () => assert.throws(() => approveRemote(groups[0].id, { contractVersion: 2, launchAttemptId: attempt.id, runId: run.id, expectedRevision: groups[0].revision, membershipHash: groups[0].membershipHash, idempotencyKey: 'wrong-mode-approve' }), validation));
    assert.deepEqual(h.db.export(run.id), snapshot);
  } finally { h.dispose(); }
});

test('the proper isolated fixture run records only test approval credit', async () => {
  const h = setup(recovery, 'fixture'), { attempt, run, groups } = h.data.state;
  try {
    await environment(recovery, h.databasePath, true, () => {
      const result = approveRemote(groups[0].id, { contractVersion: 2, launchAttemptId: attempt.id, runId: run.id, expectedRevision: groups[0].revision, membershipHash: groups[0].membershipHash, idempotencyKey: 'proper-test-approve' });
      assert.equal(result.approval.actor, 'test');
      const state = getRemoteRun(run.id);
      assert.equal(state.run.mode, 'fixture');
      assert.ok(state.reviewEvents.every(event => event.actor === 'test'));
    });
  } finally { h.dispose(); }
});

test('default main runtime retains actual human/live approval behavior', async () => {
  const h = setup(primary, 'live'), { attempt, run, groups } = h.data.state;
  try {
    await environment(primary, h.databasePath, false, () => {
      const result = approveRemote(groups[0].id, { contractVersion: 2, launchAttemptId: attempt.id, runId: run.id, expectedRevision: groups[0].revision, membershipHash: groups[0].membershipHash, idempotencyKey: 'proper-human-approve' });
      assert.equal(result.approval.actor, 'human');
      assert.equal(getRemoteRun(run.id).run.mode, 'live');
    });
  } finally { h.dispose(); }
});

test('a test runtime rejects main Confirm replay without returning human/live evidence', async () => {
  const h = setup(primary, 'live'), { attempt, run } = h.data.state;
  const request = { contractVersion: 2 as const, launchAttemptId: attempt.id, expectedFactVersion: 1 as const, baselineHash: attempt.baselineHash, idempotencyKey: 'main-confirm-replay' };
  h.db.remember('v2:correction:confirm', request.idempotencyKey, hashRecord(request), { attempt, run }, REMOTE_FIXTURE_TIME);
  const before = h.db.export(run.id);
  try {
    await environment(recovery, h.databasePath, true, async () => { await assert.rejects(confirmRemote(request), validation); });
    assert.deepEqual(h.db.export(run.id), before);
  } finally { h.dispose(); }
});

test('a valid fixture Confirm replay returns its original timestamps without network or new actions', async () => {
  const h = setup(recovery, 'fixture'), { attempt, run } = h.data.state;
  const request = { contractVersion: 2 as const, launchAttemptId: attempt.id, expectedFactVersion: 1 as const, baselineHash: attempt.baselineHash, idempotencyKey: 'test-confirm-replay' };
  const original = { attempt, run };
  h.db.remember('v2:correction:confirm', request.idempotencyKey, hashRecord(request), original, REMOTE_FIXTURE_TIME);
  const before = h.db.export(run.id);
  try {
    await environment(recovery, h.databasePath, true, async () => assert.deepEqual(await confirmRemote(request), original));
    assert.deepEqual(h.db.export(run.id), before);
  } finally { h.dispose(); }
});

test('restoration replay rejects copied main/live state before deterministic completion or enforcement calls', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'mogs-runtime-restoration-isolation-')), databasePath = path.join(directory, 'test.db');
  const data = buildRemoteFixtures(), desired = initialFacts(), beforeFacts = confirmedFacts(desired);
  const artifact = createPublicArtifact({ sourceCommit: data.state.attempt.baseline.baseSha, mode: 'commit', seedManifestText: JSON.stringify(data.seed), factText: JSON.stringify(beforeFacts), sourceTexts: data.baseSources });
  const baseline = { ...data.state.attempt.baseline, target: primary, deploymentUrl: primary.productionOrigin, assets: artifact.assets, inventoryHash: artifact.inventoryHash, factsHash: artifact.factsHash, factsFileHash: artifact.factsFileHash };
  const request = { contractVersion: 2 as const, launchAttemptId: '00000000-0000-4000-8000-000000000099', expectedFactVersion: beforeFacts.version, baselineHash: hashRecord(baseline), seedRevision: 'e'.repeat(40), idempotencyKey: 'main-restoration-replay' };
  const started = new RemoteCoordinator({ databasePath, clock, actor: 'human' }).startRestoration(request, { baseline, beforeFacts, desiredFacts: desired, config: data.state.run.config, mode: 'live' });
  const db = new RemoteDatabase(databasePath, { clock }), snapshot = db.export(started.run.id);
  try {
    await environment(recovery, databasePath, true, async () => { await assert.rejects(restoreRemote(request), validation); });
    assert.equal(db.getRun(started.run.id)!.status, 'collecting');
    assert.deepEqual(db.export(started.run.id), snapshot);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
