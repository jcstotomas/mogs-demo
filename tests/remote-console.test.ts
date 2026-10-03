import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../fixtures/remote/api.json';
import { consoleFixture, fixtureNotice, fixtureStates } from '../components/remote-console-fixtures';
import {
  abandonRequest, actionCounts, approvalMatches, approvalRequest, bundleReady, classificationComplete,
  confirmRequest, groupReady, latestObservation, publicVerified, reconcileRequest, submissionRequest,
} from '../components/remote-console-model';
import { CandidateSchema, RemoteExportSchema } from '../lib/runs/remote-types';

test('approval waits for every scoped asset and a classification or lexical exclusion for every block', () => {
  const evidence = consoleFixture('sealed')!;
  assert.equal(classificationComplete(evidence), true);
  assert.equal(groupReady(evidence, evidence.groups[0]), true);
  evidence.pages.pop(); assert.equal(groupReady(evidence, evidence.groups[0]), false);
  const missing = consoleFixture('sealed')!; missing.judgments.pop();
  assert.equal(classificationComplete(missing), false);
  const missingBlock = consoleFixture('sealed')!; missingBlock.passages.pop();
  assert.equal(classificationComplete(missingBlock), false);
  const duplicatePage = consoleFixture('sealed')!; duplicatePage.pages[0] = duplicatePage.pages[1];
  assert.equal(classificationComplete(duplicatePage), false);
  const failed = consoleFixture('sealed')!; failed.run.errors.push({ code: 'provider_failure', message: 'Timed out' });
  assert.equal(groupReady(failed, failed.groups[0]), false);
});

test('a missing email token check, failed check, stale desired version or incomplete group disables approval', () => {
  for (const mutation of [
    (e: ReturnType<typeof RemoteExportSchema.parse>) => { e.patches.find(p => p.surface === 'email')!.checks = []; },
    (e: ReturnType<typeof RemoteExportSchema.parse>) => { e.patches[0].checks[0].pass = false; },
    (e: ReturnType<typeof RemoteExportSchema.parse>) => { e.patches[0].factVersion = 1; },
    (e: ReturnType<typeof RemoteExportSchema.parse>) => { e.groups[0].status = 'collecting'; },
    (e: ReturnType<typeof RemoteExportSchema.parse>) => { e.patches.shift(); },
  ]) {
    const evidence = consoleFixture('sealed')!; mutation(evidence);
    assert.equal(groupReady(evidence, evidence.groups[0]), false);
  }
});

test('bundle readiness requires all current approvals, all analysis results, and no existing submission', () => {
  const approved = RemoteExportSchema.parse(fixture.export);
  assert.equal(bundleReady(approved), true);
  approved.approvals[0].membershipHash = '0'.repeat(64); assert.equal(bundleReady(approved), false);
  const stale = RemoteExportSchema.parse(fixture.export); stale.groups[0].revision++;
  assert.equal(approvalMatches(stale, stale.groups[0]), false);
  const pending = RemoteExportSchema.parse(fixture.export); pending.run.stats.allResultsReadyMs = null;
  assert.equal(bundleReady(pending), false);
  assert.equal(bundleReady(consoleFixture('failedpreview')!), false);
  assert.equal(bundleReady(consoleFixture('sealed')!), false);
});

test('live runs reject test approvals and count human actions separately', () => {
  const evidence = RemoteExportSchema.parse(fixture.export);
  evidence.run.mode = 'live';
  assert.equal(bundleReady(evidence), false);
  assert.deepEqual(actionCounts(evidence), { approvals: 0, submissions: 0, abandonments: 0, reconciliations: 0 });
  evidence.approvals[0].actor = 'human';
  assert.equal(actionCounts(evidence).approvals, 1);
});

test('requests pin v2 attempt, source baseline, displayed group revision and complete candidate', () => {
  const evidence = RemoteExportSchema.parse(fixture.export);
  assert.deepEqual(confirmRequest(evidence.attempt.id, evidence.attempt.baselineHash, 'confirm-key'), {
    contractVersion: 2, launchAttemptId: evidence.attempt.id, baselineHash: evidence.attempt.baselineHash, expectedFactVersion: 1, idempotencyKey: 'confirm-key',
  });
  const approval = approvalRequest(evidence, evidence.groups[0], 'approve-key');
  assert.equal(approval.expectedRevision, evidence.groups[0].revision);
  assert.equal(approval.membershipHash, evidence.groups[0].membershipHash);
  const candidate = CandidateSchema.parse(fixture.responses.submit.submission.candidate);
  const submit = submissionRequest(evidence, candidate, 'submit-key');
  assert.equal(submit.approvals.length, 4); assert.equal(submit.bundleHash, candidate.bundleHash);
  assert.throws(() => submissionRequest(evidence, { ...candidate, baseSha: '0'.repeat(40) }, 'submit-key'), /candidate changed/);
});

test('preview, merge and public verification have independent matching records', () => {
  const failedPreview = consoleFixture('failedpreview')!;
  assert.equal(latestObservation(failedPreview, 'preview')!.verification, 'failed');
  assert.equal(latestObservation(failedPreview, 'production'), null);
  assert.equal(publicVerified(failedPreview), false);
  const mergedFailure = consoleFixture('mergedfailure')!;
  assert.equal(latestObservation(mergedFailure, 'preview')!.verification, 'passed');
  assert.equal(publicVerified(mergedFailure), false);
  const verified = consoleFixture('verified')!;
  assert.equal(publicVerified(verified), true);
  verified.observations[1].candidateSha = '0'.repeat(40);
  assert.equal(latestObservation(verified, 'production'), null);
  assert.equal(publicVerified(verified), false);
});

test('recovery requests bind the recorded revision and production observation', () => {
  const evidence = consoleFixture('mergedfailure')!;
  const observed = latestObservation(evidence, 'production')!;
  assert.equal(abandonRequest(evidence, 'Retire stale attempt', 'abandon-key').expectedSubmissionRevision, evidence.submission!.revision);
  const reconcile = reconcileRequest(evidence, observed, 'Observed failure', 'reconcile-key');
  assert.equal(reconcile.observedDeploymentId, observed.deploymentId);
  assert.throws(() => reconcileRequest(evidence, latestObservation(evidence, 'preview')!, 'Failure', 'reconcile-key'), /production deployment/);
});

test('every visual fixture remains strict v2 fixture evidence and grants no human credit', () => {
  assert.match(fixtureNotice, /synthetic/); assert.match(fixtureNotice, /cannot approve, submit, merge or publish/);
  for (const state of fixtureStates) {
    const evidence = consoleFixture(state);
    if (state === 'initial') { assert.equal(evidence, null); continue; }
    assert.equal(RemoteExportSchema.parse(evidence).run.mode, 'fixture');
    assert.equal(actionCounts(evidence!).approvals, 0);
  }
});
