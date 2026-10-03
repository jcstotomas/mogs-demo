import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { assertRemoteRuntimeState, remoteRuntimeProfile } from '../lib/runs/remote-runtime-profile';
import { RemoteStateError } from '../lib/runs/remote-db';
import type { Baseline } from '../lib/runs/remote-types';

// Configuration fixtures only; these IDs do not claim an observed deployment.
const primary: Baseline['target'] = { repository: 'jcstotomas/mogs-demo', baseRef: 'main', productionOrigin: 'https://mogs-demo.vercel.app', vercelProjectId: 'prj_hT55y9ozmq67qLkneP8csBNUuVTr', vercelTeamId: 'fixture-team', statusProducerAppId: 12345 };
const recovery: Baseline['target'] = { ...primary, baseRef: 'codex/recovery-base', productionOrigin: 'https://mogs-recovery.vercel.app', vercelProjectId: 'fixture-separate-recovery-project' };
const live = { actor: 'human', mode: 'live', testOnlyAllowFixtureEvidence: false };
const scripted = { actor: 'test', mode: 'fixture', testOnlyAllowFixtureEvidence: true };
const testEnvironment = { MOGS_REMOTE_TEST_MODE: '1', MOGS_REMOTE_DATABASE_PATH: 'data/remote/recovery-test/app.db' };

test('runtime profile preserves default main human/live behavior and rejects recovery identity without the test flag', () => {
  assert.deepEqual(remoteRuntimeProfile(primary, {}), live);
  for (const target of [recovery, { ...primary, baseRef: recovery.baseRef }, { ...primary, productionOrigin: recovery.productionOrigin }]) assert.throws(() => remoteRuntimeProfile(target, {}), /requires explicit test mode/);
});

test('only the explicit test flag and complete isolated recovery target select scripted fixture mode', () => {
  assert.deepEqual(remoteRuntimeProfile(recovery, testEnvironment), scripted);
});

test('invalid test flags fail closed rather than selecting live or test fallback', () => {
  for (const flag of ['', '0', 'true', 'false', '2', '01', ' 1', '1 ']) {
    assert.throws(() => remoteRuntimeProfile(recovery, { MOGS_REMOTE_TEST_MODE: flag }), error => error instanceof RemoteStateError && error.code === 'validation');
  }
});

test('test mode rejects every cross-target identity mismatch and the primary Vercel project', () => {
  const mismatches: Partial<Baseline['target']>[] = [
    { repository: 'someone/mogs-demo' }, { repository: 'JCSTOTOMAS/mogs-demo' },
    { baseRef: 'main' }, { baseRef: 'codex/recovery-base-other' },
    { productionOrigin: 'https://mogs-demo.vercel.app' },
    { productionOrigin: 'https://mogs-recovery.vercel.app/' },
    { productionOrigin: 'https://mogs-recovery.vercel.app.example.com' },
    { vercelProjectId: primary.vercelProjectId }, { vercelProjectId: '   ' },
  ];
  for (const mismatch of mismatches) {
    assert.throws(() => remoteRuntimeProfile({ ...recovery, ...mismatch }, testEnvironment), error => error instanceof RemoteStateError && error.code === 'validation');
  }
  assert.throws(() => remoteRuntimeProfile(primary, testEnvironment), /approved isolated recovery/);
});

test('test mode requires a valid complete HTTPS target, with no blank project fallback', () => {
  for (const mismatch of [{ vercelProjectId: '' }, { vercelTeamId: '' }, { statusProducerAppId: 0 }, { productionOrigin: 'http://mogs-recovery.vercel.app' }]) {
    assert.throws(() => remoteRuntimeProfile({ ...recovery, ...mismatch }, testEnvironment));
  }
});

test('test mode requires a nonblank path distinct from the resolved primary database', () => {
  for (const databasePath of [undefined, '', '   ', 'data/remote/app.db', './data/remote/../remote/app.db', path.resolve('data/remote/app.db'), 'invalid\0path']) assert.throws(() => remoteRuntimeProfile(recovery, { MOGS_REMOTE_TEST_MODE: '1', MOGS_REMOTE_DATABASE_PATH: databasePath }), /explicit database path separate/);
  assert.deepEqual(remoteRuntimeProfile(recovery, { ...testEnvironment, MOGS_REMOTE_DATABASE_PATH: path.resolve(testEnvironment.MOGS_REMOTE_DATABASE_PATH) }), scripted);
});

test('stored or replayed state must bind target, mode and attempt/run identities to its runtime', () => {
  const state = { attempt: { id: 'attempt', runId: 'run', baseline: { target: recovery } as Baseline }, run: { id: 'run', launchAttemptId: 'attempt', mode: 'fixture' as const } };
  assert.doesNotThrow(() => assertRemoteRuntimeState(state, recovery, testEnvironment));
  for (const invalid of [
    { ...state, attempt: { ...state.attempt, baseline: { target: primary } as Baseline } },
    { ...state, run: { ...state.run, mode: 'live' as const } },
    { ...state, run: { ...state.run, id: 'other-run' } },
    { ...state, run: { ...state.run, launchAttemptId: 'other-attempt' } },
  ]) assert.throws(() => assertRemoteRuntimeState(invalid, recovery, testEnvironment), /must match the configured runtime/);
  assert.throws(() => assertRemoteRuntimeState({ ...state, attempt: { ...state.attempt, baseline: { target: primary } as Baseline } }, primary, {}), /must match the configured runtime/);
  assert.doesNotThrow(() => assertRemoteRuntimeState({ ...state, attempt: { ...state.attempt, baseline: { target: primary } as Baseline }, run: { ...state.run, mode: 'live' } }, primary, {}));
});
