import { hashRecord } from './hash';
import { CheckNameSchema, type Group, type Patch, type Run } from './types';
export function correctionKey(patch: Patch): string {
  if (!patch.target || !['direct_price', 'annual_savings', 'per_day', 'plan_gap'].includes(patch.kind)) throw new Error('Only deterministic corrections have approvable keys.');
  return [patch.factVersion, patch.kind, patch.target.value, patch.target.unit, patch.target.scope].join(':');
}
export function memberHash(ids: string[]): string { return hashRecord([...ids].sort()); }
export function assertGroupMembers(run: Run, group: Group, patches: Patch[]): void {
  if (group.runId !== run.id || group.factVersion !== run.factVersion || group.membershipHash !== memberHash(group.memberIds)) throw new Error('Group identity or membership hash mismatch.');
  if (new Set(patches.map(p => p.id)).size !== patches.length) throw new Error('Duplicate supplied patch IDs.');
  const counts = { web: { eligible: 0, excluded: 0 }, email: { eligible: 0, excluded: 0 } };
  for (const id of group.memberIds) {
    const patch = patches.find(p => p.id === id);
    if (!patch || patch.groupId !== group.id || patch.runId !== run.id || patch.factVersion !== run.factVersion) throw new Error('Missing, cross-run, or incorrectly associated patch.');
    const eligible = group.eligibleIds.includes(id);
    counts[patch.surface][eligible ? 'eligible' : 'excluded']++;
    if (eligible) {
      const required = CheckNameSchema.options.filter(name => name !== 'tokens_kept' || patch.surface === 'email');
      if (patch.status !== 'drafted' || !patch.replacement || patch.withholdReason !== null || correctionKey(patch) !== group.key || required.some(name => !patch.checks.find(check => check.name === name)?.pass) || patch.checks.some(check => !check.pass)) throw new Error('Eligible patch has failed/incomplete checks or different correction target.');
    }
  }
  if (hashRecord(counts) !== hashRecord(group.bySurface)) throw new Error('Surface counts do not match group members.');
}
