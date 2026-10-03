import { parseSource, renderSource, extractRenderedAsset, replaceSourceBlocks } from '../assets/source';
import { confirmedFacts, targetForKind } from '../facts/derive';
import { hashRecord, sha256 } from '../hash';
import { checkTextChange } from '../pipeline/checks';
import { judge } from '../providers';
import { type Check, type FactSnapshot, type Judgment, type Page, type Passage, type Patch, type ProviderConfig } from '../types';
import { CandidateSchema, RemoteExportSchema, type Baseline, type Candidate, type RemoteExport } from '../runs/remote-types';

export type CandidateJudge = (runId: string, p: Passage, page: Page, before: FactSnapshot, desired: FactSnapshot) => Promise<Judgment>;
export interface CandidateBundle { candidate: Candidate; images: Record<string, string>; checks: Record<string, Check[]> }
export function checkedPatchHash(patches: Patch[]): string { return hashRecord([...patches].sort((a, b) => a.id.localeCompare(b.id))); }
export function assertSameBaseline(captured: Baseline, observed: Baseline): void {
  const identity = ({ observedAt: _observedAt, ...value }: Baseline) => value;
  if (hashRecord(identity(captured)) !== hashRecord(identity(observed))) throw new Error('Stale baseline: start a new attempt.');
}

export async function checkPairedPatch(patch: Patch, baseSource: string, candidateSource: string, file: string, before: FactSnapshot, desired: FactSnapshot, rejudge: CandidateJudge = judge, config?: ProviderConfig): Promise<Check[]> {
  const base = parseSource(baseSource, file, patch.surface), candidate = parseSource(candidateSource, file, patch.surface);
  const oldBlock = base.blocks.find(b => b.sourceId === patch.sourceId), newBlock = candidate.blocks.find(b => b.sourceId === patch.sourceId);
  const oldRendered = extractRenderedAsset(renderSource(base), patch.url), nextRendered = extractRenderedAsset(renderSource(candidate), patch.url);
  const original = oldRendered.passages.find(p => p.id === patch.passageId), next = nextRendered.passages.find(p => p.id === patch.passageId);
  const located = base.assetId === patch.assetId && candidate.assetId === patch.assetId && oldBlock?.text === patch.original && newBlock?.text === patch.replacement && original?.blockHash === patch.expectedBlockHash;
  const freshness = base.sourceHash === patch.originalCapturedFileHash && base.sourceHash === patch.expectedFileHash && hashRecord(base.meta) === patch.expectedMetadataHash && original?.contextHash === patch.expectedContextHash;
  const checks: Check[] = [
    ...checkTextChange(patch.original, patch.replacement ?? '', patch.target, patch.surface),
    { name: 'source_located', pass: located, detail: 'Stable ID and original checked in pinned base; replacement checked in combined candidate.' },
    { name: 'source_fresh', pass: freshness, detail: 'Paired source, metadata and captured original context match.' },
    { name: 'fact_fresh', pass: patch.factVersion === desired.version && hashRecord(confirmedFacts(before)) === hashRecord(desired) && hashRecord(targetForKind(patch.kind, desired)) === hashRecord(patch.target), detail: 'Desired fact artifact and deterministic target match.' },
  ];
  let pass = false, detail = 'Final-context rejudge skipped because a prerequisite failed.';
  if (checks.every(c => c.pass) && next) {
    try {
      const verdict = await rejudge(patch.runId, next, nextRendered.page, before, desired);
      pass = verdict.runId === patch.runId && verdict.passageId === patch.passageId && verdict.factVersion === desired.version && verdict.kind === patch.kind && verdict.escalatedBy === null && ['consistent', 'valid_exception'].includes(verdict.label);
      if (config) pass = pass && verdict.adapter === config.adapter && verdict.model === config.judgeModel && (verdict.adapter !== 'jev' || (verdict.confidence !== null && verdict.confidence >= config.tLabel));
      detail = `Combined candidate context: ${verdict.label}; ${verdict.adapter}/${verdict.model}.`;
    } catch { detail = 'Final-context provider call failed.'; }
  }
  checks.push({ name: 'rejudge_consistent', pass, detail });
  return checks;
}

/** No filesystem or network writes. Caller journals the immutable result before Git writes. */
export async function assembleCandidate(input: RemoteExport, baseSources: Record<string, string>, observedBaseline: Baseline, rejudge: CandidateJudge = judge, at = new Date().toISOString()): Promise<CandidateBundle> {
  const state = RemoteExportSchema.parse(input), { attempt, run } = state;
  if (attempt.state !== 'active' || attempt.purpose !== 'correction' || run.status !== 'ready' || run.errors.length || state.submission) throw new Error('Candidate requires a complete active, unsubmitted correction run.');
  assertSameBaseline(attempt.baseline, observedBaseline);
  if (run.baselineHash !== attempt.baselineHash) throw new Error('Stale baseline: start a new attempt.');
  if (run.stats.assetsIndexed !== run.scope.assetIds.length || run.scope.assetIds.length !== attempt.baseline.assets.length || run.scope.assetIds.some(id => !attempt.baseline.assets.some(a => a.assetId === id))) throw new Error('Incomplete immutable scope.');
  const before = state.facts.find(f => f.phase === 'before')?.snapshot, desired = state.facts.find(f => f.phase === 'desired')?.snapshot;
  if (!before || !desired || hashRecord(before) !== attempt.beforeFactsHash || hashRecord(desired) !== attempt.desiredFactsHash || hashRecord(confirmedFacts(before)) !== hashRecord(desired)) throw new Error('Desired facts are stale or missing.');
  if (state.groups.some(g => g.eligibleIds.length && g.status !== 'approved') || !state.groups.some(g => g.eligibleIds.length)) throw new Error('Every eligible group needs approval.');
  const eligible = state.groups.flatMap(g => g.eligibleIds);
  if (new Set(eligible).size !== eligible.length) throw new Error('Patch appears in multiple groups.');
  const patches = eligible.map(id => { const p = state.patches.find(p => p.id === id); if (!p) throw new Error('Approved patch is missing.'); return p; });
  for (const patch of patches) {
    const original = state.judgments.find(j => j.passageId === patch.passageId);
    if (!original || original.runId !== run.id || original.launchAttemptId !== attempt.id || original.factVersion !== patch.factVersion || original.kind !== patch.kind || original.adapter !== run.config.adapter || original.model !== run.config.judgeModel || original.label !== 'contradicting' || original.escalatedBy !== null || (original.adapter === 'jev' && (original.confidence === null || original.confidence < run.config.tLabel))) throw new Error('Only an unambiguous original contradiction can enter the candidate.');
  }
  const approvals = state.groups.filter(g => g.eligibleIds.length).map(g => {
    const approval = state.approvals.find(a => a.id === g.approvalId);
    if (!approval || approval.launchAttemptId !== attempt.id || approval.runId !== run.id || approval.revision !== g.revision || approval.membershipHash !== g.membershipHash || approval.desiredFactsHash !== attempt.desiredFactsHash || hashRecord([...approval.eligibleIds].sort()) !== hashRecord([...g.eligibleIds].sort()) || approval.checkedPatchHash !== checkedPatchHash(patches.filter(p => g.eligibleIds.includes(p.id)))) throw new Error('Approval does not bind current checked patches.');
    return approval;
  });
  const images: Record<string, string> = {}, checks: Record<string, Check[]> = {};
  const allImages: Record<string, string> = {};
  for (const asset of attempt.baseline.assets.filter(a => a.editable)) {
    if (!asset.path) throw new Error('Missing editable path.');
    const relativeFile = asset.path.slice('content/'.length);
    const source = baseSources[relativeFile];
    if (source === undefined || sha256(source) !== asset.sourceHash) throw new Error('Pinned source missing or changed: ' + asset.path);
    const parsed = parseSource(source, relativeFile, asset.surface);
    if (hashRecord(parsed.meta) !== asset.metadataHash || hashRecord(parsed.blocks.map(b => b.sourceId)) !== hashRecord(asset.sourceIds)) throw new Error('Inventory/source mapping mismatch.');
    const edits = patches.filter(p => p.assetId === asset.assetId);
    for (const p of edits) if (p.launchAttemptId !== attempt.id || p.runId !== run.id || p.status !== 'drafted' || !p.replacement || p.checks.some(c => !c.pass)) throw new Error('Unready approved patch.');
    const nextSource = edits.length ? replaceSourceBlocks(parsed, edits.map(p => ({ sourceId: p.sourceId, original: p.original, replacement: p.replacement! })), asset.sourceHash) : source;
    for (const p of edits) {
      checks[p.id] = await checkPairedPatch(p, source, nextSource, relativeFile, before, desired, rejudge, run.config);
      if (checks[p.id].some(c => !c.pass)) throw new Error('Combined candidate failed checks for ' + p.id);
    }
    allImages[asset.path] = nextSource;
    if (nextSource !== source) images[asset.path] = nextSource;
  }
  if (patches.some(p => !attempt.baseline.assets.some(a => a.editable && a.assetId === p.assetId))) throw new Error('Patch is outside pinned editable scope.');
  const factsSource = JSON.stringify(desired, null, 2) + '\n';
  images['data/facts.json'] = factsSource;
  allImages['data/facts.json'] = factsSource;
  const files = Object.keys(images).sort().map(file => ({ path: file, beforeHash: file === 'data/facts.json' ? attempt.baseline.factsFileHash : sha256(baseSources[file.slice('content/'.length)]), afterHash: sha256(images[file]) }));
  const bundleHash = hashRecord({ launchAttemptId: attempt.id, baseSha: attempt.baseline.baseSha, approvals, files, desiredFactsHash: attempt.desiredFactsHash });
  const candidate = CandidateSchema.parse({ id: 'candidate-' + attempt.id, launchAttemptId: attempt.id, runId: run.id, purpose: 'correction', baselineHash: attempt.baselineHash, baseSha: attempt.baseline.baseSha, desiredFactsHash: attempt.desiredFactsHash, approvals, files, bundleHash, treeHash: hashRecord(Object.fromEntries(Object.entries(allImages).map(([file, source]) => [file, sha256(source)]))), branch: 'codex/launch-' + attempt.id, candidateSha: null, commitMessage: 'Apply approved MOGS launch correction\n\nLaunch-Attempt: ' + attempt.id + '\nBundle: ' + bundleHash, createdAt: at });
  return { candidate, images, checks };
}

export function validateMergedTree(candidate: Candidate, observedHashes: Record<string, string>, publishedFacts: FactSnapshot): void {
  if (hashRecord(observedHashes) !== candidate.treeHash || candidate.files.some(f => observedHashes[f.path] !== f.afterHash) || hashRecord(publishedFacts) !== candidate.desiredFactsHash) throw new Error('Merged tree differs from approved candidate.');
}
