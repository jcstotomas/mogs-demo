import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { RemoteExportSchema, RestoreRequestSchema, SubmitRequestSchema, AbandonRequestSchema, ReconcileRequestSchema } from '../lib/runs/remote-types';
import { RemoteBaselineViewSchema, RemoteCandidateViewSchema } from '../lib/runs/remote-api';

// Actual APIs and remote artifacts, with scripted actions explicitly excluded from human credit.
const origin = 'http://localhost:3106';
const target = { repository: 'jcstotomas/mogs-demo', baseRef: 'codex/recovery-base', productionOrigin: 'https://mogs-recovery.vercel.app', vercelProjectId: 'prj_W1XVK4trIcZS6Sn24qTvewnGCAQU', vercelTeamId: 'team_tTySQ8aRrx08Ma0X2AMFm40d', statusProducerAppId: 5179329 };
const directory = 'data/evidence/remote1/recovery', file = directory + '/drills.json';
const command = process.argv[2], suppliedDeploymentId = process.argv[3];
if (!['start-a', 'abandon-a', 'start-b', 'observe-b', 'abandon-merged-b', 'reconcile-b', 'audit'].includes(command)) throw new Error('Unknown bounded recovery drill command.');
type Json = Record<string, any>;
let journal: Json;
try { journal = JSON.parse(await readFile(file, 'utf8')); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; journal = { format: 'mogs-actual-recovery-drills-v1', operationId: randomUUID(), createdAt: new Date().toISOString(), target, testActors: true, correctionCredit: false, stages: [] }; }
assert.equal(journal.format, 'mogs-actual-recovery-drills-v1'); assert.deepEqual(journal.target, target); assert.equal(journal.correctionCredit, false);
const save = async () => { await mkdir(directory, { recursive: true }); await writeFile(file + '.tmp', JSON.stringify(journal, null, 2) + '\n'); await rename(file + '.tmp', file); };
const stage = async (event: string, data: Json = {}) => { journal.stages.push({ event, at: new Date().toISOString(), ...data }); await save(); console.log(JSON.stringify({ event, ...data })); };
async function http(route: string, body?: unknown): Promise<Json> {
  const response = await fetch(origin + '/api/v2' + route, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(90_000), headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }), 'Cache-Control': 'no-cache' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text(); if (Buffer.byteLength(text) > 4_000_000) throw new Error('Recovery API response exceeded bound.');
  const value = JSON.parse(text);
  if (!response.ok) throw new Error('Recovery API ' + route + ' returned HTTP ' + response.status + ': ' + String(value.error?.message ?? value.message ?? 'unknown error'));
  return value;
}
function state(value: unknown) {
  const saved = RemoteExportSchema.parse(value);
  assert.deepEqual(saved.attempt.baseline.target, target); assert.equal(saved.run.mode, 'fixture'); assert.equal(saved.attempt.purpose, 'restoration');
  assert.equal(saved.approvals.length, 0); assert.equal(saved.patches.length, 0); assert.equal(saved.groups.length, 0);
  assert(saved.reviewEvents.every(event => event.actor === 'test'));
  return saved;
}
const read = async (drill: Json) => state(await http('/runs/' + drill.started.run.id + '/export'));
async function start(key: 'a' | 'b') {
  if (key === 'b') { const previous = await read(journal.a); assert.equal(previous.attempt.state, 'abandoned'); }
  const drill = journal[key] ??= { requests: {} };
  if (!drill.requests.restore) {
    const baseline = RemoteBaselineViewSchema.parse(await http('/baseline'));
    assert.deepEqual(baseline.baseline.target, target); assert.equal(baseline.enforcement.available, true); assert.equal(baseline.activeRunId, null); assert.equal(baseline.beforeFacts.version, 2);
    drill.baseline = baseline;
    drill.requests.restore = RestoreRequestSchema.parse({ contractVersion: 2, idempotencyKey: randomUUID(), launchAttemptId: randomUUID(), expectedFactVersion: baseline.beforeFacts.version, baselineHash: baseline.baselineHash, seedRevision: 'e573c2608ce3fa54f51cab67594355448aa1059b' });
    await stage(key + '-restoration-intent');
  }
  drill.started ??= await http('/restorations', drill.requests.restore); await save();
  let saved = await read(drill); assert.equal(saved.attempt.state, 'active'); assert.equal(saved.run.status, 'ready');
  if (!drill.requests.submit) {
    const candidate = RemoteCandidateViewSchema.parse(await http('/runs/' + saved.run.id + '/candidate'));
    assert.equal(candidate.candidate.purpose, 'restoration'); assert.equal(candidate.candidate.approvals.length, 0); assert.equal(Object.keys(candidate.checks).length, 0);
    drill.candidate = candidate;
    drill.requests.submit = SubmitRequestSchema.parse({ contractVersion: 2, idempotencyKey: randomUUID(), launchAttemptId: saved.attempt.id, runId: saved.run.id, expectedAttemptRevision: saved.attempt.revision, baseSha: candidate.candidate.baseSha, bundleHash: candidate.candidate.bundleHash, approvals: [] });
    await stage(key + '-submission-intent');
  }
  drill.submission = (await http('/runs/' + saved.run.id + '/submit', drill.requests.submit)).submission;
  assert.equal(drill.submission.status, 'submitted'); assert.match(drill.submission.prUrl, /^https:\/\/github\.com\/jcstotomas\/mogs-demo\/pull\/\d+$/);
  saved = await read(drill); drill.export = saved;
  await stage(key + '-submitted', { runId: saved.run.id, prUrl: drill.submission.prUrl, candidateSha: drill.submission.candidate.candidateSha, humanActions: 0 });
}
async function abandon(key: 'a' | 'b') {
  const drill = journal[key]; let saved = await read(drill);
  if (!drill.requests.abandon) {
    if (key === 'a') {
      const stale = JSON.parse(await readFile(directory + '/stale-head.json', 'utf8'));
      assert.equal(stale.passed, true); assert.equal(stale.originalSha, saved.submission!.candidate.candidateSha);
      assert.notEqual(stale.changedSha, stale.originalSha); drill.staleHead = stale.changedSha;
    }
    assert.equal(saved.attempt.state, 'active');
    drill.requests.abandon = AbandonRequestSchema.parse({ contractVersion: 2, idempotencyKey: randomUUID(), launchAttemptId: saved.attempt.id, runId: saved.run.id, expectedAttemptRevision: saved.attempt.revision, expectedSubmissionRevision: saved.submission!.revision, reason: key === 'a' ? 'Scripted isolated stale-head abandonment drill; zero human action credit.' : 'Scripted isolated abandonment after actual human merge; observe merge and reconcile actual deployment.' });
    await stage(key + '-abandonment-intent');
  }
  drill.recovery = (await http('/runs/' + saved.run.id + '/abandon', drill.requests.abandon)).recovery;
  saved = await read(drill); drill.export = saved;
  if (key === 'a') {
    assert.equal(drill.recovery.status, 'reconciled'); assert.equal(drill.recovery.prClosed, true); assert.equal(saved.attempt.state, 'abandoned');
    assert.deepEqual([...drill.recovery.retiredShas].sort(), [saved.submission!.candidate.candidateSha, drill.staleHead].sort());
    for (const sha of drill.recovery.retiredShas) for (const context of ['mogs/candidate', 'mogs/preview']) assert(drill.recovery.statuses.some((status: Json) => status.sha === sha && status.context === context && status.state === 'failure' && status.producerAppId === target.statusProducerAppId));
    const repeat = (await http('/runs/' + saved.run.id + '/abandon', drill.requests.abandon)).recovery; assert.equal(repeat.id, drill.recovery.id);
    const after = await read(drill); assert.equal(after.reviewEvents.length, saved.reviewEvents.length); drill.replay = { recoveryId: repeat.id, duplicateReviewEvents: 0 }; drill.export = after;
    const baseline = RemoteBaselineViewSchema.parse(await http('/baseline')); assert.equal(baseline.activeRunId, null); assert.equal(baseline.beforeFacts.version, 2);
    drill.activeSlotReleased = true; drill.passed = true;
  } else { assert.equal(drill.recovery.status, 'merged_observed'); assert.equal(saved.attempt.state, 'merged_failure'); assert.match(drill.recovery.mergedSha, /^[a-f0-9]{40}$/); }
  await stage(key + '-abandonment-observed', { state: saved.attempt.state, recovery: drill.recovery.status, humanActions: 0 });
}

try {
  if (command === 'start-a') await start('a');
  else if (command === 'start-b') await start('b');
  else if (command === 'abandon-a') await abandon('a');
  else if (command === 'abandon-merged-b') await abandon('b');
  else if (command === 'observe-b') {
    const drill = journal.b, saved = await read(drill);
    assert.equal(saved.attempt.state, 'active');
    const observed = state(await http('/runs/' + saved.run.id + '/observe', { contractVersion: 2, runId: saved.run.id, launchAttemptId: saved.attempt.id }));
    // Do not use this command after merge: normal production observation would bypass the recovery exercise.
    assert.equal(observed.attempt.state, 'active');
    const preview = observed.observations.filter(value => value.environment === 'preview').at(-1);
    assert.equal(preview?.verification, 'passed'); assert.equal(preview?.readiness, 'ready'); assert.equal(preview?.deployedSha, observed.submission!.candidate.candidateSha);
    drill.export = observed; drill.preview = preview; await stage('b-preview-verified', { prUrl: observed.submission!.prUrl, deploymentId: preview.deploymentId, previewUrl: preview.url });
  } else if (command === 'reconcile-b') {
    assert.match(suppliedDeploymentId ?? '', /^dpl_[A-Za-z0-9]+$/);
    const drill = journal.b; let saved = await read(drill);
    if (!drill.requests.reconcile) {
      assert.equal(saved.attempt.state, 'merged_failure');
      drill.requests.reconcile = ReconcileRequestSchema.parse({ contractVersion: 2, idempotencyKey: randomUUID(), launchAttemptId: saved.attempt.id, runId: saved.run.id, expectedAttemptRevision: saved.attempt.revision, observedDeploymentId: suppliedDeploymentId, reason: 'Scripted isolated actual-deployment reconciliation after an abandonment found a human-merged restoration PR; zero correction credit.' });
      await stage('b-reconciliation-intent');
    }
    assert.equal(drill.requests.reconcile.observedDeploymentId, suppliedDeploymentId);
    drill.reconciliation = (await http('/runs/' + saved.run.id + '/reconcile', drill.requests.reconcile)).recovery;
    saved = await read(drill); drill.export = saved;
    assert.equal(drill.reconciliation.status, 'reconciled'); assert.equal(saved.attempt.state, 'reconciled_failure');
    const observation = saved.observations.filter(value => value.environment === 'production').at(-1);
    assert.equal(observation?.deploymentId, suppliedDeploymentId); assert.equal(observation?.publishedFacts?.version, 1);
    assert.equal(observation?.deployedSha, drill.reconciliation.mergedSha); assert.equal(observation?.verification, 'passed');
    const repeat = (await http('/runs/' + saved.run.id + '/reconcile', drill.requests.reconcile)).recovery; assert.equal(repeat.id, drill.reconciliation.id);
    const after = await read(drill); assert.equal(after.reviewEvents.length, saved.reviewEvents.length); drill.export = after;
    const baseline = RemoteBaselineViewSchema.parse(await http('/baseline')); assert.equal(baseline.activeRunId, null); assert.equal(baseline.beforeFacts.version, 1);
    drill.activeSlotReleased = true; drill.passed = true; await stage('b-reconciled-failure', { mergedSha: drill.reconciliation.mergedSha, deploymentId: suppliedDeploymentId, humanActions: 0 });
  } else if (command === 'audit') {
    for (const key of ['a', 'b']) if (journal[key]?.started) { journal[key].export = await read(journal[key]); }
    await stage('audit-refreshed');
  }
} catch (error) { await stage('drill-failed', { command, failure: error instanceof Error ? error.message : 'Unknown recovery failure.' }); process.exitCode = 1; }
