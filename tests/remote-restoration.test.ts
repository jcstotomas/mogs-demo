import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractRenderedAsset } from '../lib/assets/source';
import { createPublicArtifact } from '../lib/deployment/public-artifact';
import { buildRemoteFixtures, REMOTE_FIXTURE_TIME } from '../lib/runs/remote-fixtures';
import { RemoteDatabase } from '../lib/runs/remote-db';
import { RemoteCoordinator } from '../lib/runs/remote-service';
import { completeRestorationRun } from '../lib/runs/remote-restoration';
import { hashRecord } from '../lib/hash';

function sandbox(captured = true, correction = false) {
  const root = mkdtempSync(path.join(tmpdir(), 'mogs-restoration-ready-')), databasePath = path.join(root, 'app.db');
  let now = Date.parse(REMOTE_FIXTURE_TIME);
  const clock = () => new Date(now), fixture = buildRemoteFixtures(), seedManifestText = readFileSync('content/seed.json', 'utf8');
  const before = fixture.state.facts.find(fact => fact.phase === 'desired')!.snapshot, desired = fixture.state.facts.find(fact => fact.phase === 'before')!.snapshot;
  const artifact = createPublicArtifact({ sourceCommit: 'c'.repeat(40), mode: 'commit', seedManifestText, factText: JSON.stringify(before, null, 2) + '\n', sourceTexts: fixture.baseSources });
  const baseline = correction ? fixture.state.attempt.baseline : { ...fixture.state.attempt.baseline, baseSha: 'c'.repeat(40), deployedSha: 'c'.repeat(40), assets: artifact.assets, inventoryHash: artifact.inventoryHash, factsHash: artifact.factsHash, factsFileHash: artifact.factsFileHash };
  const extracted = (correction ? fixture.state.pages.map(page => ({ page, passages: fixture.state.passages.filter(p => p.assetId === page.assetId) })) : artifact.routes.map(route => extractRenderedAsset(route.html, new URL(route.pathname, baseline.target.productionOrigin).href, REMOTE_FIXTURE_TIME)));
  const service = new RemoteCoordinator({ databasePath, clock, actor: 'test' });
  const input = { baseline, beforeFacts: correction ? desired : before, desiredFacts: correction ? before : desired, config: fixture.state.run.config, ...(captured ? { pages: extracted.map(item => item.page), passages: extracted.flatMap(item => item.passages) } : {}), mode: 'fixture' as const };
  const body = { contractVersion: 2 as const, launchAttemptId: randomUUID(), idempotencyKey: randomUUID(), baselineHash: hashRecord(baseline) };
  const started = correction ? service.confirm({ ...body, expectedFactVersion: 1 }, input) : service.startRestoration({ ...body, expectedFactVersion: 2, seedRevision: fixture.state.attempt.baseline.baseSha }, input);
  const db = new RemoteDatabase(databasePath, { clock });
  return { db, started, fixture, clock, advance: (ms: number) => { now += ms; }, cleanup: () => { db.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('complete captured restoration becomes ready with four assets/forty blocks and zero model or repair credit', () => {
  const s = sandbox();
  try {
    s.advance(2500); const ready = completeRestorationRun(s.db, s.started.run.id, s.clock), state = s.db.export(ready.id);
    assert.equal(ready.status, 'ready'); assert.equal(state.pages.length, 4); assert.equal(state.passages.length, 40);
    assert.equal(ready.stats.assetsIndexed, 4); assert.equal(ready.stats.passagesIndexed, 40);
    assert.equal(ready.stats.machineMs, 2500); assert.equal(ready.stats.allResultsReadyMs, 2500); assert.equal(ready.stats.firstSealedGroupMs, null);
    assert.ok([ready.stats.candidates, ready.stats.judged, ready.stats.patchesDrafted, ready.stats.withheld, ready.stats.groups, ready.stats.published, ready.stats.verified].every(value => value === 0));
    assert.deepEqual([state.judgments.length, state.patches.length, state.groups.length, state.approvals.length], [0, 0, 0, 0]);
    assert.equal(state.reviewEvents.filter(event => event.action === 'restore').length, 1);
    s.advance(200_000); assert.deepEqual(completeRestorationRun(s.db, ready.id, s.clock), ready);
    assert.equal(s.db.reviewEvents(ready.id).length, 1);
  } finally { s.cleanup(); }
});

test('missing captured assets/blocks or inconsistent indexed counts cannot become ready', () => {
  for (const variant of ['all-missing', 'one-block', 'counts'] as const) {
    const s = sandbox(variant !== 'all-missing');
    try {
      const run = s.db.getRun(s.started.run.id)!;
      if (variant === 'one-block') s.db.connection.prepare('DELETE FROM passages WHERE run_id=? AND id=?').run(run.id, s.db.passages(run.id)[0].id);
      if (variant === 'counts') s.db.putRun({ ...run, stats: { ...run.stats, passagesIndexed: 39 } });
      assert.throws(() => completeRestorationRun(s.db, run.id, s.clock), /every pinned asset|indexed counts/);
      assert.equal(s.db.getRun(run.id)!.status, 'collecting');
    } finally { s.cleanup(); }
  }
});

test('restart from persisted intermediate restoration stages retains original Confirm timing', () => {
  for (const status of ['classifying', 'drafting'] as const) {
    const s = sandbox();
    try {
      const run = s.db.getRun(s.started.run.id)!;
      s.db.putRun({ ...run, status: 'classifying' });
      if (status === 'drafting') s.db.putRun({ ...run, status: 'drafting' });
      s.advance(10_000);
      const reopened = new RemoteDatabase(s.db.file, { clock: s.clock });
      try {
        const ready = completeRestorationRun(reopened, run.id, s.clock);
        assert.equal(ready.status, 'ready'); assert.equal(ready.confirmedAt, run.confirmedAt);
        assert.equal(ready.stats.allResultsReadyMs, 10_000);
        assert.equal(reopened.judgments(run.id).length, 0); assert.equal(reopened.reviewEvents(run.id).length, 1);
      } finally { reopened.close(); }
    } finally { s.cleanup(); }
  }
});

test('original Confirm deadline, explicit errors, AI records and fabricated repair counts remain blockers', () => {
  for (const variant of ['deadline', 'error', 'judgment', 'repair-credit', 'label-credit', 'filtered'] as const) {
    const s = sandbox();
    try {
      const run = s.db.getRun(s.started.run.id)!;
      if (variant === 'deadline') s.advance(180_001);
      if (variant === 'error') s.db.putRun({ ...run, errors: [{ code: 'source', message: 'Failed source capture.' }] });
      if (variant === 'judgment') { const judgment = s.fixture.state.judgments[0]; s.db.putJudgment({ ...judgment, runId: run.id, launchAttemptId: run.launchAttemptId, factVersion: 1 }); }
      if (variant === 'repair-credit') s.db.putRun({ ...run, stats: { ...run.stats, verified: 1 } });
      if (variant === 'label-credit') s.db.putRun({ ...run, stats: { ...run.stats, byLabel: { ...run.stats.byLabel, consistent: 1 } } });
      if (variant === 'filtered') s.db.putRun({ ...run, filteredPassageIds: [s.db.passages(run.id).find(p => p.sourceId === 'greeting')!.id] });
      assert.throws(() => completeRestorationRun(s.db, run.id, s.clock), /original Confirm deadline|zero AI results/);
      assert.equal(s.db.getRun(run.id)!.status, 'collecting');
    } finally { s.cleanup(); }
  }
});

test('failed, inactive or correction attempts cannot use restoration readiness', () => {
  for (const variant of ['failed', 'inactive', 'correction'] as const) {
    const s = sandbox(true, variant === 'correction');
    try {
      const run = s.db.getRun(s.started.run.id)!, attempt = s.db.getAttempt(run.launchAttemptId)!;
      if (variant === 'failed') s.db.putRun({ ...run, status: 'failed', errors: [{ code: 'deadline', message: 'Failure retained.' }] });
      if (variant === 'inactive') s.db.putAttempt({ ...attempt, state: 'abandoning', revision: 1 });
      assert.throws(() => completeRestorationRun(s.db, run.id, s.clock), /inactive or failed|separate seed-pinned restoration/);
      assert.equal(s.db.getRun(run.id)!.status, variant === 'failed' ? 'failed' : 'collecting');
    } finally { s.cleanup(); }
  }
});
