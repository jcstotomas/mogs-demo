import { z } from 'zod';

export const LabelSchema = z.enum(['contradicting', 'consistent', 'valid_exception', 'unrelated', 'insufficient_context']);
export const ClaimKindSchema = z.enum(['direct_price', 'annual_savings', 'threshold', 'per_day', 'plan_gap', 'other_pricing', 'none']);
export const SurfaceSchema = z.enum(['web', 'email']);
export const AudienceSchema = z.enum(['new_customers', 'existing_customers', 'unspecified', 'historical']);
export const RoleSchema = z.enum(['body', 'heading', 'list_item', 'subject', 'preheader']);
export const PlanIdSchema = z.enum(['starter', 'team', 'business']);
export const AdapterSchema = z.enum(['jev', 'frontier']);
export const UnitSchema = z.enum(['usd', 'usd_per_day', 'percent']);
export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const Id = z.string().min(1);
const Time = z.iso.datetime();
const Count = z.number().int().nonnegative();
const Probability = z.number().min(0).max(1);
export const DerivedKeySchema = z.enum(['annual_savings_percent', 'per_day_usd', 'lowest_monthly_usd', 'lowest_annual_effective_monthly_usd', 'team_starter_gap_usd']);
export const DerivedDeltaSchema = z.object({ unit: UnitSchema, before: z.number().finite(), after: z.number().finite() }).strict();
export const TargetSchema = z.object({ value: z.number().finite(), unit: UnitSchema, scope: z.enum(['public', 'legacy']) }).strict();
export const FactSnapshotSchema = z.object({
  scenarioId: Id, version: z.number().int().positive(), company: z.literal('MOGS'), phase: z.enum(['initial', 'confirmed']),
  effectiveDate: z.iso.date(), plans: z.record(PlanIdSchema, z.object({ monthlyCents: Count, annualCents: Count }).strict()),
  change: z.object({ id: Id, plan: z.literal('starter'), fromCents: Count, toCents: Count, billing: z.literal('monthly'), appliesTo: z.literal('non_legacy_eligible'), legacyRateCents: Count, legacyCutoff: Time }).strict(),
  exceptions: z.array(z.string()), derived: z.record(DerivedKeySchema, DerivedDeltaSchema),
}).strict();
export const AssetMetadataSchema = z.object({ title: z.string().min(1), kind: z.string().min(1), audienceHint: AudienceSchema, legacyStarterEligible: z.boolean().nullable(), journey: z.string().optional() }).strict();
export const PageSchema = z.object({ assetId: Id, file: z.string().nullable(), url: z.string().url(), surface: SurfaceSchema, editable: z.boolean(), sourceHash: HashSchema, metadataHash: HashSchema, crawledAt: Time, meta: AssetMetadataSchema }).strict();
export const PassageSchema = z.object({ id: Id, assetId: Id, sourceId: Id, url: z.string().url(), surface: SurfaceSchema, editable: z.boolean(), role: RoleSchema, idx: Count, text: z.string(), blockHash: HashSchema, contextHash: HashSchema, heading: z.string(), before: z.string(), after: z.string() }).strict();
export const ProviderConfigSchema = z.object({
  adapter: AdapterSchema.nullable(), connection: z.enum(['typesafe_http', 'anthropic_direct']).nullable(), fixConnection: z.literal('anthropic_direct'), judgeModel: z.string(), fixModel: z.string(),
  tRel: Probability, tLabel: Probability, concurrency: z.number().int().positive(), timeoutMs: z.number().int().positive(), promptVersion: z.enum(['step0-v1', 'gate1-v2']),
}).strict();
export const RunStatsSchema = z.object({
  assetsIndexed: Count, passagesIndexed: Count, candidates: Count, judged: Count, patchesDrafted: Count, withheld: Count, groups: Count, published: Count, verified: Count,
  byLabel: z.record(LabelSchema, Count), bySurface: z.record(SurfaceSchema, z.object({ assets: Count, passages: Count, contradictions: Count, patches: Count }).strict()),
  reviewActions: Count, machineMs: Count, humanMs: Count, firstSealedGroupMs: Count.nullable(), allResultsReadyMs: Count.nullable(),
}).strict();
export const RunSchema = z.object({
  id: Id, changeId: Id, factVersion: z.number().int().positive(), mode: z.enum(['live', 'eval', 'fixture']),
  scope: z.object({ assetIds: z.array(Id).min(1), urls: z.array(z.string().url()).min(1), corpusHash: HashSchema }).strict(), config: ProviderConfigSchema,
  confirmedAt: Time, status: z.enum(['collecting', 'classifying', 'drafting', 'ready', 'failed']), stats: RunStatsSchema,
  errors: z.array(z.object({ code: z.string(), message: z.string(), passageId: Id.optional() }).strict()), updatedAt: Time,
}).strict().superRefine((run, ctx) => {
  if (run.scope.assetIds.length !== run.scope.urls.length || new Set(run.scope.assetIds).size !== run.scope.assetIds.length || new Set(run.scope.urls).size !== run.scope.urls.length)
    ctx.addIssue({ code: 'custom', message: 'Run scope IDs and URLs must be unique and pair one-to-one.' });
});
export const JudgmentSchema = z.object({
  runId: Id, passageId: Id, factVersion: z.number().int().positive(), relevant: Probability, kind: ClaimKindSchema, audience: AudienceSchema,
  billing: z.enum(['monthly', 'annual', 'unspecified']), label: LabelSchema, confidence: Probability.nullable(), probabilities: z.record(LabelSchema, Probability).nullable(),
  confidenceSource: z.enum(['jev', 'frontier_adapter', 'unavailable']), adapter: AdapterSchema, model: z.string(),
  escalatedBy: z.enum(['low_confidence', 'scope_conflict', 'low_relevance_conflict']).nullable(),
}).strict().superRefine((j, ctx) => {
  if (j.adapter === 'frontier' && (j.probabilities !== null || j.confidenceSource === 'jev')) ctx.addIssue({ code: 'custom', message: 'Frontier scores cannot masquerade as Jev probabilities.' });
  if (j.confidenceSource === 'unavailable' && j.confidence !== null) ctx.addIssue({ code: 'custom', message: 'Unavailable confidence must be null.' });
  if (j.adapter === 'jev' && (j.confidenceSource !== 'jev' || j.confidence === null || j.probabilities === null)) ctx.addIssue({ code: 'custom', message: 'Jev needs its own confidence and probabilities.' });
});
export const CheckNameSchema = z.enum(['span_confined', 'numbers_allowed', 'qualifiers_kept', 'rejudge_consistent', 'source_located', 'source_fresh', 'fact_fresh', 'tokens_kept']);
export const CheckSchema = z.object({ name: CheckNameSchema, pass: z.boolean(), detail: z.string() }).strict();
export const PatchSchema = z.object({
  id: Id, runId: Id, passageId: Id, sourceId: Id, assetId: Id, url: z.string().url(), surface: SurfaceSchema, factVersion: z.number().int().positive(),
  kind: ClaimKindSchema, target: TargetSchema.nullable(), original: z.string(), replacement: z.string().nullable(), rationale: z.string().nullable(), withholdReason: z.string().nullable(),
  originalCapturedFileHash: HashSchema, expectedFileHash: HashSchema, expectedBlockHash: HashSchema, expectedContextHash: HashSchema, expectedMetadataHash: HashSchema,
  checks: z.array(CheckSchema), revision: Count, status: z.enum(['drafted', 'withheld', 'dropped', 'stale', 'published', 'verified', 'failed_verify']), groupId: Id.nullable(), editedByHuman: z.boolean(),
}).strict().superRefine((patch, ctx) => {
  if (['drafted', 'published', 'verified', 'failed_verify'].includes(patch.status) && (!['direct_price', 'annual_savings', 'per_day', 'plan_gap'].includes(patch.kind) || patch.target === null || !patch.replacement || !patch.rationale || patch.withholdReason !== null)) ctx.addIssue({ code: 'custom', message: 'Publishable corrections need deterministic kind/target, text/rationale, and no withholding reason.' });
  if (patch.status === 'withheld' && !patch.withholdReason) ctx.addIssue({ code: 'custom', message: 'Withheld patch needs a reason.' });
  if (new Set(patch.checks.map(check => check.name)).size !== patch.checks.length) ctx.addIssue({ code: 'custom', message: 'Duplicate check names.' });
});
export const GroupSchema = z.object({
  id: Id, runId: Id, factVersion: z.number().int().positive(), key: Id, title: z.string(), memberIds: z.array(Id), eligibleIds: z.array(Id), excludedIds: z.array(Id),
  bySurface: z.record(SurfaceSchema, z.object({ eligible: Count, excluded: Count }).strict()), membershipHash: HashSchema, revision: Count, sealedAt: Time.nullable(),
  status: z.enum(['collecting', 'sealed', 'blocked', 'publishing', 'published', 'verified', 'failed_publish', 'failed_verify']), publicationId: Id.nullable(),
}).strict().superRefine((g, ctx) => {
  const members = new Set(g.memberIds), eligible = new Set(g.eligibleIds), excluded = new Set(g.excludedIds);
  if (members.size !== g.memberIds.length || eligible.size !== g.eligibleIds.length || excluded.size !== g.excludedIds.length || g.eligibleIds.some(id => !members.has(id) || excluded.has(id)) || g.excludedIds.some(id => !members.has(id)) || eligible.size + excluded.size !== members.size)
    ctx.addIssue({ code: 'custom', message: 'Group members must partition into eligible and excluded IDs.' });
  if (g.status === 'sealed' && (g.sealedAt === null || eligible.size === 0)) ctx.addIssue({ code: 'custom', message: 'A sealed group needs a timestamp and eligible members.' });
});
export const VerificationSchema = z.object({ passageId: Id, url: z.string().url(), sourceObserved: z.boolean(), observedHash: HashSchema.nullable(), judgment: JudgmentSchema.nullable(), pass: z.boolean(), detail: z.string(), checkedAt: Time }).strict().superRefine((result, ctx) => {
  if (result.pass && (!result.sourceObserved || result.observedHash === null || result.judgment === null || result.judgment.passageId !== result.passageId || !['consistent', 'valid_exception'].includes(result.judgment.label))) ctx.addIssue({ code: 'custom', message: 'Verification success requires source observation and a matching passing verdict.' });
});
export const PublicationFileSchema = z.object({ file: z.string(), beforeHash: HashSchema, afterHash: HashSchema, beforeSource: z.string(), afterSource: z.string(), state: z.enum(['staged', 'replaced', 'restored']) }).strict();
export const PublicationSchema = z.object({
  id: Id, runId: Id, groupId: Id, factVersion: z.number().int().positive(), idempotencyKey: Id, requestFingerprint: HashSchema, approvedRevision: Count, approvedMemberIds: z.array(Id), actor: z.enum(['human', 'test']),
  status: z.enum(['prepared', 'writing', 'published', 'verified', 'failed_publish', 'failed_verify', 'recovering', 'recovered', 'blocked']),
  files: z.array(PublicationFileSchema), verification: z.array(VerificationSchema), createdAt: Time, updatedAt: Time, failure: z.string().nullable(),
}).strict();
export const ReviewEventSchema = z.object({ id: Id, runId: Id, groupId: Id.nullable(), patchId: Id.nullable(), actor: z.enum(['human', 'test', 'system']), action: z.enum(['open', 'approve', 'edit', 'drop', 'revision_advance', 'verify', 'recover']), at: Time, detail: z.string() }).strict();
export const ManifestRowSchema = z.object({
  id: Id, passageId: Id, sourceId: Id, assetId: Id, url: z.string().url(), surface: SurfaceSchema, text: z.string(), kind: ClaimKindSchema, templateId: Id, expectedLabel: LabelSchema,
  target: TargetSchema.nullable(), expectedReplacement: z.string().nullable(), expectedWithhold: z.string().nullable(), split: z.enum(['tuning', 'heldout', 'featured']), author: z.enum(['jeremy', 'agent', 'generator']),
  scenarioId: Id, expectedFactVersion: z.number().int().positive(),
}).strict();
export const MetricSchema = z.object({ numerator: Count, denominator: Count }).strict();
export const EvalReportSchema = z.object({
  id: Id, runId: Id, status: z.enum(['fixture', 'complete', 'failed']), corpusHash: HashSchema, labelHash: HashSchema, factHash: HashSchema, factVersion: z.number().int().positive(), config: ProviderConfigSchema,
  contentRoot: z.string(), databasePath: z.string(), baseUrl: z.string().url(), scriptedApprovals: z.array(Id), metrics: z.record(z.string(), MetricSchema), missingIds: z.array(Id), errors: z.array(z.string()), createdAt: Time,
}).strict();
export const FixResultSchema = z.object({ action: z.enum(['replace', 'withhold']), replacement: z.string().nullable(), rationale: z.string(), reason: z.string().nullable() }).strict().superRefine((fix, ctx) => {
  if (fix.action === 'replace' && (!fix.replacement || fix.reason !== null)) ctx.addIssue({ code: 'custom', message: 'Replacement requires text and no withholding reason.' });
  if (fix.action === 'withhold' && (fix.replacement !== null || !fix.reason)) ctx.addIssue({ code: 'custom', message: 'Withholding requires reason and no replacement.' });
});
export type Label = z.infer<typeof LabelSchema>;
export type ClaimKind = z.infer<typeof ClaimKindSchema>;
export type Surface = z.infer<typeof SurfaceSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type Audience = z.infer<typeof AudienceSchema>;
export type Adapter = z.infer<typeof AdapterSchema>;
export type FactSnapshot = z.infer<typeof FactSnapshotSchema>;
export type AssetMetadata = z.infer<typeof AssetMetadataSchema>;
export type Page = z.infer<typeof PageSchema>;
export type Passage = z.infer<typeof PassageSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type RunStats = z.infer<typeof RunStatsSchema>;
export type Run = z.infer<typeof RunSchema>;
export type Judgment = z.infer<typeof JudgmentSchema>;
export type Check = z.infer<typeof CheckSchema>;
export type Patch = z.infer<typeof PatchSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Publication = z.infer<typeof PublicationSchema>;
export type ReviewEvent = z.infer<typeof ReviewEventSchema>;
export type ManifestRow = z.infer<typeof ManifestRowSchema>;
export type EvalReport = z.infer<typeof EvalReportSchema>;
export type FixResult = z.infer<typeof FixResultSchema>;
export type Target = z.infer<typeof TargetSchema>;
