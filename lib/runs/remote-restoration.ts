import { hashRecord } from '../hash';
import { RemoteDatabase, RemoteStateError } from './remote-db';
import type { RemoteRun } from './remote-types';

/** Finish deterministic restoration preparation, with no classification or repair credit. */
export function completeRestorationRun(db: RemoteDatabase, runId: string, clock: () => Date = () => new Date()): RemoteRun {
  return db.transaction(() => {
    const run = db.getRun(runId), attempt = run && db.getAttempt(run.launchAttemptId);
    if (!run || !attempt || attempt.runId !== run.id) throw new RemoteStateError('not_found', 'Restoration run and attempt must exist.');
    if (attempt.purpose !== 'restoration' || !attempt.seedRevision) throw new RemoteStateError('validation', 'Only a separate seed-pinned restoration may use deterministic readiness.');
    if (attempt.state !== 'active' || run.status === 'failed') throw new RemoteStateError('stale', 'An inactive or failed restoration cannot become ready.');
    if (run.status === 'ready') return run;
    if (db.getSubmission(run.id)) throw new RemoteStateError('stale', 'Submitted restoration analysis is immutable.');
    const at = clock(), elapsed = at.getTime() - Date.parse(run.confirmedAt);
    if (!Number.isFinite(elapsed) || elapsed < 0 || at.getTime() < Date.parse(run.updatedAt) || at.getTime() > Date.parse(run.deadlineAt)) throw new RemoteStateError('validation', 'Restoration readiness must finish within the original Confirm deadline.');
    const pages = db.pages(run.id), passages = db.passages(run.id), stats = run.stats;
    const captured = passages.map(p => [p.assetId, p.sourceId].join('\0')).sort();
    const required = attempt.baseline.assets.flatMap(asset => asset.sourceIds.map(sourceId => [asset.assetId, sourceId].join('\0'))).sort();
    if (!pages.length || pages.length !== run.scope.assetIds.length || hashRecord(pages.map(p => p.assetId).sort()) !== hashRecord([...run.scope.assetIds].sort()) || !passages.length || hashRecord(captured) !== hashRecord(required) || passages.some(p => p.id !== p.assetId + '#' + p.sourceId)) throw new RemoteStateError('validation', 'Restoration requires every pinned asset and source block exactly once.');
    if (run.errors.length || run.filteredPassageIds.length || db.judgments(run.id).length || db.patches(run.id).length || db.groups(run.id).length || db.approvals(run.id).length || [stats.candidates, stats.judged, stats.patchesDrafted, stats.withheld, stats.groups, stats.published, stats.verified, ...Object.values(stats.byLabel), ...Object.values(stats.bySurface).flatMap(surface => [surface.contradictions, surface.patches])].some(value => value !== 0) || stats.firstSealedGroupMs !== null) throw new RemoteStateError('validation', 'Restoration must have zero AI results, correction groups, approvals, errors and repair credit.');
    if (stats.assetsIndexed !== pages.length || stats.passagesIndexed !== passages.length || Object.entries(stats.bySurface).some(([surface, counts]) => counts.assets !== pages.filter(page => page.surface === surface).length || counts.passages !== passages.filter(p => p.surface === surface).length)) throw new RemoteStateError('validation', 'Restoration indexed counts must match its complete captured scope.');
    let current = run;
    if (current.status === 'collecting') { current = { ...current, status: 'classifying', updatedAt: at.toISOString() }; db.putRun(current); }
    if (current.status === 'classifying') { current = { ...current, status: 'drafting', updatedAt: at.toISOString() }; db.putRun(current); }
    const ready: RemoteRun = { ...current, status: 'ready', updatedAt: at.toISOString(), stats: { ...stats, machineMs: elapsed, allResultsReadyMs: elapsed, firstSealedGroupMs: null } };
    db.putRun(ready);
    return ready;
  });
}
