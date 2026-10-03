import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MogsDatabase } from '../lib/db';
import { buildFixtures, FIXTURE_TIME } from '../lib/fixtures';
import { hashRecord, sha256 } from '../lib/hash';
import { prefilter } from '../lib/pipeline';
import { RemoteCoordinator, type RemoteStartInput } from '../lib/runs/remote-service';
import { RemoteDatabase, checkedPatchHash } from '../lib/runs/remote-db';
import { BaselineSchema, RemoteGroupSchema, RemotePatchSchema, RemoteJudgmentSchema, CandidateSchema, SubmissionSchema, type RemoteRun, type LaunchAttempt } from '../lib/runs/remote-types';

const f = buildFixtures();
function sandbox(actor: 'human' | 'test' = 'test') {
  const root = mkdtempSync(path.join(tmpdir(), 'mogs-remote-state-'));
  const databasePath = path.join(root, 'remote/app.db'), legacyPath = path.join(root, 'app.db');
  let now = Date.parse(FIXTURE_TIME);
  const clock = () => new Date(now);
  const origin = 'https://mogs-state-fixture.invalid';
  const pages = f.pages.map(page => ({ ...page, url: origin + new URL(page.url).pathname }));
  const passages = f.passages.map(passage => ({ ...passage, url: origin + new URL(passage.url).pathname }));
  const assets = pages.map(page => ({ assetId: page.assetId, path: page.file === null ? null : 'content/' + page.file, pathname: new URL(page.url).pathname, surface: page.surface, editable: page.editable, sourceHash: page.sourceHash, metadataHash: page.metadataHash, sourceIds: passages.filter(p => p.assetId === page.assetId).map(p => p.sourceId) }));
  const baseline = BaselineSchema.parse({ target: { repository: 'mogs/test-content', baseRef: 'main', productionOrigin: origin, vercelProjectId: 'fixture-project', vercelTeamId: 'fixture-team', statusProducerAppId: 17 }, baseSha: 'a'.repeat(40), deployedSha: 'a'.repeat(40), deploymentId: 'fixture-baseline', deploymentUrl: origin, observedAt: FIXTURE_TIME, inventoryHash: hashRecord(assets), corpusHash: hashRecord(pages.map(p => [p.assetId, p.sourceHash])), factsHash: hashRecord(f.facts), factsFileHash: sha256(JSON.stringify(f.facts, null, 2) + '\n'), assets });
  const input: RemoteStartInput = { baseline, beforeFacts: f.facts, desiredFacts: f.after, config: f.run.config, pages, passages, mode: 'fixture' };
  const options = { databasePath, legacyPath, clock, actor };
  const service = new RemoteCoordinator(options);
  const request = () => ({ contractVersion: 2 as const, launchAttemptId: randomUUID(), idempotencyKey: randomUUID(), expectedFactVersion: 1 as const, baselineHash: hashRecord(baseline) });
  const db = () => new RemoteDatabase(databasePath, { legacyPath, clock });
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  return { root, databasePath, legacyPath, clock, service, options, input, request, db, cleanup, advance: (ms: number) => { now += ms; } };
}
type Sandbox = ReturnType<typeof sandbox>;
function progress(s: Sandbox, run: RemoteRun, status: RemoteRun['status']): RemoteRun {
  const db = s.db();
  try {
    const current = db.getRun(run.id)!;
    const next = { ...current, status, updatedAt: s.clock().toISOString(), stats: { ...current.stats, ...(status === 'ready' ? { allResultsReadyMs: s.clock().getTime() - Date.parse(run.confirmedAt) } : {}) } };
    db.putRun(next); return next;
  } finally { db.close(); }
}
function prepareGroup(s: Sandbox, run: RemoteRun, filtered = false) {
  progress(s, run, 'classifying');
  const db = s.db();
  try {
    for (const judgment of f.judgments) if (!filtered || prefilter(s.input.passages!.find(p => p.id === judgment.passageId)!)) db.putJudgment(RemoteJudgmentSchema.parse({ ...judgment, contractVersion: 2, runId: run.id, launchAttemptId: run.launchAttemptId }));
    if (filtered) db.putRun({ ...db.getRun(run.id)!, filteredPassageIds: s.input.passages!.filter(p => !prefilter(p)).map(p => p.id) });
    db.putRun({ ...db.getRun(run.id)!, status: 'drafting' });
    const group = RemoteGroupSchema.parse({ contractVersion: 2, id: 'group-' + run.id, runId: run.id, launchAttemptId: run.launchAttemptId, factVersion: 2, key: f.group.key, title: f.group.title, memberIds: f.patches.map(p => p.id), eligibleIds: f.patches.map(p => p.id), excludedIds: [], membershipHash: f.group.membershipHash, revision: 0, sealedAt: null, status: 'collecting', approvalId: null });
    db.putGroup(group);
    for (const patch of f.patches) db.putPatch(RemotePatchSchema.parse({ ...patch, contractVersion: 2, launchAttemptId: run.launchAttemptId, runId: run.id, groupId: group.id, url: s.input.pages!.find(p => p.assetId === patch.assetId)!.url }));
    const sealed = { ...group, status: 'sealed' as const, sealedAt: s.clock().toISOString() }; db.putGroup(sealed); return sealed;
  } finally { db.close(); }
}
function closeUnsubmitted(s: Sandbox, attempt: LaunchAttempt) {
  const db = s.db();
  try { db.putAttempt({ ...attempt, state: 'abandoning', revision: attempt.revision + 1 }); db.putAttempt({ ...attempt, state: 'abandoned', revision: attempt.revision + 2, closedAt: s.clock().toISOString(), closureReason: 'Fixture: unsubmitted attempt retired.' }); }
  finally { db.close(); }
}

test('v2 uses a separate database and refuses v1 path, symlink, and populated v1 files', () => {
  const s = sandbox();
  try {
    const v1 = new MogsDatabase(s.legacyPath); v1.close();
    assert.throws(() => new RemoteDatabase(s.legacyPath, { legacyPath: s.legacyPath }), /separate/);
    const link = path.join(s.root, 'v1-link.db'); symlinkSync(s.legacyPath, link);
    assert.throws(() => new RemoteDatabase(link, { legacyPath: s.legacyPath }), /separate/);
    assert.throws(() => new RemoteDatabase(s.legacyPath, { legacyPath: path.join(s.root, 'different-v1.db') }), /non-v2/);
    const db = s.db(); assert.equal((db.connection.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2); db.close();
    const reopened = new MogsDatabase(s.legacyPath); assert.equal((reopened.connection.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 1); reopened.close();
  } finally { s.cleanup(); }
});

test('online v1 backup archives every raw row and idempotency response without rewriting history', async () => {
  const s = sandbox();
  const v1 = new MogsDatabase(s.legacyPath), db = s.db();
  try {
    v1.putFacts(f.facts); v1.putFacts(f.after); v1.putRun(f.run);
    for (const page of f.pages) v1.putPage(f.run.id, page);
    for (const passage of f.passages) v1.putPassage(f.run.id, passage);
    for (const judgment of f.judgments) v1.putJudgment(judgment);
    v1.putGroup(f.group); for (const patch of f.patches) v1.putPatch(patch); v1.bindMembers(f.group); v1.putPublication(f.publication);
    v1.addReviewEvent({ id: 'old-event', runId: f.run.id, groupId: f.group.id, patchId: null, action: 'approve', actor: 'human', at: FIXTURE_TIME, detail: 'Historical local publication.' });
    const rawResponse = '{ "runId" : "fixture-run", "original" : true }';
    v1.connection.prepare('INSERT INTO idempotency VALUES(?,?,?,?,?)').run('confirm', 'historical-key', 'old-fingerprint', rawResponse, FIXTURE_TIME);
    v1.connection.prepare('UPDATE fact_snapshots SET payload=? WHERE version=1').run(JSON.stringify(f.facts, null, 2));
    const names = (v1.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(row => row.name);
    const oldRows = Object.fromEntries(names.map(name => [name, v1.connection.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all()]));
    const first = await db.importLegacy(s.legacyPath), replay = await db.importLegacy(s.legacyPath);
    assert.deepEqual(first, replay);
    for (const name of names) assert.deepEqual(JSON.parse(JSON.stringify(db.legacyRows(first.archiveId, name))), JSON.parse(JSON.stringify(oldRows[name])));
    assert.equal(db.legacyRows(first.archiveId, 'idempotency')[0].response, rawResponse);
    assert.equal(hashRecord(Object.fromEntries(names.map(name => [name, v1.connection.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all()]))), hashRecord(oldRows));
    assert.throws(() => db.connection.prepare('DELETE FROM legacy_rows').run(), /immutable/);
    assert.throws(() => db.replay('v2:correction:confirm', 'historical-key', 'old-fingerprint'), /historical/);
    assert.deepEqual(v1.replay('confirm', 'historical-key', 'old-fingerprint'), { runId: 'fixture-run', original: true });
    assert.ok(v1.connection.prepare("SELECT name FROM sqlite_master WHERE name='one_live_run'").get());
  } finally { db.close(); v1.close(); s.cleanup(); }
});

test('confirm is atomic, writes only desired state, and replays original run/time after restart', () => {
  const s = sandbox();
  try {
    const factsFile = path.join(s.root, 'facts.json'), sourceFile = path.join(s.root, 'source.md');
    writeFileSync(factsFile, JSON.stringify(f.after)); writeFileSync(sourceFile, 'Starter is $30 a month.');
    const request = s.request(), result = s.service.confirm(request, s.input);
    s.advance(30_000);
    assert.deepEqual(new RemoteCoordinator(s.options).confirm(request, s.input), result);
    assert.equal(readFileSync(factsFile, 'utf8'), JSON.stringify(f.after)); assert.equal(readFileSync(sourceFile, 'utf8'), 'Starter is $30 a month.');
    const saved = s.service.export(result.run.id);
    assert.equal(saved.facts.find(value => value.phase === 'before')!.snapshot.plans.starter.monthlyCents, 3000);
    assert.equal(saved.facts.find(value => value.phase === 'desired')!.snapshot.plans.starter.monthlyCents, 4000);
    assert.equal(saved.pages.length, 3); assert.equal(saved.passages.length, 9); assert.equal(saved.submission, null);
    assert.throws(() => s.service.confirm({ ...request, launchAttemptId: randomUUID() }, s.input), /Idempotency/);
    assert.throws(() => s.service.confirm({ ...request, idempotencyKey: randomUUID() }, s.input), /already been confirmed/);
    assert.throws(() => s.service.confirm(s.request(), s.input), /active launch/);
  } finally { s.cleanup(); }
});

test('competing processes reserve only one active target transactionally', async () => {
  const s = sandbox();
  try {
    s.db().close();
    const script = "import { RemoteCoordinator } from './lib/runs/remote-service.ts'; const data=JSON.parse(process.env.MOGS_STATE_TEST_INPUT); try { const result=new RemoteCoordinator({databasePath:data.databasePath,legacyPath:data.legacyPath,clock:()=>new Date(data.at),actor:'test'}).confirm(data.request,data.input); process.stdout.write(JSON.stringify({ok:true,runId:result.run.id})); } catch(error) { process.stdout.write(JSON.stringify({ok:false,code:error.code,message:error.message})); }";
    const output = await Promise.all([s.request(), s.request()].map(request => promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: process.cwd(), env: { ...process.env, MOGS_STATE_TEST_INPUT: JSON.stringify({ databasePath: s.databasePath, legacyPath: s.legacyPath, at: s.clock().toISOString(), request, input: s.input }) } })));
    const results = output.map(item => JSON.parse(item.stdout) as { ok: boolean; code?: string });
    assert.equal(results.filter(r => r.ok).length, 1); assert.equal(results.find(r => !r.ok)?.code, 'busy');
    const db = s.db(); try { assert.equal((db.connection.prepare('SELECT count(*) AS n FROM attempts').get() as { n: number }).n, 1); } finally { db.close(); }
  } finally { s.cleanup(); }
});

test('failed confirmation rolls back target reservation and repeated rehearsals retain independent versions 1/2', () => {
  const s = sandbox();
  try {
    const bad = { ...s.input, passages: [{ ...s.input.passages![0], assetId: 'foreign-page' }] };
    assert.throws(() => s.service.confirm(s.request(), bad), /captured page/);
    const ids = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const result = s.service.confirm(s.request(), s.input); ids.add(result.run.id);
      const db = s.db(); try { assert.equal(db.getFacts(result.attempt.id, 'before')?.version, 1); assert.equal(db.getFacts(result.attempt.id, 'desired')?.version, 2); } finally { db.close(); }
      closeUnsubmitted(s, result.attempt);
    }
    assert.equal(ids.size, 3); for (const id of ids) assert.equal(s.service.export(id).attempt.state, 'abandoned');
  } finally { s.cleanup(); }
});

test('snapshot mutation and cross-attempt results are rejected even with identical numeric fact versions', () => {
  const s = sandbox();
  try {
    const first = s.service.confirm(s.request(), s.input); closeUnsubmitted(s, first.attempt);
    const second = s.service.confirm(s.request(), s.input), db = s.db();
    try {
      assert.throws(() => db.putFacts({ ...db.getFacts(second.attempt.id, 'desired')!, snapshot: { ...f.after, effectiveDate: '2026-10-04' } }), /immutable/);
      assert.throws(() => db.putPage(second.run.id, { ...s.input.pages![0], meta: { ...s.input.pages![0].meta, title: 'changed' } }), /immutable/);
      assert.throws(() => db.putRun({ ...second.run, confirmedAt: '2026-10-03T18:00:00.000Z', deadlineAt: '2026-10-03T18:03:00.000Z' }), /immutable/);
      assert.throws(() => db.putJudgment(RemoteJudgmentSchema.parse({ ...f.judgments[0], contractVersion: 2, runId: second.run.id, launchAttemptId: first.attempt.id })), /Cross-run/);
      assert.throws(() => db.putPassage(second.run.id, { ...s.input.passages![0], text: 'different' }), /immutable/);
    } finally { db.close(); }
  } finally { s.cleanup(); }
});

test('checked group approval records inclusion only, remains idempotent, and invalidates on revised member', () => {
  const s = sandbox('human');
  try {
    const { run } = s.service.confirm(s.request(), s.input), group = prepareGroup(s, run, true);
    const request = { contractVersion: 2 as const, launchAttemptId: run.launchAttemptId, runId: run.id, expectedRevision: 0, membershipHash: group.membershipHash, idempotencyKey: randomUUID() };
    const approved = s.service.approve(group.id, request);
    assert.deepEqual(s.service.approve(group.id, request), approved);
    assert.deepEqual(s.service.approve(group.id, { ...request, idempotencyKey: randomUUID() }), approved);
    const db = s.db();
    try {
      assert.equal(db.getSubmission(run.id), null); assert.equal(db.reviewActionCount(run.id), 1);
      assert.equal(approved.approval.checkedPatchHash, checkedPatchHash(db.patches(run.id)));
      const patch = db.patches(run.id)[0];
      assert.throws(() => db.putPatch({ ...patch, replacement: 'Starter costs $40 a month.' }), /newer revision/);
      db.putPatch({ ...patch, replacement: 'Starter costs $40 a month.', revision: 1 });
      const invalid = db.getGroup(run.id, group.id)!;
      assert.equal(invalid.approvalId, null); assert.equal(invalid.status, 'blocked'); assert.equal(invalid.revision, 1);
      assert.equal(db.approvals(run.id).length, 1);
      db.putGroup({ ...invalid, status: 'sealed' });
    } finally { db.close(); }
    assert.throws(() => s.service.approve(group.id, { ...request, idempotencyKey: randomUUID() }), /current checked/);
    s.service.approve(group.id, { ...request, expectedRevision: 1, idempotencyKey: randomUUID() });
    const saved = s.service.export(run.id); assert.equal(saved.approvals.length, 2); assert.equal(saved.reviewEvents.length, 2);
  } finally { s.cleanup(); }
});

test('incomplete scope, filtered pricing claims, and missing checks cannot become approvable', () => {
  const s = sandbox();
  try {
    const { run } = s.service.confirm(s.request(), s.input), group = prepareGroup(s, run), db = s.db();
    try {
      assert.throws(() => db.putRun({ ...db.getRun(run.id)!, filteredPassageIds: [f.patches[0].passageId] }), /prefilter/);
      assert.throws(() => db.putGroup({ ...group, membershipHash: hashRecord([]) }), /membership hash/);
      const patch = db.patches(run.id)[0]; db.putPatch({ ...patch, revision: 1, checks: patch.checks.slice(1) });
      assert.throws(() => db.putGroup({ ...db.getGroup(run.id, group.id)!, status: 'sealed' }), /passing checks/);
      assert.equal(db.getGroup(run.id, group.id)?.approvalId, null);
    } finally { db.close(); }
  } finally { s.cleanup(); }
});

test('deadline failure freezes analysis and blocks delayed callbacks without releasing the target', () => {
  const s = sandbox();
  try {
    const { run } = s.service.confirm(s.request(), s.input);
    s.advance(180_001);
    const failed = s.service.expireRun(run.id); assert.equal(failed.status, 'failed'); assert.equal(failed.errors[0].code, 'deadline');
    const db = s.db();
    try {
      assert.throws(() => db.putRun({ ...failed, status: 'ready', stats: { ...failed.stats, allResultsReadyMs: 10 } }), /transition/);
      assert.throws(() => db.putJudgment(RemoteJudgmentSchema.parse({ ...f.judgments[0], contractVersion: 2, runId: run.id, launchAttemptId: run.launchAttemptId })), /not accepting/);
      assert.ok(db.activeAttempt(s.input.baseline.target)); assert.deepEqual(db.getRun(run.id), failed);
    } finally { db.close(); }
    assert.throws(() => s.service.confirm(s.request(), s.input), /active launch/);
  } finally { s.cleanup(); }
});

test('omitted captured source blocks cannot be hidden by classifying every stored passage', () => {
  const s = sandbox();
  try {
    const partial = { ...s.input, passages: s.input.passages!.slice(1) }, { run } = s.service.confirm(s.request(), partial);
    progress(s, run, 'classifying');
    const db = s.db();
    try {
      for (const judgment of f.judgments.filter(j => partial.passages.some(p => p.id === j.passageId))) db.putJudgment(RemoteJudgmentSchema.parse({ ...judgment, contractVersion: 2, runId: run.id, launchAttemptId: run.launchAttemptId }));
      const drafting = { ...db.getRun(run.id)!, status: 'drafting' as const }; db.putRun(drafting);
      assert.throws(() => db.putRun({ ...drafting, status: 'ready', stats: { ...drafting.stats, allResultsReadyMs: 0 } }), /Full-scope/);
      assert.equal(db.getRun(run.id)?.status, 'drafting');
    } finally { db.close(); }
  } finally { s.cleanup(); }
});

test('completed analysis supports later human approval but does not reopen its captured classification', () => {
  const s = sandbox();
  try {
    const { run } = s.service.confirm(s.request(), s.input), group = prepareGroup(s, run);
    progress(s, run, 'ready'); s.advance(300_000);
    s.service.approve(group.id, { contractVersion: 2, launchAttemptId: run.launchAttemptId, runId: run.id, expectedRevision: 0, membershipHash: group.membershipHash, idempotencyKey: randomUUID() });
    const db = s.db();
    try {
      const ready = db.getRun(run.id)!; db.putRun({ ...ready, updatedAt: s.clock().toISOString(), stats: { ...ready.stats, reviewActions: 1 } });
      assert.throws(() => db.putRun({ ...ready, filteredPassageIds: [f.passages[0].id] }), /immutable/);
      assert.throws(() => db.putRun({ ...ready, stats: { ...ready.stats, allResultsReadyMs: 90_000 } }), /timing evidence/);
    } finally { db.close(); }
  } finally { s.cleanup(); }
});

test('restoration shares the launch reservation, pins seed identity and cannot receive correction credit', () => {
  const s = sandbox('human');
  try {
    const correction = s.service.confirm(s.request(), s.input);
    const baseline = { ...s.input.baseline, factsHash: hashRecord(f.after), factsFileHash: sha256(JSON.stringify(f.after, null, 2) + '\n') }, input = { ...s.input, baseline, beforeFacts: f.after, desiredFacts: f.facts };
    const request = { contractVersion: 2 as const, launchAttemptId: randomUUID(), idempotencyKey: randomUUID(), expectedFactVersion: 2, baselineHash: hashRecord(baseline), seedRevision: 'b'.repeat(40) };
    assert.throws(() => s.service.startRestoration(request, input), /active launch/);
    closeUnsubmitted(s, correction.attempt);
    const restoration = s.service.startRestoration(request, input);
    assert.deepEqual(new RemoteCoordinator(s.options).startRestoration(request, input), restoration);
    assert.equal(restoration.attempt.purpose, 'restoration'); assert.equal(restoration.attempt.seedRevision, request.seedRevision);
    assert.throws(() => s.service.confirm(s.request(), s.input), /active launch/);
    const saved = s.service.export(restoration.run.id); assert.equal(saved.run.desiredFactVersion, 1); assert.equal(saved.reviewEvents[0].action, 'restore'); assert.equal(saved.run.stats.verified, 0);
  } finally { s.cleanup(); }
});

test('immutable submission rejects changed intent and prevents all post-submission patch edits', () => {
  const s = sandbox();
  try {
    const { run, attempt } = s.service.confirm(s.request(), s.input), group = prepareGroup(s, run);
    s.service.approve(group.id, { contractVersion: 2, launchAttemptId: run.launchAttemptId, runId: run.id, expectedRevision: 0, membershipHash: group.membershipHash, idempotencyKey: randomUUID() }); progress(s, run, 'ready');
    const db = s.db();
    try {
      const candidate = CandidateSchema.parse({ id: 'candidate-' + attempt.id, launchAttemptId: attempt.id, runId: run.id, purpose: 'correction', baselineHash: attempt.baselineHash, baseSha: attempt.baseline.baseSha, desiredFactsHash: attempt.desiredFactsHash, approvals: db.approvals(run.id), files: [{ path: 'data/facts.json', beforeHash: attempt.beforeFactsHash, afterHash: attempt.desiredFactsHash }], bundleHash: hashRecord('fixture-bundle'), treeHash: hashRecord('fixture-tree'), branch: 'codex/launch-' + attempt.id, candidateSha: null, commitMessage: 'Fixture\nLaunch-Attempt: ' + attempt.id, createdAt: FIXTURE_TIME });
      const submission = SubmissionSchema.parse({ id: 'submission-' + attempt.id, launchAttemptId: attempt.id, runId: run.id, candidate, revision: 0, status: 'preparing', journal: 'planned', operationId: randomUUID(), requestFingerprint: hashRecord('request'), prNumber: null, prUrl: null, observedHeadSha: null, failure: null, createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME });
      db.putSubmission(submission);
      assert.throws(() => db.putSubmission({ ...submission, candidate: { ...candidate, bundleHash: hashRecord('other') }, revision: 1 }), /immutable/);
      const patch = db.patches(run.id)[0]; assert.throws(() => db.putPatch({ ...patch, revision: patch.revision + 1, replacement: 'Changed again.' }), /abandonment/);
      assert.deepEqual(db.getSubmission(run.id), submission);
    } finally { db.close(); }
  } finally { s.cleanup(); }
});
