import path from 'node:path';
import { hashRecord } from '../hash';
import { RemoteStateError } from './remote-db';
import { TargetRepositorySchema, type Baseline, type LaunchAttempt, type RemoteRun } from './remote-types';

type RuntimeProfile =
  | { actor: 'human'; mode: 'live'; testOnlyAllowFixtureEvidence: false }
  | { actor: 'test'; mode: 'fixture'; testOnlyAllowFixtureEvidence: true };

/** Scripted recovery is limited to the explicitly approved, separate public target. */
export function remoteRuntimeProfile(configured: Baseline['target'], environment: Record<string, string | undefined> = process.env): RuntimeProfile {
  const flag = environment.MOGS_REMOTE_TEST_MODE;
  if (flag === undefined) {
    if (configured.baseRef === 'codex/recovery-base' || new URL(configured.productionOrigin).origin === 'https://mogs-recovery.vercel.app') throw new RemoteStateError('validation', 'The isolated recovery target requires explicit test mode.');
    return { actor: 'human', mode: 'live', testOnlyAllowFixtureEvidence: false };
  }
  if (flag !== '1') throw new RemoteStateError('validation', 'MOGS_REMOTE_TEST_MODE must be absent or exactly 1.');
  const target = TargetRepositorySchema.parse(configured);
  if (target.repository !== 'jcstotomas/mogs-demo' || target.baseRef !== 'codex/recovery-base' || target.productionOrigin !== 'https://mogs-recovery.vercel.app' || !target.vercelProjectId.trim() || target.vercelProjectId === 'prj_hT55y9ozmq67qLkneP8csBNUuVTr') {
    throw new RemoteStateError('validation', 'Test runtime requires the approved isolated recovery repository, branch, origin and separate Vercel project.');
  }
  const databasePath = environment.MOGS_REMOTE_DATABASE_PATH;
  if (!databasePath?.trim() || databasePath.includes('\0') || path.resolve(databasePath) === path.resolve('data/remote/app.db')) throw new RemoteStateError('validation', 'Test runtime requires an explicit database path separate from the primary database.');
  return { actor: 'test', mode: 'fixture', testOnlyAllowFixtureEvidence: true };
}

type RuntimeState = {
  attempt: Pick<LaunchAttempt, 'id' | 'runId' | 'baseline'>;
  run: Pick<RemoteRun, 'id' | 'launchAttemptId' | 'mode'>;
};

/** Validate stored and replayed state before any runtime action can mutate it. */
export function assertRemoteRuntimeState(state: RuntimeState, configured: Baseline['target'], environment: Record<string, string | undefined> = process.env): void {
  const runtime = remoteRuntimeProfile(configured, environment);
  if (state.attempt.runId !== state.run.id || state.run.launchAttemptId !== state.attempt.id || hashRecord(state.attempt.baseline.target) !== hashRecord(configured) || state.run.mode !== runtime.mode) throw new RemoteStateError('validation', 'Stored attempt target and run mode must match the configured runtime.');
}
