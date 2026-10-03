import { z } from 'zod';
import { FactSnapshotSchema, HashSchema, JudgmentSchema, PageSchema, PassageSchema, PatchSchema, ProviderConfigSchema, RunStatsSchema, SurfaceSchema, VerificationSchema } from '../types';

// v1 types and routes retain their local publication semantics. v2 uses this
// explicit entry point and /api/v2; the prompt revision gate1-v2 is unrelated.
export const CONTRACT_VERSION = 2 as const;
export const ShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const Id = z.string().min(1).max(200);
const Time = z.iso.datetime();
const Revision = z.number().int().nonnegative();
const Key = z.string().min(8).max(200);
export const RequiredContextSchema = z.enum(['mogs/candidate', 'mogs/preview']);
export const TargetRepositorySchema = z.object({
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/), baseRef: z.string().min(1),
  productionOrigin: z.url().refine(value => new URL(value).protocol === 'https:', 'Public target requires HTTPS.'),
  vercelProjectId: Id, vercelTeamId: Id, statusProducerAppId: z.number().int().positive(),
}).strict();
export const InventoryAssetSchema = z.object({
  assetId: Id, path: z.string().regex(/^content\/(?:site|email)\/.+\.md$/).nullable(), pathname: z.string().regex(/^\/(?:site\/|assets\/email\/)/),
  surface: SurfaceSchema, editable: z.boolean(), sourceHash: HashSchema, metadataHash: HashSchema,
  sourceIds: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).min(1),
}).strict().superRefine((a, ctx) => {
  if (new Set(a.sourceIds).size !== a.sourceIds.length || a.pathname.includes('..') || a.pathname.includes('?') || a.pathname.includes('#')) ctx.addIssue({ code: 'custom', message: 'Inventory IDs and mapped path must be unambiguous.' });
  if (a.editable !== (a.path !== null) || (!a.editable && a.pathname !== '/site/pricing') || a.path?.includes('..') || a.path?.includes('\\')) ctx.addIssue({ code: 'custom', message: 'Only mapped sources and read-only canonical pricing are permitted.' });
});
export const BaselineSchema = z.object({
  target: TargetRepositorySchema, baseSha: ShaSchema, deployedSha: ShaSchema,
  deploymentId: Id, deploymentUrl: z.url(), observedAt: Time,
  inventoryHash: HashSchema, corpusHash: HashSchema, factsHash: HashSchema, factsFileHash: HashSchema,
  assets: z.array(InventoryAssetSchema).min(1),
}).strict().superRefine((b, ctx) => {
  if (b.baseSha !== b.deployedSha) ctx.addIssue({ code: 'custom', message: 'Base head must equal observed production commit.' });
  if (new Set(b.assets.map(a => a.assetId)).size !== b.assets.length || new Set(b.assets.map(a => a.pathname)).size !== b.assets.length) ctx.addIssue({ code: 'custom', message: 'Baseline scope must resolve exactly once.' });
});
export const AttemptStateSchema = z.enum(['active', 'abandoning', 'merged_failure', 'verified', 'abandoned', 'reconciled_failure']);
export const LaunchAttemptSchema = z.object({
  contractVersion: z.literal(2), id: Id, runId: Id, purpose: z.enum(['correction', 'restoration']), seedRevision: ShaSchema.nullable(),
  baseline: BaselineSchema, baselineHash: HashSchema, beforeFactsHash: HashSchema, desiredFactsHash: HashSchema,
  state: AttemptStateSchema, revision: Revision, confirmedAt: Time,
  recoveryId: Id.nullable(), closedAt: Time.nullable(), closureReason: z.string().nullable(),
}).strict().superRefine((a, ctx) => {
  const terminal = ['verified', 'abandoned', 'reconciled_failure'].includes(a.state);
  if (terminal !== (a.closedAt !== null) || (terminal && !a.closureReason)) ctx.addIssue({ code: 'custom', message: 'Only known terminal attempts release the active slot.' });
  if ((a.purpose === 'restoration') !== (a.seedRevision !== null)) ctx.addIssue({ code: 'custom', message: 'Restoration pins its immutable seed revision.' });
});
export const AttemptFactsSchema = z.object({
  launchAttemptId: Id, phase: z.enum(['before', 'desired']), version: z.number().int().positive(),
  hash: HashSchema, snapshot: FactSnapshotSchema,
}).strict().superRefine((f, ctx) => { if (f.version !== f.snapshot.version) ctx.addIssue({ code: 'custom', message: 'Snapshot version mismatch.' }); });
export const RemoteRunSchema = z.object({
  contractVersion: z.literal(2), id: Id, launchAttemptId: Id, changeId: Id, desiredFactVersion: z.number().int().positive(),
  mode: z.enum(['live', 'eval', 'fixture']), baselineHash: HashSchema,
  scope: z.object({ assetIds: z.array(Id).min(1), urls: z.array(z.url()).min(1), corpusHash: HashSchema, inventoryHash: HashSchema }).strict(),
  config: ProviderConfigSchema, confirmedAt: Time, deadlineAt: Time, fullRunDeadlineMs: z.number().int().positive(),
  status: z.enum(['collecting', 'classifying', 'drafting', 'ready', 'failed']), filteredPassageIds: z.array(Id),
  stats: RunStatsSchema, errors: z.array(z.object({ code: Id, message: z.string(), passageId: Id.optional() }).strict()),
  updatedAt: Time,
}).strict().superRefine((r, ctx) => {
  if (r.scope.assetIds.length !== r.scope.urls.length || new Set(r.scope.assetIds).size !== r.scope.assetIds.length || new Set(r.scope.urls).size !== r.scope.urls.length) ctx.addIssue({ code: 'custom', message: 'Run scope IDs and URLs must pair exactly.' });
  if (Date.parse(r.deadlineAt) - Date.parse(r.confirmedAt) !== r.fullRunDeadlineMs) ctx.addIssue({ code: 'custom', message: 'Deadline is measured from original Confirm.' });
});
export const RemotePatchSchema = PatchSchema.safeExtend({ contractVersion: z.literal(2), launchAttemptId: Id });
export const RemoteJudgmentSchema = JudgmentSchema.safeExtend({ contractVersion: z.literal(2), launchAttemptId: Id });
export const RemoteGroupSchema = z.object({
  contractVersion: z.literal(2), id: Id, runId: Id, launchAttemptId: Id, factVersion: z.number().int().positive(),
  key: Id, title: z.string(), memberIds: z.array(Id), eligibleIds: z.array(Id), excludedIds: z.array(Id),
  membershipHash: HashSchema, revision: Revision, sealedAt: Time.nullable(),
  status: z.enum(['collecting', 'sealed', 'blocked', 'approved', 'submitted']),
  approvalId: Id.nullable(),
}).strict().superRefine((g, ctx) => {
  const all = new Set(g.memberIds), eligible = new Set(g.eligibleIds), excluded = new Set(g.excludedIds);
  if (all.size !== g.memberIds.length || eligible.size !== g.eligibleIds.length || excluded.size !== g.excludedIds.length || eligible.size + excluded.size !== all.size || [...eligible].some(id => !all.has(id) || excluded.has(id)) || [...excluded].some(id => !all.has(id))) ctx.addIssue({ code: 'custom', message: 'Membership must partition into eligible and excluded sets.' });
  if (['sealed', 'approved', 'submitted'].includes(g.status) && (!g.sealedAt || !g.eligibleIds.length)) ctx.addIssue({ code: 'custom', message: 'Approvable group requires complete checked eligible membership.' });
  if (['approved', 'submitted'].includes(g.status) && !g.approvalId) ctx.addIssue({ code: 'custom', message: 'Approved revision requires its recorded approval.' });
});
export const ApprovalSchema = z.object({
  id: Id, launchAttemptId: Id, runId: Id, groupId: Id, revision: Revision,
  membershipHash: HashSchema, eligibleIds: z.array(Id).min(1), desiredFactsHash: HashSchema,
  actor: z.enum(['human', 'test']), at: Time, requestFingerprint: HashSchema, checkedPatchHash: HashSchema,
}).strict();
export const CandidateFileSchema = z.object({ path: z.string().regex(/^(?:content\/(?:site|email)\/.+\.md|data\/facts\.json)$/), beforeHash: HashSchema, afterHash: HashSchema }).strict().refine(f => !f.path.includes('..') && !f.path.includes('\\'), 'Candidate path escapes mapping.');
export const CandidateSchema = z.object({
  id: Id, launchAttemptId: Id, runId: Id, purpose: z.enum(['correction', 'restoration']),
  baselineHash: HashSchema, baseSha: ShaSchema, desiredFactsHash: HashSchema,
  approvals: z.array(ApprovalSchema), files: z.array(CandidateFileSchema).min(1),
  bundleHash: HashSchema, treeHash: HashSchema, branch: z.string().regex(/^codex\/(?:launch|restore)-[a-zA-Z0-9_-]+$/),
  candidateSha: ShaSchema.nullable(), commitMessage: z.string().min(1), createdAt: Time,
}).strict().superRefine((c, ctx) => {
  if (!c.commitMessage.includes('Launch-Attempt: ' + c.launchAttemptId)) ctx.addIssue({ code: 'custom', message: 'Every candidate commit must bind unique attempt identity.' });
  if (new Set(c.files.map(f => f.path)).size !== c.files.length || !c.files.some(f => f.path === 'data/facts.json')) ctx.addIssue({ code: 'custom', message: 'Candidate has unique mapped files plus deterministic facts.' });
});
export const SubmissionSchema = z.object({
  id: Id, launchAttemptId: Id, runId: Id, candidate: CandidateSchema, revision: Revision,
  status: z.enum(['preparing', 'submitted', 'blocked', 'failed', 'closed']),
  journal: z.enum(['planned', 'branch_written', 'commit_written', 'pr_opened', 'retiring', 'closed', 'unknown']),
  operationId: Id, requestFingerprint: HashSchema, prNumber: z.number().int().positive().nullable(), prUrl: z.url().nullable(),
  observedHeadSha: ShaSchema.nullable(), failure: z.string().nullable(), createdAt: Time, updatedAt: Time,
}).strict().superRefine((s, ctx) => {
  if (s.status === 'submitted' && (!s.prNumber || !s.prUrl || !s.candidate.candidateSha || s.observedHeadSha !== s.candidate.candidateSha || s.journal !== 'pr_opened')) ctx.addIssue({ code: 'custom', message: 'Submitted requires known PR and matching immutable head.' });
});
export const StatusEvidenceSchema = z.object({
  context: RequiredContextSchema, sha: ShaSchema, state: z.enum(['pending', 'success', 'failure', 'error']),
  producerAppId: z.number().int().positive(), evidenceHash: HashSchema, statusUrl: z.url(), at: Time,
}).strict();
export const DeploymentObservationSchema = z.object({
  id: Id, launchAttemptId: Id, submissionId: Id, environment: z.enum(['preview', 'production']),
  deploymentId: Id, url: z.url(), candidateSha: ShaSchema, mergedSha: ShaSchema.nullable(), deployedSha: ShaSchema,
  readiness: z.enum(['pending', 'ready', 'failed']), verification: z.enum(['pending', 'passed', 'failed']),
  inventoryHash: HashSchema, factsHash: HashSchema, publishedFacts: FactSnapshotSchema.nullable(),
  sourceHashes: z.record(Id, HashSchema), blocks: z.array(VerificationSchema),
  failures: z.array(z.string()), observedAt: Time,
}).strict().superRefine((o, ctx) => {
  if (o.verification === 'passed' && (o.readiness !== 'ready' || !o.publishedFacts || o.failures.length || !o.blocks.length || o.blocks.some(b => !b.pass) || o.deployedSha !== (o.environment === 'preview' ? o.candidateSha : o.mergedSha))) ctx.addIssue({ code: 'custom', message: 'Passed verification needs matching deployment, complete checks and no failures.' });
});
export const RecoverySchema = z.object({
  id: Id, launchAttemptId: Id, submissionId: Id.nullable(), action: z.enum(['abandon', 'reconcile']),
  status: z.enum(['planned', 'statuses_revoked', 'pr_closed', 'merged_observed', 'reconciled', 'failed', 'unknown']),
  expectedAttemptRevision: Revision, expectedSubmissionRevision: Revision.nullable(),
  requestFingerprint: HashSchema, retiredShas: z.array(ShaSchema), statuses: z.array(StatusEvidenceSchema),
  prClosed: z.boolean(), mergedSha: ShaSchema.nullable(), observedDeploymentId: Id.nullable(),
  failure: z.string().nullable(), createdAt: Time, updatedAt: Time,
}).strict();
export const RemoteReviewEventSchema = z.object({
  contractVersion: z.literal(2), id: Id, launchAttemptId: Id, runId: Id,
  groupId: Id.nullable(), patchId: Id.nullable(),
  action: z.enum(['open', 'approve', 'edit', 'drop', 'submit', 'abandon', 'reconcile', 'restore', 'verify', 'recover']),
  actor: z.enum(['human', 'test', 'system']), at: Time, detail: z.string(),
}).strict();
const RequestBase = { contractVersion: z.literal(2), idempotencyKey: Key };
export const ConfirmRequestSchema = z.object({ ...RequestBase, launchAttemptId: z.uuid(), expectedFactVersion: z.literal(1), baselineHash: HashSchema }).strict();
export const RestoreRequestSchema = z.object({ ...RequestBase, launchAttemptId: z.uuid(), expectedFactVersion: z.number().int().positive(), baselineHash: HashSchema, seedRevision: ShaSchema }).strict();
export const ApproveRequestSchema = z.object({ ...RequestBase, launchAttemptId: Id, runId: Id, expectedRevision: Revision, membershipHash: HashSchema }).strict();
export const SubmitRequestSchema = z.object({ ...RequestBase, launchAttemptId: Id, runId: Id, expectedAttemptRevision: Revision, baseSha: ShaSchema, bundleHash: HashSchema, approvals: z.array(z.object({ groupId: Id, revision: Revision, membershipHash: HashSchema }).strict()).min(1) }).strict();
export const AbandonRequestSchema = z.object({ ...RequestBase, launchAttemptId: Id, runId: Id, expectedAttemptRevision: Revision, expectedSubmissionRevision: Revision.nullable(), reason: z.string().min(1) }).strict();
export const ReconcileRequestSchema = z.object({ ...RequestBase, launchAttemptId: Id, runId: Id, expectedAttemptRevision: Revision, observedDeploymentId: Id, reason: z.string().min(1) }).strict();
export const RemoteErrorSchema = z.object({ error: z.object({ code: z.enum(['validation', 'not_found', 'stale', 'busy', 'idempotency_conflict', 'provider_failure', 'remote_failure', 'enforcement_unavailable', 'unknown_remote_state', 'interrupted']), message: z.string(), retryable: z.boolean() }).strict() }).strict();
export const RemoteExportSchema = z.object({
  contractVersion: z.literal(2), attempt: LaunchAttemptSchema, facts: z.array(AttemptFactsSchema), run: RemoteRunSchema,
  pages: z.array(PageSchema), passages: z.array(PassageSchema), groups: z.array(RemoteGroupSchema), patches: z.array(RemotePatchSchema), judgments: z.array(RemoteJudgmentSchema),
  approvals: z.array(ApprovalSchema), submission: SubmissionSchema.nullable(), observations: z.array(DeploymentObservationSchema), recoveries: z.array(RecoverySchema), reviewEvents: z.array(RemoteReviewEventSchema),
}).strict();
export type Baseline = z.infer<typeof BaselineSchema>;
export type LaunchAttempt = z.infer<typeof LaunchAttemptSchema>;
export type RemoteRun = z.infer<typeof RemoteRunSchema>;
export type AttemptFacts = z.infer<typeof AttemptFactsSchema>;
export type Approval = z.infer<typeof ApprovalSchema>;
export type RemoteGroup = z.infer<typeof RemoteGroupSchema>;
export type Candidate = z.infer<typeof CandidateSchema>;
export type Submission = z.infer<typeof SubmissionSchema>;
export type Recovery = z.infer<typeof RecoverySchema>;
export type DeploymentObservation = z.infer<typeof DeploymentObservationSchema>;
export type RemoteExport = z.infer<typeof RemoteExportSchema>;
export type RemoteReviewEvent = z.infer<typeof RemoteReviewEventSchema>;
