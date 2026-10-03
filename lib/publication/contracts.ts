import type { Group, Judgment, Patch, Publication, Run } from '../types';
import type { ApproveRequest, ConfirmRequest, ConfirmResponse } from '../contracts/api';
import { assertGroupMembers } from '../corrections';
export interface CoordinatorServices {
  confirm(request: ConfirmRequest): Promise<ConfirmResponse>;
  approve(groupId: string, request: ApproveRequest): Promise<Publication>;
  recover(): Promise<void>;
}
export interface RevisionSnapshot { fileHash: string; blockHash: string; contextHash: string; metadataHash: string }
export interface ApplicationRevision { beforeFileHash: string; afterFileHash: string }
export function assertFreshResult(captured: RevisionSnapshot, current: RevisionSnapshot, chain: ApplicationRevision[]): 'fresh' | 'revalidate_context' {
  if (captured.blockHash !== current.blockHash) throw new Error('Original block changed.');
  if (captured.metadataHash !== current.metadataHash) throw new Error('Asset metadata changed.');
  let expected = captured.fileHash;
  for (const step of chain) { if (step.beforeFileHash !== expected) throw new Error('Unexplained revision chain.'); expected = step.afterFileHash; }
  if (expected !== current.fileHash) throw new Error('External or unexplained source edit.');
  return captured.contextHash === current.contextHash ? 'fresh' : 'revalidate_context';
}
export function assertPreflight(run: Run, group: Group, patches: Patch[]): void {
  if (group.status !== 'sealed' || group.sealedAt === null || !group.eligibleIds.length) throw new Error('Only a complete current sealed group can publish.');
  assertGroupMembers(run, group, patches);
}
export function verificationPass(sourceObserved: boolean, judgment: Judgment | null, tLabel: number, expected: { runId: string; passageId: string; factVersion: number; adapter: Judgment['adapter']; model: string }): boolean {
  return sourceObserved && judgment !== null && judgment.runId === expected.runId && judgment.passageId === expected.passageId && judgment.factVersion === expected.factVersion && judgment.adapter === expected.adapter && judgment.model === expected.model && (judgment.label === 'consistent' || judgment.label === 'valid_exception') && (judgment.adapter !== 'jev' || (judgment.confidence !== null && judgment.confidence >= tLabel));
}
