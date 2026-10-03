import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { hashRecord } from '../lib/hash';
import { buildRemoteFixtures, REMOTE_FIXTURE_TIME } from '../lib/runs/remote-fixtures';
import { RemoteCoordinator } from '../lib/runs/remote-service';
import { RemoteDatabase, RemoteStateError } from '../lib/runs/remote-db';
import { PatchSchema, type Patch, type Judgment } from '../lib/types';
import { checkPatch } from '../lib/pipeline/checks';
import { processRemoteRun, recoverRemoteRun, type RemotePipelineOptions } from '../lib/pipeline/remote';

function sandbox(mode: 'fixture' | 'live' = 'fixture') {
  const fixture = buildRemoteFixtures(randomUUID()), root = mkdtempSync(path.join(tmpdir(), 'mogs-v2-pipeline-'));
  const databasePath = path.join(root, 'remote/app.db'), legacyPath = path.join(root, 'legacy.db'), contentRoot = path.join(root, 'content');
  for (const [file, source] of Object.entries(fixture.baseSources)) { const target = path.join(contentRoot, file); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, source); }
  let time = Date.parse(REMOTE_FIXTURE_TIME);
  const clock = () => new Date(time), service = new RemoteCoordinator({ databasePath, legacyPath, clock, actor: 'test' });
  const start = service.confirm({ contractVersion: 2, launchAttemptId: fixture.state.attempt.id, idempotencyKey: randomUUID(), expectedFactVersion: 1, baselineHash: fixture.state.attempt.baselineHash }, {
    baseline: fixture.state.attempt.baseline, beforeFacts: fixture.state.facts[0].snapshot, desiredFacts: fixture.state.facts[1].snapshot, config: fixture.state.run.config, pages: fixture.state.pages, passages: fixture.state.passages, mode,
  });
  const db = () => new RemoteDatabase(databasePath, { legacyPath, clock });
  const dependencies: NonNullable<RemotePipelineOptions['fixtureDependencies']> = {
    classify: async (runId, p) => {
      const source = fixture.state.judgments.find(j => j.passageId === p.id)!;
      const { contractVersion: _v, launchAttemptId: _a, ...j } = source;
      return { ...j, runId } satisfies Judgment;
    },
    draft: async (runId, p) => {
      const source = fixture.state.patches.find(patch => patch.passageId === p.id)!;
      const { contractVersion: _v, launchAttemptId: _a, ...patch } = source;
      return PatchSchema.parse({ ...patch, id: 'patch-' + p.id, runId, groupId: null, checks: [] });
    },
    check: async patch => fixture.state.patches.find(p => p.passageId === patch.passageId)!.checks,
  };
  const options: RemotePipelineOptions = { databasePath, legacyPath, contentRoot, clock, fixtureDependencies: dependencies };
  const state = () => { const database = db(); try { return database.export(start.run.id); } finally { database.close(); } };
  return { fixture, root, databasePath, legacyPath, contentRoot, clock, start, db, dependencies, options, state, advance: (ms: number) => { time += ms; }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('v2 miniature classifies all 40 blocks, seals complete paired and same-file groups, and leaves source/facts unchanged', async () => {
  const s = sandbox(); try {
    const sourceHashes = Object.fromEntries(Object.entries(s.fixture.baseSources).map(([file]) => [file, hashRecord(readFileSync(path.join(s.contentRoot, file), 'utf8'))]));
    await processRemoteRun(s.start.run.id, s.options);
    const state = s.state();
    assert.equal(state.run.status, 'ready'); assert.equal(state.run.stats.assetsIndexed, 4); assert.equal(state.run.stats.passagesIndexed, 40);
    assert.equal(state.judgments.length, 30); assert.equal(state.run.filteredPassageIds.length, 10); assert.equal(state.groups.length, 4);
    const direct = state.groups.find(g => g.key.includes(':direct_price:'))!;
    assert.equal(direct.status, 'sealed'); assert.equal(direct.memberIds.length, 2); assert.equal(direct.eligibleIds.length, 2);
    assert.deepEqual(state.patches.filter(p => direct.memberIds.includes(p.id)).map(p => p.surface).sort(), ['email', 'web']);
    assert.equal(state.patches.filter(p => p.status === 'drafted').length, 5); assert.equal(state.patches.filter(p => p.status === 'withheld').length, 1);
    assert.ok(state.patches.every(p => p.assetId !== 'web:site/pricing.md' && p.assetId !== 'email:email/eligible.md'));
    assert.equal(state.run.stats.published, 0); assert.equal(state.approvals.length, 0); assert.equal(state.submission, null);
    for (const [file, hash] of Object.entries(sourceHashes)) assert.equal(hashRecord(readFileSync(path.join(s.contentRoot, file), 'utf8')), hash);
    assert.equal(state.facts[0].snapshot.plans.starter.monthlyCents, 3000); assert.equal(state.facts[1].snapshot.plans.starter.monthlyCents, 4000);
    assert.equal(existsSync(path.join(path.dirname(s.databasePath), 'pipeline-worker.json')), false);
    await processRemoteRun(s.start.run.id, s.options); assert.deepEqual(s.state(), state);
  } finally { s.cleanup(); }
});
test('classification barrier prevents sealing early and preserves a live worker during polling', async () => {
  const s = sandbox(); try {
    let release!: () => void, entered!: () => void, active = 0, maxActive = 0;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const classify = s.dependencies.classify!;
    s.dependencies.classify = async (...args) => { active++; maxActive = Math.max(maxActive, active); entered(); await gate; active--; return classify(...args); };
    const work = processRemoteRun(s.start.run.id, s.options); await started;
    assert.equal(processRemoteRun(s.start.run.id, s.options), work);
    recoverRemoteRun(s.start.run.id, s.options); assert.equal(s.state().run.status, 'classifying'); assert.equal(s.state().groups.length, 0);
    release(); await work; assert.equal(s.state().run.status, 'ready'); assert.equal(maxActive, 4);
  } finally { s.cleanup(); }
});
test('failed classification and wrong provider identity remain errors, with no semantic substitute or approvable group', async () => {
  for (const wrongIdentity of [false, true]) {
    const s = sandbox(); try {
      const classify = s.dependencies.classify!;
      s.dependencies.classify = async (...args) => {
        if (args[1].sourceId === 'starter-price' && args[1].surface === 'web') {
          if (wrongIdentity) return { ...await classify(...args), model: 'unvalidated-model' };
          throw new Error('Synthetic provider failure containing a secret that must not reach the result.');
        }
        return classify(...args);
      };
      await processRemoteRun(s.start.run.id, s.options); const state = s.state();
      assert.equal(state.run.status, 'failed'); assert.equal(state.groups.length, 0); assert.equal(state.judgments.length, 29);
      assert.ok(state.run.errors.some(e => e.passageId === 'web:site/launch.md#starter-price' && e.code === 'provider_failure'));
      assert.ok(state.run.errors.every(e => !e.message.includes('secret')));
    } finally { s.cleanup(); }
  }
});
test('a failed applicable check explicitly withholds the member while retaining complete group membership', async () => {
  const s = sandbox(); try {
    const check = s.dependencies.check!;
    s.dependencies.check = async (...args) => (await check(...args)).map(c => ({ ...c, pass: !(args[0].surface === 'email' && c.name === 'tokens_kept') }));
    await processRemoteRun(s.start.run.id, s.options); const state = s.state(), direct = state.groups.find(g => g.key.includes(':direct_price:'))!;
    assert.equal(state.run.status, 'ready'); assert.equal(direct.memberIds.length, 2); assert.equal(direct.eligibleIds.length, 1); assert.equal(direct.excludedIds.length, 1);
    const excluded = state.patches.find(p => direct.excludedIds.includes(p.id))!;
    assert.equal(excluded.status, 'withheld'); assert.ok(excluded.checks.some(c => c.name === 'tokens_kept' && !c.pass)); assert.ok(excluded.withholdReason);
  } finally { s.cleanup(); }
});
test('real deterministic source and token checks withhold a malformed email replacement without a provider call', async () => {
  const s = sandbox(); try {
    const draft = s.dependencies.draft!, check = s.dependencies.check!;
    s.dependencies.draft = async (...args) => { const patch = await draft(...args); return patch?.surface === 'email' ? { ...patch, replacement: patch.replacement!.replace('{{ first_name }}', 'friend') + ' https://changed.invalid' } satisfies Patch : patch; };
    s.dependencies.check = async (...args) => args[0].surface === 'email' ? checkPatch(...args) : check(...args);
    await processRemoteRun(s.start.run.id, s.options);
    const state = s.state(), email = state.patches.find(p => p.surface === 'email')!;
    assert.equal(email.status, 'withheld'); assert.ok(email.checks.some(c => c.name === 'tokens_kept' && !c.pass));
    assert.ok(email.checks.some(c => c.name === 'rejudge_consistent' && !c.pass && c.detail.includes('skipped')));
  } finally { s.cleanup(); }
});
test('missing scope fails explicitly before model calls', async () => {
  const s = sandbox(); try {
    const database = s.db(); try { database.connection.prepare('DELETE FROM passages WHERE run_id=? AND id=?').run(s.start.run.id, 'web:site/launch.md#starter-price'); } finally { database.close(); }
    let calls = 0; s.dependencies.classify = async () => { calls++; throw new Error('Should not classify missing scope.'); };
    await processRemoteRun(s.start.run.id, s.options); assert.equal(s.state().run.status, 'failed'); assert.equal(calls, 0); assert.equal(s.state().run.errors[0].code, 'stale');
  } finally { s.cleanup(); }
});
test('dead analysis owner becomes a recorded interrupted failure, with no model replay', async () => {
  const s = sandbox(); try {
    const database = s.db(); try { database.putRun({ ...database.getRun(s.start.run.id)!, status: 'classifying' }); } finally { database.close(); }
    const file = path.join(path.dirname(s.databasePath), 'pipeline-worker.json'); writeFileSync(file, JSON.stringify({ owner: 'dead-worker', pid: 2147483647, runId: s.start.run.id, startedAt: s.clock().toISOString() }));
    recoverRemoteRun(s.start.run.id, s.options); const state = s.state(); assert.equal(state.run.status, 'failed'); assert.equal(state.run.errors[0].code, 'interrupted'); assert.equal(existsSync(file), false);
    await processRemoteRun(s.start.run.id, s.options); assert.deepEqual(s.state(), state);
  } finally { s.cleanup(); }
});
test('late provider results cannot overwrite the original Confirm deadline failure', async () => {
  const s = sandbox(); try {
    const classify = s.dependencies.classify!; s.dependencies.classify = async (...args) => { s.advance(181_000); return classify(...args); };
    await processRemoteRun(s.start.run.id, s.options); const state = s.state();
    assert.equal(state.run.status, 'failed'); assert.equal(state.judgments.length, 0); assert.equal(state.run.errors[0].code, 'deadline'); assert.equal(state.run.stats.allResultsReadyMs, null);
  } finally { s.cleanup(); }
});
test('fixture model injection and primary v1 source are refused on a live run', async () => {
  const s = sandbox('live'); try {
    await assert.rejects(processRemoteRun(s.start.run.id, s.options), error => error instanceof RemoteStateError && error.code === 'validation');
    await assert.rejects(processRemoteRun(s.start.run.id, { ...s.options, contentRoot: 'content', fixtureDependencies: undefined }), error => error instanceof RemoteStateError && error.code === 'validation');
    assert.equal(s.state().run.status, 'collecting'); assert.equal(s.state().judgments.length, 0);
  } finally { s.cleanup(); }
});

test('an unavailable replacement judge remains an operation failure rather than a ready semantic withholding result', async () => {
  const s = sandbox(); try {
    const check = s.dependencies.check!;
    s.dependencies.check = async (...args) => {
      if (args[0].surface === 'email') { args[6]?.onProviderError?.(); return (await check(...args)).map(c => ({ ...c, pass: c.name !== 'rejudge_consistent' })); }
      return check(...args);
    };
    await processRemoteRun(s.start.run.id, s.options); const state = s.state();
    assert.equal(state.run.status, 'failed'); assert.equal(state.groups.length, 0);
    assert.ok(state.run.errors.some(e => e.code === 'provider_failure' && e.passageId === 'email:email/onboarding.md#starter-price'));
  } finally { s.cleanup(); }
});
