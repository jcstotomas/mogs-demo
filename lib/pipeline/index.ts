import { correctionKey, memberHash } from '../corrections';
import { targetForKind } from '../facts/derive';
import { sha256 } from '../hash';
import { fixWithFrontier, judge } from '../providers';
import { GroupSchema, JudgmentSchema, PatchSchema, type Check, type FactSnapshot, type Group, type Judgment, type Page, type Passage, type Patch, type Run } from '../types';
import { checkPatch } from './checks';

export { checkPatch };

const PRICE_LANGUAGE = /\$|%|\b(?:price|pricing|cost|pay|fee|plan|starter|team|business|monthly|annual|yearly|billing|billed|subscription|save|savings|discount|cheaper|afford|upgrade|dollars?|a\s+month|a\s+year|a\s+day)\b/i;

/** A generous candidate filter: an unchanged in-scope price is still judged. */
export function prefilter(p: Passage): boolean {
  return PRICE_LANGUAGE.test(p.text);
}

export async function classifyPassage(runId: string, p: Passage, page: Page, beforeFacts: FactSnapshot, afterFacts: FactSnapshot): Promise<Judgment> {
  if (p.assetId !== page.assetId || p.surface !== page.surface || p.url !== page.url) throw new Error('Passage and asset identity mismatch.');
  if (afterFacts.phase !== 'confirmed' || afterFacts.version !== beforeFacts.version + 1 || afterFacts.scenarioId !== beforeFacts.scenarioId) throw new Error('Classification needs the confirmed fact transition.');
  return JudgmentSchema.parse(await judge(runId, p, page, beforeFacts, afterFacts));
}

export async function draftPatch(runId: string, p: Passage, page: Page, j: Judgment, beforeFacts: FactSnapshot, afterFacts: FactSnapshot): Promise<Patch | null> {
  if (j.runId !== runId || j.passageId !== p.id || j.factVersion !== afterFacts.version) throw new Error('Judgment does not belong to this passage and fact version.');
  if (p.assetId !== page.assetId || p.surface !== page.surface || p.url !== page.url) throw new Error('Passage and asset identity mismatch.');
  if (j.label !== 'contradicting' || !p.editable || !page.editable) return null;

  const target = targetForKind(j.kind, afterFacts);
  let replacement: string | null = null;
  let rationale: string | null = null;
  let withholdReason: string | null = null;
  if (target === null) {
    withholdReason = 'No deterministic safe target for this claim kind; reviewer context is required.';
  } else {
    const result = await fixWithFrontier(p, page, beforeFacts, afterFacts, target);
    if (result.fix.action === 'replace' && result.fix.replacement && result.fix.rationale.trim()) {
      replacement = result.fix.replacement;
      rationale = result.fix.rationale;
    } else {
      withholdReason = result.fix.reason || 'Fix model did not return a complete, reviewable correction.';
    }
  }

  return PatchSchema.parse({
    id: 'patch-' + sha256(runId + '\0' + p.id).slice(0, 24),
    runId, passageId: p.id, sourceId: p.sourceId, assetId: p.assetId, url: p.url, surface: p.surface,
    factVersion: afterFacts.version, kind: j.kind, target, original: p.text, replacement, rationale, withholdReason,
    originalCapturedFileHash: page.sourceHash, expectedFileHash: page.sourceHash, expectedBlockHash: p.blockHash,
    expectedContextHash: p.contextHash, expectedMetadataHash: page.metadataHash,
    checks: [] as Check[], revision: 0, status: replacement ? 'drafted' : 'withheld', groupId: null, editedByHuman: false,
  });
}

/** Draft groups have deterministic IDs and complete eligible/excluded partitions; the coordinator binds and seals them. */
export function groupDrafts(run: Run, patches: Patch[]): Group[] {
  const buckets = new Map<string, Patch[]>();
  for (const patch of patches) {
    if (patch.runId !== run.id || patch.factVersion !== run.factVersion) throw new Error('Cross-run or stale patch cannot be grouped.');
    if (!patch.target || !['direct_price', 'annual_savings', 'per_day', 'plan_gap'].includes(patch.kind)) continue;
    const key = correctionKey(patch);
    const bucket = buckets.get(key) ?? [];
    bucket.push(patch);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, members]) => {
    const id = 'group-' + sha256(run.id + '\0' + key).slice(0, 24);
    const sorted = [...members].sort((a, b) => a.id.localeCompare(b.id));
    const required = (patch: Patch) => ['span_confined', 'numbers_allowed', 'qualifiers_kept', 'rejudge_consistent', 'source_located', 'source_fresh', 'fact_fresh', ...(patch.surface === 'email' ? ['tokens_kept'] : [])];
    const eligibleIds = sorted.filter(patch => patch.status === 'drafted' && required(patch).every(name => patch.checks.some(check => check.name === name && check.pass)) && patch.checks.every(check => check.pass)).map(patch => patch.id);
    const eligible = new Set(eligibleIds);
    const excludedIds = sorted.filter(patch => !eligible.has(patch.id)).map(patch => patch.id);
    const bySurface = { web: { eligible: 0, excluded: 0 }, email: { eligible: 0, excluded: 0 } };
    for (const patch of sorted) bySurface[patch.surface][eligible.has(patch.id) ? 'eligible' : 'excluded']++;
    const first = sorted[0];
    return GroupSchema.parse({
      id, runId: run.id, factVersion: run.factVersion, key,
      title: titleFor(first), memberIds: sorted.map(patch => patch.id), eligibleIds, excludedIds, bySurface,
      membershipHash: memberHash(sorted.map(patch => patch.id)), revision: 0, sealedAt: null,
      status: 'collecting', publicationId: null,
    });
  });
}

function titleFor(patch: Patch): string {
  const target = patch.target;
  if (!target) return 'Correction';
  switch (patch.kind) {
    case 'direct_price': return 'Starter public monthly price to $' + target.value;
    case 'annual_savings': return 'Starter annual savings to ' + target.value + '%';
    case 'per_day': return 'Starter cost per day to $' + target.value.toFixed(2);
    case 'plan_gap': return 'Team versus Starter monthly gap to $' + target.value;
    default: return 'Correction';
  }
}
