import path from 'node:path';
import { after } from 'next/server';
import { RemoteBaselineViewSchema, RemoteCandidateViewSchema, RemoteObserveRequestSchema } from '@/lib/runs/remote-api';
import { remoteBaseline, confirmRemote, approveRemote, getRemoteRun, prepareRemoteCandidate, submitRemote, abandonRemote, reconcileRemote, restoreRemote, remoteRunContentRoot, observeRemoteRun } from '@/lib/runs/remote-runtime';
import { processRemoteRun, recoverRemoteRun } from '@/lib/pipeline/remote';
import { createRemoteHttpHandlers } from './dispatch';

const options = () => ({ databasePath: process.env.MOGS_REMOTE_DATABASE_PATH ? path.resolve(process.env.MOGS_REMOTE_DATABASE_PATH) : undefined });
const handlers = createRemoteHttpHandlers({
  baseline: remoteBaseline,
  confirm: confirmRemote,
  approve: approveRemote,
  run: runId => { recoverRemoteRun(runId, options()); return getRemoteRun(runId); },
  candidate: prepareRemoteCandidate,
  submit: submitRemote,
  abandon: abandonRemote,
  reconcile: reconcileRemote,
  restore: restoreRemote,
  observe: observeRemoteRun,
}, { baseline: RemoteBaselineViewSchema, candidate: RemoteCandidateViewSchema, observe: RemoteObserveRequestSchema }, runId => {
  after(() => processRemoteRun(runId, { ...options(), contentRoot: remoteRunContentRoot(runId) }));
});
export const { getBaseline, postFacts, getRun, getExport, getCandidate, postApprove, postSubmit, postAbandon, postReconcile, postRestoration, postObserve } = handlers;
