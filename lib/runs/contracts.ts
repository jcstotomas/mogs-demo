import type { Group, Patch, Run, RunStats } from '../types';
import { LabelSchema } from '../types';
import { assertGroupMembers } from '../corrections';
export { memberHash } from '../corrections';
export function emptyStats(): RunStats {
  return { assetsIndexed: 0, passagesIndexed: 0, candidates: 0, judged: 0, patchesDrafted: 0, withheld: 0, groups: 0, published: 0, verified: 0, byLabel: Object.fromEntries(LabelSchema.options.map(label => [label, 0])) as RunStats['byLabel'], bySurface: { web: { assets: 0, passages: 0, contradictions: 0, patches: 0 }, email: { assets: 0, passages: 0, contradictions: 0, patches: 0 } }, reviewActions: 0, machineMs: 0, humanMs: 0, firstSealedGroupMs: null, allResultsReadyMs: null };
}
export function assertRunTransition(from: Run['status'], to: Run['status']): void {
  const transitions: Record<Run['status'], Run['status'][]> = { collecting: ['classifying', 'failed'], classifying: ['drafting', 'failed'], drafting: ['ready', 'failed'], ready: [], failed: [] };
  if (from !== to && !transitions[from].includes(to)) throw new Error('Invalid run transition: ' + from + ' -> ' + to);
}
export function assertCanSeal(run: Run, group: Group, patches: Patch[], classifiedAssetIds: string[], terminalMemberIds: string[]): void {
  const scope = new Set(run.scope.assetIds);
  if (scope.size !== new Set(classifiedAssetIds).size || classifiedAssetIds.some(id => !scope.has(id)) || run.errors.length) throw new Error('Complete successful scope classification is required.');
  if (group.runId !== run.id || group.factVersion !== run.factVersion || group.status !== 'collecting') throw new Error('Group does not belong to the collecting run.');
  const terminal = new Set(terminalMemberIds);
  if (group.memberIds.some(id => !terminal.has(id))) throw new Error('All potential correction members need terminal outcomes.');
  if (!group.eligibleIds.length) throw new Error('A reviewable group needs eligible patches.');
  assertGroupMembers(run, group, patches);
}

export function elapsedFromConfirmation(run: Run, at: string): number { const elapsed = Date.parse(at) - Date.parse(run.confirmedAt); if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('Invalid event time.'); return elapsed; }
