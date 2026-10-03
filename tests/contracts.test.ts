import test from 'node:test';
import assert from 'node:assert/strict';
import { MogsDatabase } from '../lib/db';
import { buildFixtures, fixtureJudgmentForReplacement } from '../lib/fixtures';
import { decodeSource, parseSource, renderSource, extractRenderedAsset, replaceSourceBlocks } from '../lib/assets/source';
import { confirmedFacts, initialFacts } from '../lib/facts/derive';
import { hashRecord, sha256 } from '../lib/hash';
import { assertCanSeal, elapsedFromConfirmation } from '../lib/runs/contracts';
import { assertFreshResult, assertPreflight, verificationPass } from '../lib/publication/contracts';
import { PatchSchema, VerificationSchema } from '../lib/types';
import { JevResponseSchema } from '../lib/providers/jev';

const f = buildFixtures();
function seededDb() {
  const db = new MogsDatabase(':memory:');
  db.putFacts(f.facts); db.putFacts(f.after); db.putRun(f.run);
  for (const page of f.pages) db.putPage(f.run.id, page);
  for (const passage of f.passages) db.putPassage(f.run.id, passage);
  db.putGroup(f.group);
  for (const patch of f.patches) db.putPatch(patch);
  db.bindMembers(f.group);
  return db;
}

test('computed values use integer cents and stable confirmation', () => {
  const before = initialFacts(), after = confirmedFacts(before);
  assert.equal(before.company, 'MOGS');
  assert.equal(after.plans.starter.monthlyCents, 4000);
  assert.deepEqual(after.derived.annual_savings_percent, { unit: 'percent', before: 20, after: 40 });
  assert.deepEqual(after.derived.per_day_usd, { unit: 'usd_per_day', before: 1, after: 1.33 });
  assert.deepEqual(after.derived.team_starter_gap_usd, { unit: 'usd', before: 50, after: 40 });
  assert.equal(after.derived.lowest_annual_effective_monthly_usd.after, 24);
  assert.deepEqual(confirmedFacts(after), after);
});
test('source/render/extract preserves IDs, roles, literal tokens and URLs', () => {
  assert.equal(f.passages.length, 9);
  for (const item of f.assets) {
    assert.deepEqual(item.passages.map(p => [p.sourceId, p.role, p.text]), item.asset.blocks.map(b => [b.sourceId, b.role, b.text]));
    assert.equal(item.page.sourceHash, sha256(item.asset.source));
    assert.equal(item.page.metadataHash, hashRecord(item.asset.meta));
  }
  const identical = f.passages.filter(p => p.text === 'Starter is $30 a month.');
  assert.equal(new Set(identical.map(p => p.id)).size, 3);
  assert.ok(f.passages.some(p => p.text.includes('{{ first_name }}')));
  assert.ok(f.passages.some(p => p.text.includes('https://mogs.example/account')));
});
test('two replacements batch in one source file and preserve all other bytes', () => {
  const asset = f.assets[0].asset;
  const edits = [{ sourceId: 'starter-price', original: 'Starter is $30 a month.', replacement: 'Starter is $40 a month.' }, { sourceId: 'starter-savings', original: 'Save 20% on Starter with annual billing.', replacement: 'Save 40% on Starter with annual billing.' }];
  const changed = replaceSourceBlocks(asset, edits, asset.sourceHash);
  assert.equal(changed, asset.source.replace(edits[0].original, edits[0].replacement).replace(edits[1].original, edits[1].replacement));
  const rendered = extractRenderedAsset(renderSource(parseSource(changed, asset.file, asset.surface)), f.pages[0].url);
  assert.equal(rendered.passages.find(p => p.sourceId === 'starter-savings')?.text, edits[1].replacement);
});
test('source grammar and stale replacement failures are explicit', () => {
  const asset = f.assets[0].asset;
  assert.throws(() => parseSource(asset.source.replaceAll('starter-savings', 'starter-price'), asset.file, asset.surface), /Duplicate/);
  assert.throws(() => parseSource(asset.source + '\nUnmarked text', asset.file, asset.surface), /outside|Malformed/);
  assert.throws(() => parseSource(asset.source.replaceAll('\n', '\r\n'), asset.file, asset.surface), /LF/);
  assert.throws(() => decodeSource(Uint8Array.from([0xff])), /encoded|valid/i);
  assert.throws(() => replaceSourceBlocks(asset, [{ sourceId: 'starter-price', original: 'Changed', replacement: 'New' }], asset.sourceHash), /original/);
  assert.throws(() => replaceSourceBlocks(asset, [], sha256('wrong')), /freshness/);
});
test('rendered metadata cannot close the script or create executable markup', () => {
  const asset = { ...f.assets[0].asset, meta: { ...f.assets[0].asset.meta, title: '</script><script>alert(1)</script>' } };
  const html = renderSource(asset);
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.equal(extractRenderedAsset(html, f.pages[0].url).page.meta.title, asset.meta.title);
});
test('group sealing requires full scope, valid membership, targets and every check', () => {
  const collecting = { ...f.group, status: 'collecting' as const, sealedAt: null };
  assertCanSeal(f.run, collecting, f.patches, f.run.scope.assetIds, f.group.memberIds);
  assert.throws(() => assertCanSeal(f.run, collecting, f.patches, f.run.scope.assetIds.slice(1), f.group.memberIds), /scope/);
  assert.throws(() => assertCanSeal(f.run, collecting, f.patches, f.run.scope.assetIds, []), /terminal/);
  assert.throws(() => assertPreflight(f.run, { ...f.group, membershipHash: sha256('wrong') }, f.patches), /membership/);
  assert.throws(() => assertPreflight(f.run, f.group, f.patches.map(p => ({ ...p, checks: p.checks.slice(1) }))), /checks/);
  assert.throws(() => assertPreflight(f.run, f.group, f.patches.map(p => ({ ...p, kind: 'annual_savings' as const }))), /target/);
  assert.throws(() => PatchSchema.parse({ ...f.patches[0], kind: 'threshold', target: null }), /deterministic/);
  assert.equal(elapsedFromConfirmation(f.run, '2026-10-03T19:00:01.000Z'), 1000);
});
test('controlled revisions require intact block and metadata; late responses revalidate context', () => {
  const captured = { fileHash: sha256('before'), blockHash: sha256('block'), contextHash: sha256('context'), metadataHash: sha256('meta') };
  const current = { ...captured, fileHash: sha256('after'), contextHash: sha256('new context') };
  const chain = [{ beforeFileHash: captured.fileHash, afterFileHash: current.fileHash }];
  assert.equal(assertFreshResult(captured, current, chain), 'revalidate_context');
  assert.throws(() => assertFreshResult(captured, current, []), /External/);
  assert.throws(() => assertFreshResult(captured, { ...current, metadataHash: sha256('other eligibility') }, chain), /metadata/);
  assert.throws(() => assertFreshResult(captured, { ...current, blockHash: sha256('changed') }, chain), /block/);
});
test('verification must observe the source and match run, passage, fact, adapter and model', () => {
  const verdict = fixtureJudgmentForReplacement(f.judgments[0]);
  const expected = { runId: f.run.id, passageId: verdict.passageId, factVersion: f.after.version, adapter: verdict.adapter, model: verdict.model };
  assert.equal(verificationPass(true, verdict, 0.7, expected), true);
  assert.equal(verificationPass(false, verdict, 0.7, expected), false);
  for (const bad of [{ ...verdict, runId: 'other' }, { ...verdict, passageId: 'other' }, { ...verdict, factVersion: 999 }, { ...verdict, model: 'other' }]) assert.equal(verificationPass(true, bad, 0.7, expected), false);
  assert.throws(() => VerificationSchema.parse({ passageId: verdict.passageId, url: f.pages[0].url, sourceObserved: false, observedHash: null, judgment: verdict, pass: true, detail: '', checkedAt: f.run.confirmedAt }), /observation/);
});
test('SQLite stores typed records and rejects cross-run group membership', () => {
  const db = seededDb();
  try {
    assert.deepEqual(db.getGroup(f.run.id, f.group.id), f.group);
    db.putRun({ ...f.run, id: 'other-run' });
    db.putGroup({ ...f.group, id: 'other-group', runId: 'other-run' });
    assert.throws(() => db.putPatch({ ...f.patches[0], id: 'cross-run-patch', groupId: 'other-group' }), /FOREIGN KEY/);
    assert.throws(() => db.putGroup({ ...f.group, runId: 'other-run' }), /identity/);
    assert.throws(() => db.putPatch({ ...f.patches[0], runId: 'other-run' }), /identity/);
    db.putPublication(f.publication);
    assert.throws(() => db.putPublication({ ...f.publication, runId: 'other-run' }), /identity/);
    db.putJudgment(f.judgments[0]);
    assert.throws(() => db.putJudgment({ ...f.judgments[0], factVersion: 999 }), /version/);
    assert.equal(db.getGroup(f.run.id, f.group.id)?.runId, f.run.id);
  } finally { db.close(); }
});
test('SQLite snapshots, confirmed timestamp and sealed membership cannot be rewritten', () => {
  const db = seededDb();
  try {
    assert.throws(() => db.putFacts({ ...f.facts, effectiveDate: '2026-10-04' }), /immutable/);
    assert.throws(() => db.putRun({ ...f.run, confirmedAt: '2026-10-03T19:00:01.000Z' }), /immutable/);
    assert.throws(() => db.putRun({ ...f.run, status: 'collecting' }), /transition/);
    assert.throws(() => db.putGroup({ ...f.group, status: 'collecting', sealedAt: null }), /preserved/);
    assert.throws(() => db.putGroup({ ...f.group, memberIds: [], eligibleIds: [], status: 'blocked' }), /preserved/);
  } finally { db.close(); }
});
test('SQLite permits only one live scenario until reset', () => {
  const db = seededDb();
  try { db.putRun({ ...f.run, id: 'live-1', mode: 'live' }); assert.throws(() => db.putRun({ ...f.run, id: 'live-2', changeId: 'different', mode: 'live' }), /UNIQUE/); }
  finally { db.close(); }
});
test('idempotency returns original evidence and conflicts on another payload', () => {
  const db = seededDb();
  try {
    const response = { confirmedAt: f.run.confirmedAt, runId: f.run.id, factVersion: 2 };
    db.remember('confirm', 'test-key', sha256('request'), response, f.run.confirmedAt);
    assert.deepEqual(db.replay('confirm', 'test-key', sha256('request')), response);
    assert.throws(() => db.replay('confirm', 'test-key', sha256('other')), /conflicts/);
    assert.equal(db.reviewActionCount(f.run.id), 0);
    db.addReviewEvent({ id: 'human-approve', runId: f.run.id, groupId: f.group.id, patchId: null, actor: 'human', action: 'approve', at: f.run.confirmedAt, detail: 'One actual human approval.' });
    db.addReviewEvent({ id: 'test-approve', runId: f.run.id, groupId: f.group.id, patchId: null, actor: 'test', action: 'approve', at: f.run.confirmedAt, detail: 'Sandbox approval.' });
    assert.equal(db.reviewActionCount(f.run.id), 1);
  } finally { db.close(); }
});
test('Jev typed response requires separate full probabilities and confidence', () => {
  assert.equal(JevResponseSchema.safeParse({ model: 'jev-1.13.0', answers: { label: { choice: 'contradicting', probabilities: { contradicting: 0.9 } } } }).success, false);
});
