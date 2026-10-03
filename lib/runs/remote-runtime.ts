import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashRecord, sha256 } from '../hash';
import { initialFacts, confirmedFacts } from '../facts/derive';
import { runtimeProviderConfig } from '../providers';
import { FactSnapshotSchema } from '../types';
import { RemoteDatabase, RemoteStateError } from './remote-db';
import { RemoteCoordinator } from './remote-service';
import { BaselineSchema, ConfirmRequestSchema, RestoreRequestSchema, SubmitRequestSchema, TargetRepositorySchema } from './remote-types';
import { RemoteBaselineViewSchema, RemoteCandidateViewSchema } from './remote-api';
import { GitHubRemote } from '../submission/github';
import { assembleCandidate, assertSameBaseline, type CandidateBundle } from '../submission/candidate';
import { assembleRestoration } from '../submission/restoration';
import { RemoteSubmission } from '../submission/service';
import { RemoteRecovery } from '../submission/recovery';
import { EnforcementEvidenceSchema, candidateStatusEvidenceHash, previewStatusEvidenceHash } from '../submission/enforcement';
import { VercelDeploymentHost } from '../deployment/vercel';
import { readRemoteSourceSnapshot } from '../deployment/git-source';
import { observeBaseline } from '../deployment/provenance';
import { verifyDeployment, finalizeVerifiedAttempt } from '../deployment/verify';
import { crawlRemoteScope } from '../crawl/remote';
import { completeRestorationRun } from './remote-restoration';

const databaseOptions = () => ({ databasePath: process.env.MOGS_REMOTE_DATABASE_PATH ?? 'data/remote/app.db' });
function target() { return TargetRepositorySchema.parse({ repository: process.env.MOGS_GITHUB_REPOSITORY ?? 'jcstotomas/mogs-demo', baseRef: process.env.MOGS_GITHUB_BASE_REF ?? 'main', productionOrigin: process.env.MOGS_PRODUCTION_ORIGIN, vercelProjectId: process.env.MOGS_VERCEL_PROJECT_ID, vercelTeamId: process.env.MOGS_VERCEL_TEAM_ID, statusProducerAppId: Number(process.env.MOGS_STATUS_PRODUCER_APP_ID) }); }
function database<T>(operation: (db: RemoteDatabase) => T): T { const db = new RemoteDatabase(databaseOptions().databasePath); try { return operation(db); } finally { db.close(); } }
function github(db?: RemoteDatabase): GitHubRemote {
  return new GitHubRemote({ target: target(), stateStore: db ? () => db : undefined, readLocal: runId => {
    const read = (store: RemoteDatabase) => { const submission = store.getSubmission(runId), attempt = submission && store.getAttempt(submission.launchAttemptId); return submission && attempt ? { submission, attempt } : null; };
    return db ? read(db) : database(read);
  }, observeProduction: async (submission, deploymentId) => {
    const pr = await github(db).readPullRequest(submission); if (!pr.mergedSha) throw new RemoteStateError('unknown_remote_state', 'The PR has no observed merge commit.');
    const host = new VercelDeploymentHost(target());
    const pinned = await host.byId(deploymentId, pr.mergedSha, 'production');
    const resolved = await host.production(pr.mergedSha); if (resolved.deploymentId !== pinned.deploymentId) throw new RemoteStateError('stale', 'Reconciliation deployment is not the current production deployment.');
    return (await checkDeployment(submission.runId, 'production', pr.mergedSha, host)).observation;
  } });
}
async function enforcement() {
  try {
  const proof = EnforcementEvidenceSchema.parse(JSON.parse(await readFile('data/evidence/remote0/enforcement-pass.json', 'utf8')));
  const remote = github(); const settings = await remote.readEnforcementSettings(); remote.assertEnforcementSettings(settings);
  if (proof.repository !== settings.repository || proof.baseRef !== settings.baseRef || proof.producerAppId !== settings.producerAppId) throw new RemoteStateError('enforcement_unavailable', 'Recorded enforcement probes do not match the configured target.');
  return proof;
  } catch { throw new RemoteStateError('enforcement_unavailable', 'Live GitHub enforcement evidence or current protection settings are unavailable.'); }
}
async function currentBaseline() {
  const configured = target(), remote = github(), baseSha = await remote.readBaseSha();
  const hosted = await new VercelDeploymentHost(configured).production(baseSha);
  if (hosted.readiness !== 'ready') throw new RemoteStateError('busy', 'Production has not reached a Ready deployment at the current base head.');
  const snapshot = await readRemoteSourceSnapshot(configured.repository, baseSha);
  const baseline = BaselineSchema.parse({ target: configured, baseSha, deployedSha: hosted.deployedSha, deploymentId: hosted.deploymentId, deploymentUrl: hosted.url, observedAt: new Date().toISOString(), inventoryHash: snapshot.artifact.inventoryHash, corpusHash: JSON.parse(snapshot.seedManifestText).corpusHash, factsHash: snapshot.artifact.factsHash, factsFileHash: snapshot.artifact.factsFileHash, assets: snapshot.artifact.assets });
  await observeBaseline(baseline, { sources: snapshot.sources, publishedFacts: snapshot.publishedFacts });
  return { baseline, snapshot };
}
const baselineFile = (hash: string) => { if (!/^[a-f0-9]{64}$/.test(hash)) throw new RemoteStateError('validation', 'Invalid baseline hash.'); return path.resolve('data/remote/baselines', hash + '.json'); };
export async function remoteBaseline() {
  const { baseline, snapshot } = await currentBaseline();
  let readiness = { available: false, message: 'GitHub enforcement probes have not passed for this target.' };
  try { await enforcement(); readiness = { available: true, message: 'Required checks, trusted App and strict base probes passed; GitHub merge remains a human decision.' }; } catch {}
  const activeRunId = database(db => db.activeAttempt(baseline.target)?.runId ?? null);
  const view = RemoteBaselineViewSchema.parse({ contractVersion: 2, baseline, baselineHash: hashRecord(baseline), beforeFacts: snapshot.publishedFacts, desiredFacts: confirmedFacts(snapshot.publishedFacts), activeRunId, enforcement: readiness });
  await mkdir(path.dirname(baselineFile(view.baselineHash)), { recursive: true });
  try { await writeFile(baselineFile(view.baselineHash), JSON.stringify(view, null, 2) + '\n', { flag: 'wx' }); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error; }
  return view;
}
async function pinnedBaseline(hash: string) {
  let saved; try { saved = RemoteBaselineViewSchema.parse(JSON.parse(await readFile(baselineFile(hash), 'utf8'))); } catch { throw new RemoteStateError('stale', 'Refresh the observed baseline before confirming.'); }
  if (saved.baselineHash !== hash || hashRecord(saved.baseline) !== hash) throw new RemoteStateError('stale', 'Saved baseline identity is invalid.');
  const fresh = await currentBaseline();
  try { assertSameBaseline(saved.baseline, fresh.baseline); } catch { throw new RemoteStateError('stale', 'Production or the base changed; refresh the baseline.'); }
  return { ...fresh, baseline: saved.baseline };
}
function captureRoot(attemptId: string) { return path.resolve('data/remote/captures', sha256(attemptId), 'content'); }
async function capture(attemptId: string, sources: Record<string, string>) {
  for (const [file, source] of Object.entries(sources)) {
    if (!/^(site|email)\/[a-z0-9-]+\.md$/.test(file)) throw new Error('Source is outside the miniature mapping.');
    const destination = path.join(captureRoot(attemptId), file); await mkdir(path.dirname(destination), { recursive: true });
    try { await writeFile(destination, source, { flag: 'wx' }); } catch { if (await readFile(destination, 'utf8') !== source) throw new RemoteStateError('stale', 'Captured source bytes changed.'); }
  }
}
export function remoteRunContentRoot(runId: string) { return captureRoot(getRemoteRun(runId).attempt.id); }
export async function confirmRemote(input: unknown) {
  const confirmedAt = new Date();
  const request = ConfirmRequestSchema.parse(input);
  const replay = database(db => db.replay('v2:correction:confirm', request.idempotencyKey, hashRecord(request))) as ReturnType<RemoteCoordinator['confirm']> | null;
  if (replay) return replay;
  const { baseline, snapshot } = await pinnedBaseline(request.baselineHash);
  const crawled = await crawlRemoteScope(baseline, { sources: snapshot.sources, publishedFacts: snapshot.publishedFacts });
  await capture(request.launchAttemptId, snapshot.sources);
  return new RemoteCoordinator({ ...databaseOptions(), clock: () => confirmedAt }).confirm(request, { baseline, beforeFacts: snapshot.publishedFacts, desiredFacts: confirmedFacts(snapshot.publishedFacts), config: runtimeProviderConfig(), ...crawled, mode: 'live' });
}
export function getRemoteRun(runId: string) { return new RemoteCoordinator(databaseOptions()).export(runId); }
export function approveRemote(groupId: string, request: unknown) { return new RemoteCoordinator(databaseOptions()).approve(groupId, request as Parameters<RemoteCoordinator['approve']>[1]); }
async function candidateBundle(runId: string): Promise<CandidateBundle> {
  const state = getRemoteRun(runId), fresh = await currentBaseline();
  if (state.attempt.purpose === 'restoration') {
    const seed = await github().readSeed(state.attempt.seedRevision!);
    return assembleRestoration(state.attempt, fresh.baseline, fresh.snapshot.sources, JSON.parse(seed.seedManifestText), seed.seedFactsText, state.attempt.confirmedAt);
  }
  return assembleCandidate(state, fresh.snapshot.sources, fresh.baseline, undefined, state.approvals.map(item => item.at).sort().at(-1) ?? state.run.confirmedAt);
}
export async function prepareRemoteCandidate(runId: string) { const bundle = await candidateBundle(runId); return RemoteCandidateViewSchema.parse({ candidate: bundle.candidate, checks: bundle.checks }); }
export async function submitRemote(request: unknown) {
  const body = SubmitRequestSchema.parse(request); await enforcement();
  const existing = database(db => db.getSubmission(body.runId)), bundle = existing ? undefined : await candidateBundle(body.runId);
  const db = new RemoteDatabase(databaseOptions().databasePath);
  try {
    const remote = github(db), submission = await new RemoteSubmission(db, remote).submit(request, bundle);
    if (submission.status === 'submitted' && submission.candidate.candidateSha) {
      const pr = await remote.readPullRequest(submission);
      if (pr.state === 'open' && !pr.mergedSha) {
        const proof = await enforcement(), statuses = await remote.readStatuses(submission, submission.candidate.candidateSha);
        if (!statuses.some(status => status.context === 'mogs/candidate')) await remote.postStatus(submission, submission.candidate.candidateSha, 'mogs/candidate', 'success', candidateStatusEvidenceHash(db, body.runId), proof);
        if (!statuses.some(status => status.context === 'mogs/preview')) await remote.postStatus(submission, submission.candidate.candidateSha, 'mogs/preview', 'pending', hashRecord({ waitingForPreview: submission.id }));
      }
    }
    return { submission };
  } finally { db.close(); }
}
async function checkDeployment(runId: string, environment: 'preview' | 'production', mergedSha: string | null, host = new VercelDeploymentHost(target())) {
  const state = getRemoteRun(runId), submission = state.submission;
  if (!submission?.candidate.candidateSha) throw new RemoteStateError('not_found', 'A submitted candidate is required.');
  const hosted = await host.resolve({ environment, submission, mergedSha });
  const snapshot = await readRemoteSourceSnapshot(target().repository, hosted.deployedSha);
  return verifyDeployment(state, { environment, mergedSha, host, allowedOrigins: [new URL(hosted.url).origin, target().productionOrigin], mappedImages: { ...Object.fromEntries(Object.entries(snapshot.sources).map(([file, source]) => ['content/' + file, source])), 'data/facts.json': snapshot.factText }, seedManifestText: snapshot.seedManifestText, seedRevision: state.attempt.seedRevision ?? undefined, artifactText: snapshot.artifactText });
}
export async function observeRemoteRun(runId: string) {
  const state = getRemoteRun(runId); if (!state.submission) throw new RemoteStateError('not_found', 'Submit a candidate before checking deployment.');
  if (state.attempt.state === 'verified') return state;
  const pr = await github().readPullRequest(state.submission), environment = pr.mergedSha ? 'production' : 'preview';
  const result = await checkDeployment(runId, environment, pr.mergedSha);
  database(db => db.transaction(() => {
    const current = db.export(runId);
    if (hashRecord(current.submission) !== hashRecord(state.submission) || hashRecord(current.attempt) !== hashRecord(state.attempt)) throw new RemoteStateError('stale', 'Attempt changed during deployment verification.');
    db.putObservation(result.observation);
    if (environment === 'production') {
      if (result.observation.verification === 'passed') db.putAttempt(finalizeVerifiedAttempt(current, result));
      else if (result.observation.verification === 'failed' && current.attempt.state === 'active') db.putAttempt({ ...current.attempt, state: 'merged_failure', revision: current.attempt.revision + 1, closureReason: 'Merged deployment did not pass rendered verification.' });
    }
  }));
  if (environment === 'preview') {
    const db = new RemoteDatabase(databaseOptions().databasePath);
    try { const submission = db.getSubmission(runId)!; await github(db).postStatus(submission, submission.candidate.candidateSha!, 'mogs/preview', result.observation.verification === 'passed' ? 'success' : result.observation.verification === 'pending' ? 'pending' : 'failure', previewStatusEvidenceHash(result.observation), await enforcement()); } finally { db.close(); }
  }
  return getRemoteRun(runId);
}
export async function abandonRemote(request: unknown) { const db = new RemoteDatabase(databaseOptions().databasePath); try { return { recovery: await new RemoteRecovery(db, github(db)).abandon(request) }; } finally { db.close(); } }
export async function reconcileRemote(request: unknown) { const db = new RemoteDatabase(databaseOptions().databasePath); try { return { recovery: await new RemoteRecovery(db, github(db)).reconcile(request) }; } finally { db.close(); } }
export async function restoreRemote(input: unknown) {
  const confirmedAt = new Date();
  await enforcement(); const request = RestoreRequestSchema.parse(input);
  const replay = database(db => db.replay('v2:restoration:confirm', request.idempotencyKey, hashRecord(request))) as ReturnType<RemoteCoordinator['startRestoration']> | null;
  if (replay) {
    database(db => { if (!['ready', 'failed'].includes(db.getRun(replay.run.id)!.status)) db.transaction(() => completeRestorationRun(db, replay.run.id)); });
    return replay;
  }
  const { baseline, snapshot } = await pinnedBaseline(request.baselineHash), seed = await github().readSeed(request.seedRevision);
  const desired = FactSnapshotSchema.parse(JSON.parse(seed.seedFactsText)); if (hashRecord(desired) !== hashRecord(initialFacts())) throw new RemoteStateError('validation', 'Pinned seed facts are not the frozen initial scenario.');
  const crawled = await crawlRemoteScope(baseline, { sources: snapshot.sources, publishedFacts: snapshot.publishedFacts });
  await capture(request.launchAttemptId, snapshot.sources);
  const started = new RemoteCoordinator({ ...databaseOptions(), clock: () => confirmedAt }).startRestoration(request, { baseline, beforeFacts: snapshot.publishedFacts, desiredFacts: desired, config: runtimeProviderConfig(), ...crawled, mode: 'live' });
  assembleRestoration(started.attempt, baseline, snapshot.sources, JSON.parse(seed.seedManifestText), seed.seedFactsText, started.attempt.confirmedAt);
  database(db => db.transaction(() => completeRestorationRun(db, started.run.id)));
  return started;
}
