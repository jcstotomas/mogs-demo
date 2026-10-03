import { FactSnapshotSchema } from '../types';
import { initialFacts } from '../facts/derive';
import { hashRecord, sha256 } from '../hash';
import { parseSource } from '../assets/source';
import { CandidateSchema, type Baseline, type LaunchAttempt } from '../runs/remote-types';
import { assertSameBaseline, type CandidateBundle } from './candidate';

/** A restoration is a separate exact-seed PR; it contributes no repairs. */
export function assembleRestoration(attempt: LaunchAttempt, observedBaseline: Baseline, currentSources: Record<string, string>, seed: { sources: Record<string, { source: string; hash: string }> }, seedFactsText: string, at = new Date().toISOString()): CandidateBundle {
  if (attempt.state !== 'active' || attempt.purpose !== 'restoration' || !attempt.seedRevision) throw new Error('Restoration requires its own active seed-pinned attempt.');
  assertSameBaseline(attempt.baseline, observedBaseline);
  const facts = FactSnapshotSchema.parse(JSON.parse(seedFactsText));
  if (hashRecord(facts) !== hashRecord(initialFacts()) || attempt.desiredFactsHash !== hashRecord(facts)) throw new Error('Restoration desired facts must match frozen seed.');
  const images: Record<string, string> = {}, all: Record<string, string> = {};
  for (const asset of attempt.baseline.assets.filter(a => a.editable)) {
    const file = asset.path!.slice('content/'.length), entry = seed.sources[file], current = currentSources[file];
    if (!entry || sha256(entry.source) !== entry.hash || current === undefined || sha256(current) !== asset.sourceHash) throw new Error('Restoration source/seed differs from pinned inventory.');
    const old = parseSource(current, file, asset.surface), restored = parseSource(entry.source, file, asset.surface);
    if (hashRecord(old.blocks.map(b => b.sourceId)) !== hashRecord(restored.blocks.map(b => b.sourceId)) || hashRecord(old.meta) !== hashRecord(restored.meta)) throw new Error('Restoration cannot change mapped IDs or metadata.');
    all[asset.path!] = entry.source;
    if (entry.source !== current) images[asset.path!] = entry.source;
  }
  if (Object.keys(seed.sources).length !== Object.keys(all).length) throw new Error('Restoration seed has omitted or extra assets.');
  all['data/facts.json'] = seedFactsText;
  images['data/facts.json'] = seedFactsText;
  const files = Object.keys(images).sort().map(file => ({ path: file, beforeHash: file === 'data/facts.json' ? attempt.baseline.factsFileHash : sha256(currentSources[file.slice('content/'.length)]), afterHash: sha256(images[file]) }));
  const bundleHash = hashRecord({ launchAttemptId: attempt.id, seedRevision: attempt.seedRevision, baseSha: attempt.baseline.baseSha, files });
  const candidate = CandidateSchema.parse({ id: 'candidate-' + attempt.id, launchAttemptId: attempt.id, runId: attempt.runId, purpose: 'restoration', baselineHash: attempt.baselineHash, baseSha: attempt.baseline.baseSha, desiredFactsHash: attempt.desiredFactsHash, approvals: [], files, bundleHash, treeHash: hashRecord(Object.fromEntries(Object.entries(all).map(([file, text]) => [file, sha256(text)]))), branch: 'codex/restore-' + attempt.id, candidateSha: null, commitMessage: 'Restore frozen MOGS seed\n\nLaunch-Attempt: ' + attempt.id + '\nSeed-Revision: ' + attempt.seedRevision + '\nBundle: ' + bundleHash, createdAt: at });
  return { candidate, images, checks: {} };
}
