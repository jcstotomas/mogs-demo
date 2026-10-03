import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { correctionKey } from '../corrections';
import { hashRecord, sha256 } from '../hash';
import { runtimeProviderConfig } from '../providers';
import { CheckNameSchema, PatchSchema, type Patch } from '../types';
import { RemoteDatabase, RemoteStateError } from '../runs/remote-db';
import { RemoteGroupSchema, RemoteJudgmentSchema, RemotePatchSchema, type RemoteRun, type RemoteGroup } from '../runs/remote-types';
import { classifyPassage, draftPatch, prefilter } from './index';
import { checkPatch } from './checks';

export interface RemotePipelineOptions {
  databasePath?: string;
  legacyPath?: string;
  /** Exact pinned Git source captured for this run; never repaired v1 content. */
  contentRoot?: string;
  clock?: () => Date;
  fixtureDependencies?: {
    classify?: typeof classifyPassage;
    draft?: typeof draftPatch;
    check?: typeof checkPatch;
  };
}
type RemotePatch = ReturnType<typeof RemotePatchSchema.parse>;
const active = new Map<string, Promise<void>>();
const owner = randomUUID();
const fileFor = (db: RemoteDatabase) => path.join(path.dirname(db.file), 'pipeline-worker.json');
type Lease = { owner: string; pid: number; runId: string; startedAt: string };
function readLease(file: string): Lease | null {
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Lease;
    return typeof value.owner === 'string' && Number.isInteger(value.pid) && value.pid > 0 && typeof value.runId === 'string' && typeof value.startedAt === 'string' ? value : null;
  } catch { return null; }
}
function alive(lease: Lease): boolean {
  if (lease.pid === process.pid) return lease.owner === owner && active.has(lease.runId);
  try { process.kill(lease.pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
function failRun(db: RemoteDatabase, runId: string, code: string, message: string, clock: () => Date, passageId?: string): void {
  const run = db.getRun(runId);
  if (!run || ['ready', 'failed'].includes(run.status) || db.attemptForRun(runId)?.state !== 'active') return;
  db.putRun({ ...run, status: 'failed', updatedAt: clock().toISOString(), errors: [...run.errors, { code, message, ...(passageId ? { passageId } : {}) }], stats: { ...run.stats, machineMs: Math.max(0, clock().getTime() - Date.parse(run.confirmedAt)) } });
}
export function isRemoteRunProcessing(runId: string): boolean { return active.has(runId); }
/** Polling may retire only a missing/dead worker, never another live process. */
export function recoverRemoteRun(runId: string, options: RemotePipelineOptions = {}): void {
  const clock = options.clock ?? (() => new Date()), db = new RemoteDatabase(options.databasePath, { legacyPath: options.legacyPath, clock });
  try {
    const run = db.getRun(runId);
    if (!run || ['ready', 'failed'].includes(run.status) || db.attemptForRun(runId)?.state !== 'active') return;
    const leaseFile = fileFor(db), lease = readLease(leaseFile);
    if (clock().getTime() > Date.parse(run.deadlineAt)) failRun(db, runId, 'deadline', 'The 180-second all-results deadline expired.', clock);
    else if (['classifying', 'drafting'].includes(run.status) && (!lease || lease.runId !== runId || !alive(lease))) failRun(db, runId, 'interrupted', 'The analysis worker stopped before completing the run. Abandon this attempt before starting again.', clock);
    if (lease?.runId === runId && !alive(lease)) unlinkSync(leaseFile);
  } finally { db.close(); }
}

/** Runs against immutable attempt facts and the entire captured baseline. No publication or Git writes. */
export function processRemoteRun(runId: string, options: RemotePipelineOptions = {}): Promise<void> {
  const existing = active.get(runId);
  if (existing) return existing;
  const work = Promise.resolve().then(() => runWorker(runId, options)).finally(() => active.delete(runId));
  active.set(runId, work);
  return work;
}
async function runWorker(runId: string, options: RemotePipelineOptions): Promise<void> {
  const clock = options.clock ?? (() => new Date());
  const db = new RemoteDatabase(options.databasePath, { legacyPath: options.legacyPath, clock });
  const leaseFile = fileFor(db);
  let leased = false;
  try {
    recoverRemoteRun(runId, options);
    const initial = db.getRun(runId), attempt = db.attemptForRun(runId);
    if (!initial || !attempt) throw new RemoteStateError('not_found', 'Run not found.');
    if (['ready', 'failed'].includes(initial.status) || attempt.state !== 'active') return;
    if (attempt.purpose !== 'correction') throw new RemoteStateError('validation', 'Restoration does not run correction models.');
    if (options.fixtureDependencies && initial.mode !== 'fixture') throw new RemoteStateError('validation', 'Injected model/check ports are permitted only for an explicit fixture run.');
    if (initial.mode !== 'fixture' && (!options.contentRoot || path.resolve(options.contentRoot) === path.resolve('content'))) throw new RemoteStateError('validation', 'Live analysis requires its pinned remote source snapshot.');
    if (initial.mode !== 'fixture' && hashRecord(runtimeProviderConfig()) !== hashRecord(initial.config)) throw new RemoteStateError('stale', 'The provider configuration changed after Confirm.');
    const previous = readLease(leaseFile);
    if (previous && alive(previous)) throw new RemoteStateError('busy', 'Another analysis worker is active.');
    if (previous && !alive(previous) && hashRecord(readLease(leaseFile)) === hashRecord(previous)) unlinkSync(leaseFile);
    mkdirSync(path.dirname(leaseFile), { recursive: true });
    try {
      writeFileSync(leaseFile, JSON.stringify({ owner, pid: process.pid, runId, startedAt: clock().toISOString() } satisfies Lease), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new RemoteStateError('busy', 'An analysis worker already reserved this database.');
      throw error;
    }
    leased = true;
    const before = db.getFacts(attempt.id, 'before')!.snapshot, desired = db.getFacts(attempt.id, 'desired')!.snapshot;
    const pages = db.pages(runId), passages = db.passages(runId), pageById = new Map(pages.map(page => [page.assetId, page]));
    const expected = attempt.baseline.assets.flatMap(asset => asset.sourceIds.map(id => asset.assetId + '\0' + id)).sort();
    if (hashRecord(expected) !== hashRecord(passages.map(p => p.assetId + '\0' + p.sourceId).sort()) || new Set(passages.map(p => p.id)).size !== passages.length || pages.length !== initial.scope.assetIds.length || !passages.length || passages.some(p => !pageById.has(p.assetId))) throw new RemoteStateError('stale', 'The complete captured asset and source-ID scope is required.');
    const classify = options.fixtureDependencies?.classify ?? classifyPassage;
    const draft = options.fixtureDependencies?.draft ?? draftPatch;
    const check = options.fixtureDependencies?.check ?? checkPatch;
    let stopped = false;
    const current = () => db.getRun(runId)!;
    const accepting = () => {
      const run = current();
      if (run.status === 'failed' || db.attemptForRun(runId)?.state !== 'active') { stopped = true; return false; }
      if (clock().getTime() > Date.parse(run.deadlineAt)) { failRun(db, runId, 'deadline', 'The 180-second all-results deadline expired.', clock); stopped = true; return false; }
      return true;
    };
    const update = (changes: Partial<RemoteRun>) => {
      if (accepting()) db.putRun({ ...current(), ...changes, updatedAt: clock().toISOString() });
    };
    const errorFor = (code: string, message: string, passageId?: string) => {
      if (accepting()) update({ errors: [...current().errors, { code, message, ...(passageId ? { passageId } : {}) }] });
    };
    const bounded = async <T>(items: T[], operation: (item: T) => Promise<void>) => {
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(initial.config.concurrency, items.length) }, async () => {
        while (next < items.length && !stopped) {
          const item = items[next++];
          if (!accepting()) return;
          const remaining = Math.max(1, Date.parse(initial.deadlineAt) - clock().getTime());
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([operation(item), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('deadline')), remaining); })]);
          } catch { failRun(db, runId, 'deadline', 'The 180-second all-results deadline expired.', clock); stopped = true; }
          finally { if (timer) clearTimeout(timer); }
        }
      }));
    };
    const candidates = passages.filter(prefilter), filteredPassageIds = passages.filter(p => !prefilter(p)).map(p => p.id);
    update({ status: 'classifying', filteredPassageIds, stats: { ...current().stats, candidates: candidates.length } });
    await bounded(candidates, async p => {
      try {
        const judgment = await classify(runId, p, pageById.get(p.assetId)!, before, desired);
        if (!accepting()) return;
        if (judgment.adapter !== initial.config.adapter || judgment.model !== initial.config.judgeModel || judgment.runId !== runId || judgment.passageId !== p.id || judgment.factVersion !== desired.version) throw new Error('Unpinned judgment.');
        db.putJudgment(RemoteJudgmentSchema.parse({ ...judgment, contractVersion: 2, launchAttemptId: attempt.id }));
        const stats = structuredClone(current().stats); stats.judged++; stats.byLabel[judgment.label]++;
        if (judgment.label === 'contradicting') stats.bySurface[p.surface].contradictions++;
        update({ stats });
      } catch { errorFor('provider_failure', 'Classification failed; no semantic label was recorded for this passage.', p.id); }
    });
    if (!accepting()) return;
    if (current().errors.length) { failRun(db, runId, 'classification_incomplete', 'Full-scope classification did not complete successfully.', clock); return; }
    update({ status: 'drafting' });
    const editable = db.judgments(runId).filter(j => j.label === 'contradicting' && passages.find(p => p.id === j.passageId)!.editable && pageById.get(passages.find(p => p.id === j.passageId)!.assetId)!.editable);
    const outcomes: RemotePatch[] = [];
    await bounded(editable, async judgment => {
      const p = passages.find(p => p.id === judgment.passageId)!, page = pageById.get(p.assetId)!;
      try {
        // V1 provider entry points receive their strict v1 judgment shape.
        const { contractVersion: _version, launchAttemptId: _attempt, ...providerJudgment } = judgment;
        const result = await draft(runId, p, page, providerJudgment, before, desired);
        if (!accepting()) return;
        if (!result) throw new Error('Missing correction outcome.');
        let patch = PatchSchema.parse(result);
        if (patch.runId !== runId || patch.passageId !== p.id || patch.kind !== judgment.kind || patch.factVersion !== desired.version) throw new Error('Foreign correction outcome.');
        if (patch.replacement) {
          const checks = await check(patch, p, page, before, desired, options.contentRoot, { providerConfig: initial.config, onProviderError: () => errorFor('provider_failure', 'Replacement judgment failed; the correction was withheld.', p.id) });
          if (!accepting()) return;
          const required = CheckNameSchema.options.filter(name => name !== 'tokens_kept' || p.surface === 'email');
          const passed = required.every(name => checks.some(c => c.name === name && c.pass)) && checks.every(c => c.pass);
          if (checks.some(c => ['source_located', 'source_fresh', 'fact_fresh'].includes(c.name) && !c.pass)) errorFor('stale', 'Captured source or desired facts no longer match; start a fresh attempt.', p.id);
          patch = PatchSchema.parse({ ...patch, checks, ...(!passed ? { status: 'withheld', withholdReason: 'One or more applicable source, value, preservation or contextual checks failed.' } : {}) });
        }
        outcomes.push(RemotePatchSchema.parse({ ...patch, contractVersion: 2, launchAttemptId: attempt.id }));
      } catch { errorFor('provider_failure', 'Drafting or checking failed; this contradiction has no eligible correction.', p.id); }
    });
    if (!accepting()) return;
    if (current().errors.length) { failRun(db, runId, 'drafting_incomplete', 'Correction drafting/checking did not complete successfully.', clock); return; }
    const grouped = groupsFor(initial, outcomes);
    db.transaction(() => {
      for (const group of grouped) db.putGroup({ ...group, status: 'collecting', sealedAt: null });
      for (const patch of outcomes) {
        const group = grouped.find(g => g.memberIds.includes(patch.id));
        db.putPatch({ ...patch, groupId: group?.id ?? null });
      }
      for (const group of grouped) db.putGroup({ ...group, status: group.eligibleIds.length ? 'sealed' : 'blocked', sealedAt: group.eligibleIds.length ? clock().toISOString() : null });
      const run = current(), elapsed = Math.max(0, clock().getTime() - Date.parse(run.confirmedAt)), stats = structuredClone(run.stats);
      stats.patchesDrafted = outcomes.filter(p => p.status === 'drafted').length; stats.withheld = outcomes.filter(p => p.status === 'withheld').length; stats.groups = grouped.length;
      for (const patch of outcomes.filter(p => p.status === 'drafted')) stats.bySurface[patch.surface].patches++;
      stats.machineMs = elapsed; stats.firstSealedGroupMs = grouped.some(g => g.eligibleIds.length) ? elapsed : null; stats.allResultsReadyMs = elapsed;
      db.putRun({ ...run, status: 'ready', stats, updatedAt: clock().toISOString() });
    });
  } catch (error) {
    if (error instanceof RemoteStateError && ['validation', 'not_found', 'busy'].includes(error.code)) throw error;
    failRun(db, runId, error instanceof RemoteStateError ? error.code : 'runtime_failure', 'Analysis could not complete against the pinned facts and source. Abandon this attempt before starting again.', clock);
  } finally {
    if (leased && readLease(leaseFile)?.owner === owner) unlinkSync(leaseFile);
    db.close();
  }
}
function groupsFor(run: RemoteRun, patches: RemotePatch[]): RemoteGroup[] {
  const buckets = new Map<string, RemotePatch[]>();
  for (const patch of patches) {
    if (!patch.target || !['direct_price', 'annual_savings', 'per_day', 'plan_gap'].includes(patch.kind)) continue;
    const key = correctionKey(patch); buckets.set(key, [...(buckets.get(key) ?? []), patch]);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, members]) => {
    const sorted = [...members].sort((a, b) => a.id.localeCompare(b.id)), memberIds = sorted.map(p => p.id), first = sorted[0];
    const title = first.kind === 'direct_price' ? 'Starter monthly price to $' + first.target!.value : first.kind === 'annual_savings' ? 'Annual savings to ' + first.target!.value + '%' : first.kind === 'per_day' ? 'Daily cost to $' + first.target!.value.toFixed(2) : 'Monthly plan gap to $' + first.target!.value;
    return RemoteGroupSchema.parse({ contractVersion: 2, id: 'group-' + sha256(run.id + '\0' + key).slice(0, 24), runId: run.id, launchAttemptId: run.launchAttemptId, factVersion: run.desiredFactVersion, key, title, memberIds, eligibleIds: sorted.filter(p => p.status === 'drafted').map(p => p.id), excludedIds: sorted.filter(p => p.status !== 'drafted').map(p => p.id), membershipHash: hashRecord([...memberIds].sort()), revision: 0, sealedAt: null, status: 'collecting', approvalId: null });
  });
}
