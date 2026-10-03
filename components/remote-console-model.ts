import {
  AbandonRequestSchema, ApproveRequestSchema, ConfirmRequestSchema, ReconcileRequestSchema, SubmitRequestSchema,
  type Candidate, type DeploymentObservation, type RemoteExport, type RemoteGroup,
} from '../lib/runs/remote-types';
import type { Patch } from '../lib/types';

export const checkNames: Record<Patch['checks'][number]['name'], string> = {
  span_confined: 'Focused edit', numbers_allowed: 'Correct values', qualifiers_kept: 'Scope preserved',
  rejudge_consistent: 'Model recheck', source_located: 'Source found', source_fresh: 'Source unchanged',
  fact_fresh: 'Current desired facts', tokens_kept: 'Email tags and links',
};
const requiredChecks = ['span_confined', 'numbers_allowed', 'qualifiers_kept', 'rejudge_consistent', 'source_located', 'source_fresh', 'fact_fresh'] as const;
export const labelNames = {
  contradicting: 'Needs correction', consistent: 'Already correct', valid_exception: 'Valid exception',
  unrelated: 'Unrelated', insufficient_context: 'Needs context',
};
export const runNames: Record<RemoteExport['run']['status'], string> = {
  collecting: 'Reading the assets', classifying: 'Checking all claims', drafting: 'Preparing checked corrections',
  ready: 'All results ready', failed: 'Analysis failed',
};
export const groupNames: Record<RemoteGroup['status'], string> = {
  collecting: 'Preparing', sealed: 'Ready for review', blocked: 'Blocked', approved: 'Approved for PR inclusion', submitted: 'Included in submitted PR',
};
export function checkedPatch(patch: Patch): boolean {
  const names = patch.surface === 'email' ? [...requiredChecks, 'tokens_kept'] : requiredChecks;
  return patch.status === 'drafted' && patch.replacement !== null && patch.checks.every(check => check.pass)
    && names.every(name => patch.checks.some(check => check.name === name && check.pass));
}

/** Readiness is derived from the named run's evidence; transport success alone never authorizes a button. */
export function classificationComplete(evidence: RemoteExport): boolean {
  const { run, attempt } = evidence;
  const scope = new Set(run.scope.assetIds);
  if (run.errors.length || run.status === 'failed' || run.baselineHash !== attempt.baselineHash
    || evidence.pages.length !== scope.size || new Set(evidence.pages.map(p => p.assetId)).size !== scope.size
    || evidence.pages.some(page => !scope.has(page.assetId))) return false;
  if (attempt.baseline.assets.some(asset => {
    const page = evidence.pages.find(p => p.assetId === asset.assetId);
    const blocks = evidence.passages.filter(p => p.assetId === asset.assetId);
    return !page || page.sourceHash !== asset.sourceHash || page.metadataHash !== asset.metadataHash
      || blocks.length !== asset.sourceIds.length || new Set(blocks.map(p => p.sourceId)).size !== asset.sourceIds.length
      || blocks.some(p => !asset.sourceIds.includes(p.sourceId));
  })) return false;
  const classified = new Set(evidence.judgments.filter(j => j.runId === run.id && j.launchAttemptId === attempt.id && j.factVersion === run.desiredFactVersion).map(j => j.passageId));
  const filtered = new Set(run.filteredPassageIds);
  return evidence.passages.length > 0 && evidence.passages.every(p => scope.has(p.assetId) && (classified.has(p.id) || filtered.has(p.id)))
    && [...filtered].every(id => evidence.passages.some(p => p.id === id));
}
export function groupReady(evidence: RemoteExport, group: RemoteGroup): boolean {
  if (!classificationComplete(evidence) || !['drafting', 'ready'].includes(evidence.run.status) || evidence.attempt.state !== 'active' || evidence.submission
    || group.runId !== evidence.run.id || group.launchAttemptId !== evidence.attempt.id
    || group.factVersion !== evidence.run.desiredFactVersion || group.status !== 'sealed' || !group.sealedAt || !group.eligibleIds.length) return false;
  return group.memberIds.every(id => evidence.patches.some(p => p.id === id && p.runId === evidence.run.id && p.groupId === group.id))
    && group.eligibleIds.every(id => {
      const patch = evidence.patches.find(p => p.id === id);
      const passage = patch ? evidence.passages.find(p => p.id === patch.passageId) : null;
      const page = patch ? evidence.pages.find(p => p.assetId === patch.assetId) : null;
      return !!patch && !!passage && !!page && passage.editable && patch.original === passage.text && patch.sourceId === passage.sourceId
        && patch.expectedFileHash === page.sourceHash && patch.expectedBlockHash === passage.blockHash
        && patch.expectedContextHash === passage.contextHash && patch.expectedMetadataHash === page.metadataHash
        && patch.launchAttemptId === evidence.attempt.id && patch.factVersion === evidence.run.desiredFactVersion && checkedPatch(patch);
    });
}
export function approvalMatches(evidence: RemoteExport, group: RemoteGroup): boolean {
  const approval = evidence.approvals.find(a => a.id === group.approvalId);
  return !!approval && approval.actor === (evidence.run.mode === 'live' ? 'human' : 'test')
    && approval.launchAttemptId === evidence.attempt.id && approval.runId === evidence.run.id
    && approval.groupId === group.id && approval.revision === group.revision
    && approval.membershipHash === group.membershipHash && approval.desiredFactsHash === evidence.attempt.desiredFactsHash
    && [...approval.eligibleIds].sort().join('\n') === [...group.eligibleIds].sort().join('\n');
}
export function bundleReady(evidence: RemoteExport): boolean {
  if (evidence.attempt.state !== 'active' || evidence.submission || evidence.run.status !== 'ready'
    || !classificationComplete(evidence) || evidence.run.stats.allResultsReadyMs === null) return false;
  const groups = evidence.groups.filter(group => group.eligibleIds.length);
  return groups.length > 0 && groups.every(group => group.status === 'approved' && approvalMatches(evidence, group)
    && group.eligibleIds.every(id => {
      const patch = evidence.patches.find(p => p.id === id);
      return !!patch && patch.factVersion === evidence.run.desiredFactVersion && checkedPatch(patch);
    }));
}
export function matchingObservations(evidence: RemoteExport, environment: DeploymentObservation['environment']) {
  const submission = evidence.submission;
  if (!submission?.candidate.candidateSha) return [];
  return evidence.observations.filter(o => o.launchAttemptId === evidence.attempt.id && o.submissionId === submission.id
    && o.candidateSha === submission.candidate.candidateSha && o.environment === environment).toSorted((a, b) => a.observedAt.localeCompare(b.observedAt));
}
export function latestObservation(evidence: RemoteExport, environment: DeploymentObservation['environment']) {
  return matchingObservations(evidence, environment).at(-1) ?? null;
}
export function publicVerified(evidence: RemoteExport): boolean {
  const observation = latestObservation(evidence, 'production');
  return evidence.attempt.state === 'verified' && !!observation && observation.verification === 'passed'
    && observation.readiness === 'ready' && observation.mergedSha !== null && observation.deployedSha === observation.mergedSha;
}
export function actionCounts(evidence: RemoteExport) {
  const events = evidence.reviewEvents.filter(event => event.actor === 'human');
  return { approvals: evidence.approvals.filter(a => a.actor === 'human').length,
    submissions: events.filter(e => e.action === 'submit').length,
    abandonments: events.filter(e => e.action === 'abandon').length,
    reconciliations: events.filter(e => e.action === 'reconcile').length };
}
export function approvalRequest(evidence: RemoteExport, group: RemoteGroup, idempotencyKey: string) {
  return ApproveRequestSchema.parse({ contractVersion: 2, idempotencyKey, launchAttemptId: evidence.attempt.id,
    runId: evidence.run.id, expectedRevision: group.revision, membershipHash: group.membershipHash });
}
export function confirmRequest(launchAttemptId: string, baselineHash: string, idempotencyKey: string) {
  return ConfirmRequestSchema.parse({ contractVersion: 2, idempotencyKey, launchAttemptId, expectedFactVersion: 1, baselineHash });
}
export function submissionRequest(evidence: RemoteExport, candidate: Candidate, idempotencyKey: string) {
  if (candidate.launchAttemptId !== evidence.attempt.id || candidate.runId !== evidence.run.id
    || candidate.baseSha !== evidence.attempt.baseline.baseSha || candidate.baselineHash !== evidence.attempt.baselineHash
    || candidate.desiredFactsHash !== evidence.attempt.desiredFactsHash) throw new Error('Prepared candidate changed. Refresh the complete bundle before submitting.');
  return SubmitRequestSchema.parse({ contractVersion: 2, idempotencyKey, launchAttemptId: evidence.attempt.id,
    runId: evidence.run.id, expectedAttemptRevision: evidence.attempt.revision, baseSha: candidate.baseSha, bundleHash: candidate.bundleHash,
    approvals: evidence.groups.filter(group => group.eligibleIds.length).map(group => ({ groupId: group.id, revision: group.revision, membershipHash: group.membershipHash })) });
}
export function abandonRequest(evidence: RemoteExport, reason: string, idempotencyKey: string) {
  return AbandonRequestSchema.parse({ contractVersion: 2, idempotencyKey, launchAttemptId: evidence.attempt.id, runId: evidence.run.id,
    expectedAttemptRevision: evidence.attempt.revision, expectedSubmissionRevision: evidence.submission?.revision ?? null, reason });
}
export function reconcileRequest(evidence: RemoteExport, observation: DeploymentObservation, reason: string, idempotencyKey: string) {
  if (observation.environment !== 'production' || observation.launchAttemptId !== evidence.attempt.id || observation.submissionId !== evidence.submission?.id)
    throw new Error('Reconciliation requires an observed production deployment for this attempt.');
  return ReconcileRequestSchema.parse({ contractVersion: 2, idempotencyKey, launchAttemptId: evidence.attempt.id, runId: evidence.run.id,
    expectedAttemptRevision: evidence.attempt.revision, observedDeploymentId: observation.deploymentId, reason });
}
