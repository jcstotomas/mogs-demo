import { z } from 'zod';
import { RequiredContextSchema, ShaSchema, StatusEvidenceSchema, type DeploymentObservation, type LaunchAttempt, type Submission } from '../runs/remote-types';
import { hashRecord, sha256 } from '../hash';
import { CheckNameSchema } from '../types';
import type { RemoteDatabase } from '../runs/remote-db';
import { extractRenderedAsset } from '../assets/source';
import { renderCanonicalPricingFromFacts } from '../deployment/pricing';

export const EnforcementEvidenceSchema = z.object({
  repository: z.string(), baseRef: z.string(), producerAppId: z.number().int().positive(),
  checks: z.array(z.object({ context: RequiredContextSchema, appId: z.number().int().positive() }).strict()),
  strict: z.literal(true), enforceAdmins: z.literal(true), bypassActors: z.array(z.never()),
  mergeQueue: z.literal(false), autoMerge: z.literal(false),
  probes: z.object({ pendingBlocked: z.literal(true), failureBlocked: z.literal(true), wrongHeadBlocked: z.literal(true), currentHeadEligible: z.literal(true) }).strict(),
  testedSha: ShaSchema, verifiedAt: z.iso.datetime(),
}).strict().superRefine((e, ctx) => {
  if (e.checks.length !== 2 || new Set(e.checks.map(c => c.context)).size !== 2 || e.checks.some(c => c.appId !== e.producerAppId)) ctx.addIssue({ code: 'custom', message: 'Both required contexts must bind the trusted App.' });
});
export type EnforcementEvidence = z.infer<typeof EnforcementEvidenceSchema>;

export function assertStatusAllowed(attempt: LaunchAttempt, submission: Submission, sha: string, context: z.infer<typeof RequiredContextSchema>, state: z.infer<typeof StatusEvidenceSchema>['state'], enforcement?: EnforcementEvidence): void {
  if (submission.launchAttemptId !== attempt.id || submission.runId !== attempt.runId) throw new Error('Status operation belongs to another attempt.');
  if (state === 'success') {
    const proof = EnforcementEvidenceSchema.parse(enforcement);
    if (proof.repository !== attempt.baseline.target.repository || proof.baseRef !== attempt.baseline.target.baseRef || proof.producerAppId !== attempt.baseline.target.statusProducerAppId) throw new Error('Merge enforcement is not proven for this target.');
    if (attempt.state !== 'active' || submission.status !== 'submitted' || submission.journal !== 'pr_opened' || sha !== submission.candidate.candidateSha || sha !== submission.observedHeadSha) throw new Error('Inactive, changed or unknown candidate cannot receive success.');
    if (!RequiredContextSchema.options.includes(context)) throw new Error('Unknown required context.');
  }
}

/** Hash functions identify durable proof; knowing a hash does not authorize success. */
export function candidateStatusEvidenceHash(db: RemoteDatabase, runId: string): string {
  const submission = db.getSubmission(runId), checks = db.getCandidateChecks(runId), images = db.getCandidateImages(runId);
  if (!submission || !checks || !images) throw new Error('Durable candidate evidence is missing.');
  return hashRecord({ contractVersion: 2, context: 'mogs/candidate', candidate: submission.candidate, checks, imageHashes: Object.fromEntries(Object.entries(images).map(([file, source]) => [file, sha256(source)])) });
}
export function previewStatusEvidenceHash(observation: DeploymentObservation): string { return hashRecord({ contractVersion: 2, context: 'mogs/preview', observation }); }

/** Called immediately before a success status. No caller-supplied boolean can replace proof. */
export function authorizeStatusSuccess(db: RemoteDatabase, input: Submission, sha: string, context: z.infer<typeof RequiredContextSchema>, evidenceHash: string, options: { testOnlyAllowFixtureEvidence?: boolean } = {}): void {
  const submission = db.getSubmission(input.runId), run = db.getRun(input.runId), attempt = submission && db.getAttempt(submission.launchAttemptId);
  if (!submission || !run || !attempt || submission.id !== input.id || hashRecord(submission.candidate) !== hashRecord(input.candidate) || attempt.state !== 'active' || submission.status !== 'submitted' || submission.journal !== 'pr_opened' || sha !== submission.candidate.candidateSha || sha !== submission.observedHeadSha) throw new Error('Success proof is stale or belongs to another candidate.');
  if (run.mode !== 'live' && !options.testOnlyAllowFixtureEvidence) throw new Error('Fixture/evaluation evidence cannot authorize production success.');
  const candidate = submission.candidate, images = db.getCandidateImages(run.id), checks = db.getCandidateChecks(run.id), eligibleIds = candidate.approvals.flatMap(approval => approval.eligibleIds);
  if (!images || !checks || hashRecord(Object.keys(images).sort()) !== hashRecord(candidate.files.map(file => file.path).sort()) || candidate.files.some(file => sha256(images[file.path] ?? '') !== file.afterHash)) throw new Error('Exact durable candidate images and checks are required.');
  if (candidate.purpose === 'correction') {
    if (run.status !== 'ready' || !eligibleIds.length || new Set(eligibleIds).size !== eligibleIds.length || hashRecord(Object.keys(checks).sort()) !== hashRecord([...eligibleIds].sort())) throw new Error('Candidate proof must cover every eligible correction.');
    for (const approval of candidate.approvals) {
      const group = db.getGroup(run.id, approval.groupId);
      if (!group || group.approvalId !== approval.id || !['approved', 'submitted'].includes(group.status) || hashRecord(db.getApproval(run.id, approval.id)) !== hashRecord(approval) || (run.mode === 'live' && approval.actor !== 'human')) throw new Error('Live candidate success requires the original human approvals.');
      db.assertApproval(group, approval);
    }
    for (const id of eligibleIds) {
      const patch = db.getPatch(run.id, id), proof = checks[id];
      if (!patch || !proof || new Set(proof.map(check => check.name)).size !== proof.length || proof.some(check => !check.pass) || CheckNameSchema.options.filter(name => name !== 'tokens_kept' || patch.surface === 'email').some(name => !proof.some(check => check.name === name && check.pass))) throw new Error('Complete passing combined checks are required.');
    }
  } else if (!attempt.seedRevision || candidate.approvals.length || Object.keys(checks).length || db.patches(run.id).length) throw new Error('Restoration cannot borrow correction approvals or checks.');
  if (context === 'mogs/candidate') {
    if (candidateStatusEvidenceHash(db, run.id) !== evidenceHash) throw new Error('Candidate success evidence hash does not match durable checks.');
    return;
  }
  const preview = db.observations(run.id).filter(observation => observation.environment === 'preview' && observation.candidateSha === sha).at(-1);
  const desired = db.getFacts(attempt.id, 'desired')?.snapshot;
  if (!preview || previewStatusEvidenceHash(preview) !== evidenceHash || !desired || preview.environment !== 'preview' || preview.launchAttemptId !== attempt.id || preview.submissionId !== submission.id || preview.candidateSha !== sha || preview.deployedSha !== sha || preview.mergedSha !== null || preview.readiness !== 'ready' || preview.verification !== 'passed' || preview.failures.length || !preview.publishedFacts || preview.factsHash !== candidate.desiredFactsHash || hashRecord(preview.publishedFacts) !== candidate.desiredFactsHash) throw new Error('Matching complete passing preview evidence is required.');
  const expectedAssets = attempt.baseline.assets.map(asset => ({ ...asset, sourceHash: asset.path ? images[asset.path] === undefined ? asset.sourceHash : sha256(images[asset.path]) : extractRenderedAsset(renderCanonicalPricingFromFacts(desired), new URL(asset.pathname, preview.url).href).page.sourceHash }));
  const expectedHashes = Object.fromEntries(expectedAssets.map(asset => [asset.assetId, asset.sourceHash]));
  if (hashRecord(preview.sourceHashes) !== hashRecord(expectedHashes) || preview.inventoryHash !== hashRecord(expectedAssets)) throw new Error('Preview proof omits or changes a mapped/protected asset.');
  const patches = eligibleIds.map(id => db.getPatch(run.id, id)!);
  if (hashRecord(preview.blocks.map(block => block.passageId).sort()) !== hashRecord(patches.map(patch => patch.passageId).sort())) throw new Error('Preview proof must cover every eligible correction exactly once.');
  for (const patch of patches) {
    const block = preview.blocks.find(value => value.passageId === patch.passageId)!, verdict = block.judgment;
    if (!block.pass || !block.sourceObserved || block.observedHash !== sha256(patch.replacement!) || !verdict || verdict.runId !== run.id || verdict.passageId !== patch.passageId || verdict.factVersion !== run.desiredFactVersion || verdict.kind !== patch.kind || verdict.adapter !== run.config.adapter || verdict.model !== run.config.judgeModel || verdict.escalatedBy !== null || !['consistent', 'valid_exception'].includes(verdict.label) || (verdict.adapter === 'jev' && (verdict.confidence === null || verdict.confidence < run.config.tLabel))) throw new Error('Preview proof lacks a fresh passing verdict for an approved correction.');
  }
}
