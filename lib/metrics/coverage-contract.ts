import { z } from 'zod';
import { hashRecord, sha256 } from '../hash';
import { ClaimKindSchema, HashSchema, LabelSchema, SurfaceSchema, TargetSchema } from '../types';

export const DETERMINISTIC_KINDS = ['direct_price', 'annual_savings', 'per_day', 'plan_gap'] as const;
export const DeterministicKindSchema = z.enum(DETERMINISTIC_KINDS);
export type DeterministicKind = z.infer<typeof DeterministicKindSchema>;
const SplitSchema = z.enum(['featured', 'tuning', 'heldout']);
const AuthorSchema = z.enum(['jeremy', 'agent', 'generator']);
const IdSchema = z.string().min(1);
const CaseSchema = z.object({
  passageId: IdSchema, sourceId: z.string().regex(/^[a-z][a-z0-9-]*$/), assetId: IdSchema, surface: SurfaceSchema, editable: z.boolean(),
  text: z.string().min(1), textHash: HashSchema, kind: ClaimKindSchema, expectedLabel: LabelSchema, target: TargetSchema.nullable(),
  expectedReplacement: z.string().nullable(), expectedWithhold: z.string().nullable(), familyId: IdSchema, templateId: IdSchema,
  split: SplitSchema, authoredBy: AuthorSchema,
}).strict();
const FamilySchema = z.object({
  familyId: IdSchema, kind: ClaimKindSchema, templateId: IdSchema, split: SplitSchema, authoredBy: AuthorSchema,
  memberPassageIds: z.array(IdSchema).min(1), representativePassageId: IdSchema.nullable(),
}).strict();
const AssetSchema = z.object({ assetId: IdSchema, surface: SurfaceSchema, editable: z.boolean(), sourceHash: HashSchema }).strict();
const PayloadSchema = z.object({
  contractVersion: z.literal('remote0-coverage-v1'), id: IdSchema, evidenceKind: z.enum(['fixture', 'frozen_corpus']), scenarioId: IdSchema,
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/).nullable(), corpusHash: HashSchema, labelHash: HashSchema, factHash: HashSchema,
  targets: z.record(DeterministicKindSchema, TargetSchema), assets: z.array(AssetSchema).min(1), families: z.array(FamilySchema).min(1), cases: z.array(CaseSchema).min(1),
}).strict();
export const CoverageRegistrySchema = PayloadSchema.extend({ registryHash: HashSchema }).superRefine((registry, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const { registryHash, ...payload } = registry;
  if (hashRecord(payload) !== registryHash) issue('Coverage registry hash does not match its immutable payload.');
  if (registry.evidenceKind === 'frozen_corpus' && registry.sourceCommit === null) issue('A frozen corpus requires a source commit.');
  const assets = new Map(registry.assets.map(asset => [asset.assetId, asset]));
  const cases = new Map(registry.cases.map(item => [item.passageId, item]));
  const families = new Map(registry.families.map(family => [family.familyId, family]));
  if (assets.size !== registry.assets.length) issue('Duplicate asset identity.');
  if (cases.size !== registry.cases.length) issue('Duplicate passage identity: each case must resolve exactly once.');
  if (families.size !== registry.families.length) issue('Duplicate family identity.');
  const copies = new Map<string, string>(), templateFamilies = new Map<string, string>();
  for (const item of registry.cases) {
    const asset = assets.get(item.assetId), family = families.get(item.familyId);
    if (!asset || asset.surface !== item.surface || asset.editable !== item.editable) issue('Case asset/surface/editable mismatch: ' + item.passageId);
    if (item.passageId !== item.assetId + '#' + item.sourceId || sha256(item.text) !== item.textHash) issue('Case source identity or text hash mismatch: ' + item.passageId);
    if (!family || family.kind !== item.kind || family.split !== item.split || family.authoredBy !== item.authoredBy) issue('Case family kind/split/author mismatch: ' + item.passageId);
    if (item.expectedReplacement !== null && (item.expectedLabel !== 'contradicting' || item.target === null || !DETERMINISTIC_KINDS.includes(item.kind as DeterministicKind))) issue('Only deterministic contradictions may carry a repair assertion: ' + item.passageId);
    if (item.expectedLabel !== 'contradicting' && (item.target !== null || item.expectedReplacement !== null)) issue('Protected or ambiguous cases cannot carry a correction target: ' + item.passageId);
    if (item.target !== null && (!DETERMINISTIC_KINDS.includes(item.kind as DeterministicKind) || hashRecord(item.target) !== hashRecord(registry.targets[item.kind as DeterministicKind]))) issue('Case target does not match pinned desired values: ' + item.passageId);
    const copyKey = item.kind + ':' + item.text.toLowerCase().replace(/\s+/g, ' ').trim();
    const copyFamily = copies.get(copyKey);
    if (copyFamily && copyFamily !== item.familyId) issue('Identical wording cannot inflate independent families or cross their splits: ' + item.passageId);
    copies.set(copyKey, item.familyId);
    const templateFamily = templateFamilies.get(item.templateId);
    if (templateFamily && templateFamily !== item.familyId) issue('A template ID belongs to one family.');
    templateFamilies.set(item.templateId, item.familyId);
  }
  const unitForKind = { direct_price: 'usd', annual_savings: 'percent', per_day: 'usd_per_day', plan_gap: 'usd' } as const;
  for (const kind of DETERMINISTIC_KINDS) if (registry.targets[kind].unit !== unitForKind[kind] || registry.targets[kind].scope !== 'public') issue('Deterministic target unit/scope mismatch: ' + kind);
  for (const family of registry.families) {
    const members = registry.cases.filter(item => item.familyId === family.familyId).map(item => item.passageId);
    if (new Set(family.memberPassageIds).size !== family.memberPassageIds.length || members.length !== family.memberPassageIds.length || members.some(id => !family.memberPassageIds.includes(id))) issue('Family membership must match every declared case exactly once: ' + family.familyId);
    const needsRepresentative = family.split === 'heldout' && DETERMINISTIC_KINDS.includes(family.kind as DeterministicKind) && members.some(id => cases.get(id)?.expectedLabel === 'contradicting');
    if (needsRepresentative && family.representativePassageId === null) issue('A held-out deterministic family requires a frozen representative: ' + family.familyId);
    if (family.representativePassageId === null) continue;
    const representative = cases.get(family.representativePassageId);
    if (family.split !== 'heldout' || !DETERMINISTIC_KINDS.includes(family.kind as DeterministicKind)) issue('Featured/tuning/nondeterministic families cannot enter held-out repair gates: ' + family.familyId);
    if (!representative || !family.memberPassageIds.includes(family.representativePassageId) || representative.familyId !== family.familyId || representative.expectedLabel !== 'contradicting' || representative.surface !== 'web' || !representative.editable || representative.expectedReplacement === null || representative.target === null) issue('Representative must resolve once to an editable-web deterministic eligible contradiction: ' + family.familyId);
    if (representative && DETERMINISTIC_KINDS.includes(family.kind as DeterministicKind) && hashRecord(representative.target) !== hashRecord(registry.targets[family.kind as DeterministicKind])) issue('Representative target does not match pinned desired values: ' + family.familyId);
  }
});
export type CoverageRegistry = z.infer<typeof CoverageRegistrySchema>;
export type CoverageRegistryInput = z.infer<typeof PayloadSchema>;
export type CoverageCase = z.infer<typeof CaseSchema>;
export type CoverageFamily = z.infer<typeof FamilySchema>;
export function freezeCoverageRegistry(input: CoverageRegistryInput): CoverageRegistry {
  const payload = PayloadSchema.parse(input);
  return CoverageRegistrySchema.parse({ ...payload, registryHash: hashRecord(payload) });
}
export function assertCoverageResolution(registryInput: CoverageRegistry, passages: Array<{ id: string; assetId: string; sourceId: string; text: string }>, assets?: Array<{ assetId: string; sourceHash: string }>): void {
  const registry = CoverageRegistrySchema.parse(registryInput), observed = new Map(passages.map(passage => [passage.id, passage]));
  if (observed.size !== passages.length || passages.length !== registry.cases.length) throw new Error('Every frozen passage must resolve exactly once; missing, duplicate or unlabelled blocks are invalid.');
  for (const item of registry.cases) {
    const passage = observed.get(item.passageId);
    if (!passage || passage.assetId !== item.assetId || passage.sourceId !== item.sourceId || passage.text !== item.text) throw new Error('Frozen coverage source mismatch: ' + item.passageId);
  }
  if (assets) {
    const observedAssets = new Map(assets.map(asset => [asset.assetId, asset.sourceHash]));
    if (observedAssets.size !== assets.length || assets.length !== registry.assets.length || registry.assets.some(asset => observedAssets.get(asset.assetId) !== asset.sourceHash)) throw new Error('Frozen coverage asset inventory or source hashes do not match.');
  }
}

const OutcomeSchema = z.object({ passageId: IdSchema, status: z.enum(['complete', 'filtered', 'error']), detected: z.boolean(), checkedRepair: z.boolean(), previewVerified: z.boolean(), productionVerified: z.boolean(), proposed: z.boolean() }).strict().superRefine((outcome, ctx) => {
  if (outcome.status !== 'complete' && [outcome.detected, outcome.checkedRepair, outcome.previewVerified, outcome.productionVerified].some(Boolean) || outcome.status === 'filtered' && outcome.proposed) ctx.addIssue({ code: 'custom', message: 'Filtered/error outcomes cannot claim completed stages; filtered cases cannot have proposals.' });
  if (outcome.checkedRepair && !outcome.detected || (outcome.previewVerified || outcome.productionVerified) && !outcome.checkedRepair) ctx.addIssue({ code: 'custom', message: 'Repairs require detection; verification requires a checked repair.' });
});
export type CoverageOutcome = z.infer<typeof OutcomeSchema>;
const stages = ['detected', 'checkedRepair', 'previewVerified', 'productionVerified'] as const;
export function scoreCoverage(registryInput: CoverageRegistry, outcomeInputs: CoverageOutcome[]) {
  const registry = CoverageRegistrySchema.parse(registryInput), outcomes = outcomeInputs.map(outcome => OutcomeSchema.parse(outcome));
  const byId = new Map(outcomes.map(outcome => [outcome.passageId, outcome]));
  if (byId.size !== outcomes.length || outcomes.some(outcome => !registry.cases.some(item => item.passageId === outcome.passageId))) throw new Error('Coverage outcomes require unique, known frozen passage IDs.');
  const required = (denominator: number) => Math.ceil(0.8 * denominator);
  const perKind = DETERMINISTIC_KINDS.map(kind => {
    const families = registry.families.filter(family => family.kind === kind && family.split === 'heldout' && family.representativePassageId !== null);
    const representatives = families.map(family => family.representativePassageId!);
    const eligible = families.length >= 5;
    const metrics = Object.fromEntries(stages.map(stage => {
      const numerator = representatives.filter(id => byId.get(id)?.status === 'complete' && byId.get(id)?.[stage]).length;
      return [stage, { numerator, denominator: representatives.length, pass: eligible ? numerator >= required(representatives.length) : null }];
    }));
    return { kind, eligibility: eligible ? 'eligible' as const : 'not_eligible' as const, independentFamilies: families.length, representatives, requiredSuccesses: eligible ? required(representatives.length) : null, metrics };
  });
  const heldoutRows = registry.cases.filter(item => item.split === 'heldout' && item.surface === 'web' && item.editable && item.expectedLabel === 'contradicting');
  const protections = SurfaceSchema.options.flatMap(surface => ['consistent', 'valid_exception', 'unrelated', 'insufficient_context'].map(label => {
    const cases = registry.cases.filter(item => item.surface === surface && item.expectedLabel === label);
    const proposals = cases.filter(item => byId.get(item.passageId)?.proposed).length;
    const unresolved = cases.filter(item => !byId.has(item.passageId) || byId.get(item.passageId)?.status === 'error').length;
    return { surface, label, denominator: cases.length, proposals, unresolved, pass: cases.length ? proposals === 0 && unresolved === 0 : null };
  }));
  return {
    evidenceKind: registry.evidenceKind, registryHash: registry.registryHash,
    perKind, independentGateEligibility: perKind.every(item => item.eligibility === 'eligible') ? 'eligible' as const : 'not_eligible' as const,
    workload: { assets: registry.assets.length, cases: registry.cases.length, heldoutContradictingWebRows: heldoutRows.length, detectedHeldoutRows: heldoutRows.filter(item => byId.get(item.passageId)?.detected).length },
    protections,
    heldoutDetection: { numerator: heldoutRows.filter(item => byId.get(item.passageId)?.detected).length, denominator: heldoutRows.length, requiredSuccesses: heldoutRows.length ? required(heldoutRows.length) : null, pass: heldoutRows.length ? heldoutRows.filter(item => byId.get(item.passageId)?.detected).length >= required(heldoutRows.length) : null },
  };
}
