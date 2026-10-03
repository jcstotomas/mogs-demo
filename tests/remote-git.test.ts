import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildRemoteFixtures, fixtureCombinedJudge, seedRemoteFixtureDatabase, REMOTE_FIXTURE_TIME } from '../lib/runs/remote-fixtures';
import { RemoteDatabase } from '../lib/runs/remote-db';
import { RemoteCoordinator } from '../lib/runs/remote-service';
import { assembleCandidate } from '../lib/submission/candidate';
import { assembleRestoration } from '../lib/submission/restoration';
import { RemoteSubmission } from '../lib/submission/service';
import { RemoteRecovery } from '../lib/submission/recovery';
import { GitHubRemote, gitObjectSha, expectedCommitSha, commitRequest, operationMarker } from '../lib/submission/github';
import { EnforcementEvidenceSchema, authorizeStatusSuccess, candidateStatusEvidenceHash, previewStatusEvidenceHash } from '../lib/submission/enforcement';
import { createPublicArtifact } from '../lib/deployment/public-artifact';
import { extractRenderedAsset } from '../lib/assets/source';
import { hashRecord, sha256 } from '../lib/hash';
import { DeploymentObservationSchema, type Submission } from '../lib/runs/remote-types';

type Json = Record<string, unknown>;
const clock = () => new Date(REMOTE_FIXTURE_TIME);
const asObject = (value: unknown) => value as Json;
class FakeGitHub {
  readonly blobs = new Map<string, string>();
  readonly trees = new Map<string, Array<{ path: string; mode: string; type: string; sha: string }>>();
  readonly commits = new Map<string, Json>();
  readonly branches = new Map<string, string>();
  readonly prs: Json[] = [];
  readonly statuses = new Map<string, Json[]>();
  readonly requests: { method: string; path: string; body?: Json }[] = [];
  readonly prefix: string;
  readonly baseTree: string;
  fault: 'commit' | 'branch' | 'pr' | null = null;
  appId = 12345; creatorType = 'Bot'; creatorLogin = 'mogs-status[bot]';
  strict = true; admins = true; requiredAppId: number | null = 12345; allowAutoMerge = false; bypass: unknown[] = []; mergeQueue = false;
  beforeStatusResponse?: () => void;
  beforeMutation?: () => void;
  constructor(readonly f: ReturnType<typeof buildRemoteFixtures>) {
    this.prefix = '/repos/' + f.state.attempt.baseline.target.repository;
    const files = { ...Object.fromEntries(Object.entries(f.baseSources).map(([file, source]) => ['content/' + file, source])), 'data/facts.json': f.seedFactsText, 'content/seed.json': readFileSync('fixtures/remote/miniature/seed.json', 'utf8'), 'data/seed/facts.json': f.seedFactsText, 'apps/public/index.js': '// untouched public app' };
    const tree = Object.entries(files).map(([file, source]) => { const sha = gitObjectSha('blob', source); this.blobs.set(sha, source); return { path: file, mode: '100644', type: 'blob', sha }; });
    this.baseTree = hashRecord(tree).slice(0, 40); this.trees.set(this.baseTree, tree);
    this.commits.set(f.state.attempt.baseline.baseSha, { sha: f.state.attempt.baseline.baseSha, tree: { sha: this.baseTree } });
    this.branches.set('main', f.state.attempt.baseline.baseSha);
  }
  private response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
  private lost(kind: typeof this.fault) { if (this.fault === kind) { this.fault = null; throw new TypeError('Fixture lost response after remote effect.'); } }
  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? 'GET', body = init?.body ? asObject(JSON.parse(String(init.body))) : undefined;
    assert.equal(url.origin, 'https://api.github.com'); assert.match(new Headers(init?.headers).get('Authorization') ?? '', /^Bearer fixture-only-token$/);
    this.requests.push({ method, path: url.pathname, body });
    if (method !== 'GET') this.beforeMutation?.();
    if (method === 'GET' && url.pathname === '/apps/mogs-status') return this.response({ id: this.appId, slug: 'mogs-status' });
    if (method === 'GET' && url.pathname === this.prefix) return this.response({ full_name: this.f.state.attempt.baseline.target.repository, allow_auto_merge: this.allowAutoMerge });
    const suffix = url.pathname.slice(this.prefix.length);
    if (method === 'GET' && suffix === '/branches/main/protection') return this.response({ required_status_checks: { strict: this.strict, checks: ['mogs/candidate', 'mogs/preview'].map(context => ({ context, app_id: this.requiredAppId })) }, enforce_admins: { enabled: this.admins }, required_pull_request_reviews: { bypass_pull_request_allowances: { users: this.bypass, teams: [], apps: [] } }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false } });
    if (method === 'GET' && suffix === '/rules/branches/main') return this.response(this.mergeQueue ? [{ type: 'merge_queue', ruleset_id: 1 }] : []);
    if (method === 'GET' && suffix === '/rulesets') return this.response([{ id: 1, source_type: 'Repository', source: this.f.state.attempt.baseline.target.repository }]);
    if (method === 'GET' && suffix === '/rulesets/1') return this.response({ enforcement: 'active', bypass_actors: [] });
    if (method === 'GET' && suffix.startsWith('/git/ref/heads/')) {
      const branch = decodeURIComponent(suffix.slice('/git/ref/heads/'.length)), sha = this.branches.get(branch);
      return sha ? this.response({ ref: 'refs/heads/' + branch, object: { sha } }) : this.response({}, 404);
    }
    if (method === 'GET' && suffix.startsWith('/git/commits/')) return this.response(this.commits.get(suffix.slice('/git/commits/'.length)) ?? {}, this.commits.has(suffix.slice('/git/commits/'.length)) ? 200 : 404);
    if (method === 'GET' && suffix.startsWith('/git/trees/')) { const sha = suffix.slice('/git/trees/'.length); return this.response({ sha, tree: this.trees.get(sha), truncated: false }); }
    if (method === 'GET' && suffix.startsWith('/git/blobs/')) { const sha = suffix.slice('/git/blobs/'.length), content = this.blobs.get(sha); return this.response({ sha, encoding: 'base64', content: Buffer.from(content!).toString('base64') }); }
    if (method === 'POST' && suffix === '/git/blobs') { const content = String(body!.content), sha = gitObjectSha('blob', content); this.blobs.set(sha, content); return this.response({ sha }, 201); }
    if (method === 'POST' && suffix === '/git/trees') {
      const changes = body!.tree as Array<{ path: string; mode: string; type: string; sha: string }>;
      const tree = this.trees.get(String(body!.base_tree))!.map(entry => changes.find(change => change.path === entry.path) ?? entry);
      const sha = hashRecord(tree).slice(0, 40); this.trees.set(sha, tree); return this.response({ sha }, 201);
    }
    if (method === 'POST' && suffix === '/git/commits') {
      const author = asObject(body!.author), committer = asObject(body!.committer);
      const identity = (person: Json) => `${person.name} <${person.email}> ${Math.floor(Date.parse(String(person.date)) / 1000)} +0000`;
      const raw = `tree ${body!.tree}\nparent ${(body!.parents as string[])[0]}\nauthor ${identity(author)}\ncommitter ${identity(committer)}\n\n${body!.message}`;
      const sha = gitObjectSha('commit', raw); this.commits.set(sha, { ...body, sha, tree: { sha: body!.tree } }); this.lost('commit'); return this.response({ sha }, 201);
    }
    if (method === 'POST' && suffix === '/git/refs') {
      const branch = String(body!.ref).slice('refs/heads/'.length);
      if (this.branches.has(branch)) return this.response({}, 422);
      this.branches.set(branch, String(body!.sha)); this.lost('branch'); return this.response({ ref: body!.ref, object: { sha: body!.sha } }, 201);
    }
    if (method === 'GET' && suffix === '/pulls') return this.response(this.prs.filter(pr => asObject(pr.head).ref === url.searchParams.get('head')!.split(':').slice(1).join(':') && asObject(pr.base).ref === url.searchParams.get('base')));
    if (method === 'POST' && suffix === '/pulls') {
      if (this.prs.some(pr => pr.state === 'open' && asObject(pr.head).ref === body!.head && asObject(pr.base).ref === body!.base)) return this.response({}, 422);
      const number = this.prs.length + 1, repo = { full_name: this.f.state.attempt.baseline.target.repository };
      const pr = { number, html_url: 'https://github.com/' + repo.full_name + '/pull/' + number, body: body!.body, state: 'open', head: { ref: body!.head, sha: this.branches.get(String(body!.head)), repo }, base: { ref: body!.base, sha: this.branches.get(String(body!.base)), repo }, auto_merge: null, merged_at: null, merge_commit_sha: null };
      this.prs.push(pr); this.lost('pr'); return this.response(pr, 201);
    }
    if (suffix.startsWith('/pulls/')) {
      const pr = this.prs.find(item => item.number === Number(suffix.slice('/pulls/'.length)));
      if (!pr) return this.response({}, 404);
      if (method === 'PATCH') Object.assign(pr, body);
      return this.response(pr);
    }
    if (method === 'POST' && suffix.startsWith('/statuses/')) {
      const sha = suffix.slice('/statuses/'.length), status = { ...body, creator: { type: this.creatorType, login: this.creatorLogin }, url: 'https://api.github.com' + this.prefix + '/statuses/' + sha, created_at: REMOTE_FIXTURE_TIME };
      this.statuses.set(sha, [status, ...(this.statuses.get(sha) ?? [])]); this.beforeStatusResponse?.(); return this.response(status, 201);
    }
    if (method === 'GET' && /^\/commits\/[a-f0-9]{40}\/statuses$/.test(suffix)) return this.response(this.statuses.get(suffix.split('/')[2]) ?? []);
    throw new Error('Unexpected fake GitHub request: ' + method + ' ' + suffix);
  };
}

async function setup(mode: 'fixture' | 'live' = 'fixture') {
  const root = mkdtempSync(path.join(tmpdir(), 'mogs-remote-git-')), file = path.join(root, 'remote.db'), f = buildRemoteFixtures();
  f.state.run.mode = mode;
  let db = new RemoteDatabase(file, { clock }); seedRemoteFixtureDatabase(db, f);
  const bundle = await assembleCandidate(db.export(f.state.run.id), f.baseSources, f.state.attempt.baseline, fixtureCombinedJudge(f), REMOTE_FIXTURE_TIME), fake = new FakeGitHub(f);
  const remote = new GitHubRemote({ target: f.state.attempt.baseline.target, token: 'fixture-only-token', appSlug: 'mogs-status', fetch: fake.fetch, clock, stateStore: () => db, testOnlyAllowFixtureEvidence: true, readLocal: runId => { const submission = db.getSubmission(runId), attempt = submission && db.getAttempt(submission.launchAttemptId); return submission && attempt ? { submission, attempt } : null; } });
  const request = { contractVersion: 2, launchAttemptId: f.state.attempt.id, runId: f.state.run.id, expectedAttemptRevision: 0, baseSha: f.state.attempt.baseline.baseSha, bundleHash: bundle.candidate.bundleHash, approvals: bundle.candidate.approvals.map(a => ({ groupId: a.groupId, revision: a.revision, membershipHash: a.membershipHash })), idempotencyKey: randomUUID() };
  return { f, fake, remote, request, bundle, get db() { return db; }, service: () => new RemoteSubmission(db, remote, clock, 'human'), reopen: () => { db.close(); db = new RemoteDatabase(file, { clock }); }, cleanup: () => { db.close(); rmSync(root, { recursive: true, force: true }); } };
}
function enforcement(s: Awaited<ReturnType<typeof setup>>, submission: Submission) { return EnforcementEvidenceSchema.parse({ repository: s.remote.target.repository, baseRef: 'main', producerAppId: s.remote.target.statusProducerAppId, checks: ['mogs/candidate', 'mogs/preview'].map(context => ({ context, appId: s.remote.target.statusProducerAppId })), strict: true, enforceAdmins: true, bypassActors: [], mergeQueue: false, autoMerge: false, probes: { pendingBlocked: true, failureBlocked: true, wrongHeadBlocked: true, currentHeadEligible: true }, testedSha: submission.candidate.candidateSha, verifiedAt: REMOTE_FIXTURE_TIME }); }
function previewFixture(s: Awaited<ReturnType<typeof setup>>, submission: Submission) {
  const artifact = createPublicArtifact({ sourceCommit: submission.candidate.candidateSha!, mode: 'commit', seedManifestText: readFileSync('fixtures/remote/miniature/seed.json', 'utf8'), factText: s.bundle.images['data/facts.json'], sourceTexts: Object.fromEntries(Object.entries(s.f.baseSources).map(([file, source]) => [file, s.bundle.images['content/' + file] ?? source])) });
  const origin = 'https://mogs-preview-fixture.invalid', passages = artifact.routes.flatMap(route => extractRenderedAsset(route.html, origin + route.pathname).passages);
  return DeploymentObservationSchema.parse({ id: randomUUID(), launchAttemptId: submission.launchAttemptId, submissionId: submission.id, environment: 'preview', deploymentId: 'fixture-preview', url: origin, candidateSha: submission.candidate.candidateSha, mergedSha: null, deployedSha: submission.candidate.candidateSha, readiness: 'ready', verification: 'passed', inventoryHash: artifact.inventoryHash, factsHash: artifact.factsHash, publishedFacts: s.f.state.facts.find(fact => fact.phase === 'desired')!.snapshot, sourceHashes: Object.fromEntries(artifact.assets.map(asset => [asset.assetId, asset.sourceHash])), blocks: submission.candidate.approvals.flatMap(approval => approval.eligibleIds).map(id => {
    const patch = s.db.getPatch(submission.runId, id)!, passage = passages.find(p => p.id === patch.passageId)!, { contractVersion: _v, launchAttemptId: _a, ...original } = s.f.state.judgments.find(j => j.passageId === patch.passageId)!;
    return { passageId: patch.passageId, url: passage.url, sourceObserved: true, observedHash: passage.blockHash, judgment: { ...original, label: 'consistent' }, pass: true, detail: 'Synthetic complete preview proof for fixture only.', checkedAt: REMOTE_FIXTURE_TIME };
  }), failures: [], observedAt: REMOTE_FIXTURE_TIME });
}

test('submission journals exact checked images then creates one deterministic commit, branch and PR', async () => {
  const s = await setup();
  try {
    s.fake.beforeMutation = () => { assert.ok(s.db.getSubmission(s.f.state.run.id)); assert.deepEqual(s.db.getCandidateImages(s.f.state.run.id), s.bundle.images); assert.deepEqual(s.db.getCandidateChecks(s.f.state.run.id), s.bundle.checks); };
    const result = await s.service().submit(s.request, s.bundle);
    assert.equal(result.status, 'submitted'); assert.equal(result.journal, 'pr_opened'); assert.equal(s.fake.prs.length, 1);
    assert.deepEqual(s.db.getCandidateImages(s.f.state.run.id), s.bundle.images);
    const commit = s.fake.commits.get(result.candidate.candidateSha!)!;
    assert.equal(result.candidate.candidateSha, expectedCommitSha(s.bundle.candidate, String(asObject(commit.tree).sha)));
    assert.deepEqual(asObject(commit.author), commitRequest(s.bundle.candidate, String(asObject(commit.tree).sha)).author);
    assert.ok(String(s.fake.prs[0].body).includes(operationMarker(result)));
    assert.deepEqual(await s.service().submit(s.request), result); assert.equal(s.db.reviewActionCount(result.runId), 1);
    assert.equal(s.fake.branches.get('main'), s.f.state.attempt.baseline.baseSha);
    assert.equal(s.fake.requests.some(r => r.method === 'PATCH' && r.path.includes('/git/refs')), false);
    assert.equal(s.fake.requests.some(r => /\/merge|auto-merge/.test(r.path)), false);
  } finally { s.cleanup(); }
});

for (const fault of ['commit', 'branch', 'pr'] as const) test('lost ' + fault + ' response resumes the original operation after reopening the database', async () => {
  const s = await setup();
  try {
    s.fake.fault = fault;
    const first = await s.service().submit(s.request, s.bundle); assert.equal(first.status, 'failed');
    const identity = [first.id, first.operationId, first.createdAt]; s.reopen();
    const recovered = await s.service().submit(s.request);
    assert.equal(recovered.status, 'submitted'); assert.deepEqual([recovered.id, recovered.operationId, recovered.createdAt], identity);
    assert.equal(s.fake.prs.length, 1); assert.equal(s.fake.branches.size, 2); assert.equal(s.fake.commits.size, 2); assert.equal(s.db.reviewActionCount(first.runId), 1);
    assert.deepEqual(s.db.getCandidateImages(first.runId), s.bundle.images);
    assert.deepEqual(s.db.getCandidateChecks(first.runId), s.bundle.checks);
  } finally { s.cleanup(); }
});

test('unknown run branch, foreign PR marker and moved base never overwrite or create a second PR', async () => {
  for (const conflict of ['branch', 'marker', 'base'] as const) {
    const s = await setup();
    try {
      if (conflict === 'branch') s.fake.branches.set(s.bundle.candidate.branch, 'c'.repeat(40));
      if (conflict === 'base') s.fake.branches.set('main', 'c'.repeat(40));
      if (conflict === 'marker') { s.fake.fault = 'pr'; await s.service().submit(s.request, s.bundle); s.fake.prs[0].body = 'Unrecognized external work'; }
      const result = await s.service().submit(s.request, conflict === 'marker' ? undefined : s.bundle);
      assert.equal(result.status, 'blocked'); assert.equal(s.fake.prs.length, conflict === 'marker' ? 1 : 0);
      if (conflict === 'branch') assert.equal(s.fake.branches.get(s.bundle.candidate.branch), 'c'.repeat(40));
      assert.equal(s.fake.requests.some(r => r.method === 'PATCH'), false);
    } finally { s.cleanup(); }
  }
});

test('changed retries and immutable candidate bytes cannot substitute a different checked bundle', async () => {
  const s = await setup();
  try {
    await s.service().submit(s.request, s.bundle);
    await assert.rejects(s.service().submit({ ...s.request, bundleHash: sha256('changed') }), /Idempotency/);
    await assert.rejects(s.service().submit(s.request, { ...s.bundle, images: { ...s.bundle.images, 'data/facts.json': '{}' } }), /Retry images/);
    assert.throws(() => s.db.putCandidateImages(s.f.state.run.id, { ...s.bundle.images, 'data/facts.json': '{}' }), /frozen path/);
    assert.throws(() => s.db.connection.prepare('DELETE FROM candidate_images').run(), /immutable/);
    assert.equal(s.fake.prs.length, 1); assert.equal(s.db.reviewActionCount(s.f.state.run.id), 1);
  } finally { s.cleanup(); }
});

test('simultaneous retries share one durable operation and create one PR and review action', async () => {
  const s = await setup();
  try {
    const [first, second] = await Promise.all([s.service().submit(s.request, s.bundle), s.service().submit(s.request)]);
    assert.equal(first.operationId, second.operationId); assert.equal(first.prNumber, second.prNumber);
    assert.equal(s.fake.prs.length, 1); assert.equal(s.fake.requests.filter(r => r.method === 'POST' && r.path.endsWith('/pulls')).length, 1);
    assert.equal(s.db.reviewActionCount(first.runId), 1);
  } finally { s.cleanup(); }
});

test('missing or failed final combined checks cannot journal a correction or trigger GitHub writes', async () => {
  const s = await setup();
  try {
    const id = Object.keys(s.bundle.checks)[0];
    for (const checks of [{}, { ...s.bundle.checks, [id]: s.bundle.checks[id].slice(1) }, { ...s.bundle.checks, [id]: s.bundle.checks[id].map((check, index) => index ? check : { ...check, pass: false }) }]) {
      await assert.rejects(s.service().submit(s.request, { ...s.bundle, checks }), /combined checks|combined.*correction/i);
      assert.equal(s.db.getSubmission(s.f.state.run.id), null); assert.equal(s.fake.requests.length, 0);
    }
    await s.service().submit(s.request, s.bundle);
    const changed = { ...s.bundle.checks, [id]: s.bundle.checks[id].map(check => ({ ...check, detail: 'Changed after approval.' })) };
    await assert.rejects(s.service().submit(s.request, { ...s.bundle, checks: changed }), /Retry images or checks/);
    assert.throws(() => s.db.putCandidateImages(s.f.state.run.id, s.bundle.images, changed), /immutable/);
  } finally { s.cleanup(); }
});

test('an otherwise approved correction cannot override a protected or ambiguous original judgment', async () => {
  const s = await setup();
  try {
    const passageId = s.f.state.patches.find(patch => patch.status === 'drafted')!.passageId;
    for (const change of [{ label: 'valid_exception' as const }, { label: 'consistent' as const }, { label: 'insufficient_context' as const }, { escalatedBy: 'scope_conflict' as const }, { model: 'another-model' }]) {
      const state = structuredClone(s.f.state), judgment = state.judgments.find(item => item.passageId === passageId)!;
      Object.assign(judgment, change);
      await assert.rejects(assembleCandidate(state, s.f.baseSources, state.attempt.baseline, fixtureCombinedJudge(s.f), REMOTE_FIXTURE_TIME), /unambiguous original contradiction/);
    }
    assert.equal(s.fake.requests.length, 0);
  } finally { s.cleanup(); }
});

test('settings are reported separately from probe evidence and reject unbound checks, bypasses, queue or auto-merge', async () => {
  const s = await setup();
  try {
    const settings = await s.remote.readEnforcementSettings(); s.remote.assertEnforcementSettings(settings);
    assert.equal('probes' in settings, false); assert.equal('passed' in settings, false);
    for (const override of [{ strict: false }, { enforceAdmins: false }, { bypassActors: ['admin'] }, { mergeQueue: true }, { autoMerge: true }, { checks: [{ context: 'mogs/candidate', appId: null }, { context: 'mogs/preview', appId: null }] }]) assert.throws(() => s.remote.assertEnforcementSettings({ ...settings, ...override }), /insufficient/);
    s.fake.mergeQueue = true; assert.equal((await s.remote.readEnforcementSettings()).mergeQueue, true);
    const result = await s.service().submit(s.request, s.bundle); assert.equal(result.status, 'blocked'); assert.equal(s.fake.prs.length, 0);
    assert.equal(s.fake.requests.filter(r => r.method !== 'GET').length, 0);
  } finally { s.cleanup(); }
});

test('status producer requires the configured App ID and actual bot-authored response', async () => {
  const s = await setup();
  try {
    const result = await s.service().submit(s.request, s.bundle), proof = enforcement(s, result), evidenceHash = candidateStatusEvidenceHash(s.db, result.runId);
    const status = await s.remote.postStatus(result, result.candidate.candidateSha!, 'mogs/candidate', 'success', evidenceHash, proof);
    assert.equal(status.producerAppId, 12345); assert.equal(status.evidenceHash, evidenceHash);
    s.fake.creatorType = 'User'; s.fake.creatorLogin = 'human';
    await assert.rejects(s.remote.postFailure(result, result.candidate.candidateSha!, 'mogs/preview', evidenceHash), /configured GitHub App bot/);
    s.fake.appId = 999;
    const writes = s.fake.requests.filter(r => r.method === 'POST').length;
    await assert.rejects(s.remote.postFailure(result, result.candidate.candidateSha!, 'mogs/candidate', evidenceHash), /do not match/);
    assert.equal(s.fake.requests.filter(r => r.method === 'POST').length, writes);
  } finally { s.cleanup(); }
});

test('success requires exact durable context proof and fixture evidence never authorizes production by default', async () => {
  const s = await setup();
  try {
    const submission = await s.service().submit(s.request, s.bundle), proof = enforcement(s, submission), sha = submission.candidate.candidateSha!;
    const candidateHash = candidateStatusEvidenceHash(s.db, submission.runId);
    assert.throws(() => authorizeStatusSuccess(s.db, submission, sha, 'mogs/candidate', candidateHash), /Fixture\/evaluation evidence/);
    await assert.rejects(s.remote.postStatus(submission, sha, 'mogs/candidate', 'success', sha256('arbitrary'), proof), /does not match durable/);
    await assert.rejects(s.remote.postStatus(submission, sha, 'mogs/preview', 'success', sha256('no preview'), proof), /complete passing preview/);
    assert.equal(s.fake.statuses.size, 0);
    const incomplete = previewFixture(s, submission); delete incomplete.sourceHashes[Object.keys(incomplete.sourceHashes)[0]];
    s.db.putObservation(incomplete);
    await assert.rejects(s.remote.postStatus(submission, sha, 'mogs/preview', 'success', previewStatusEvidenceHash(incomplete), proof), /mapped\/protected/);
    const passing = previewFixture(s, submission); s.db.putObservation(passing);
    const status = await s.remote.postStatus(submission, sha, 'mogs/preview', 'success', previewStatusEvidenceHash(passing), proof);
    assert.equal(status.state, 'success');
    s.db.putObservation({ ...passing, id: randomUUID(), verification: 'failed', blocks: [], failures: ['Synthetic later verification failure.'] });
    await assert.rejects(s.remote.postStatus(submission, sha, 'mogs/preview', 'success', previewStatusEvidenceHash(passing), proof), /complete passing preview/);
    assert.throws(() => authorizeStatusSuccess(s.db, submission, 'f'.repeat(40), 'mogs/candidate', candidateHash, { testOnlyAllowFixtureEvidence: true }), /stale/);
  } finally { s.cleanup(); }
});

test('success rejects stale PR heads and abandoned local attempts; terminal failures remain available', async () => {
  const s = await setup();
  try {
    const result = await s.service().submit(s.request, s.bundle), proof = enforcement(s, result), evidenceHash = candidateStatusEvidenceHash(s.db, result.runId);
    asObject(s.fake.prs[0].head).sha = 'd'.repeat(40);
    await assert.rejects(s.remote.postStatus(result, result.candidate.candidateSha!, 'mogs/candidate', 'success', evidenceHash, proof), /exact current/);
    const attempt = s.db.getAttempt(result.launchAttemptId)!; s.db.putAttempt({ ...attempt, state: 'abandoning', revision: 1 });
    await assert.rejects(s.remote.postStatus(result, result.candidate.candidateSha!, 'mogs/preview', 'success', evidenceHash, proof), /Inactive/);
    const failure = await s.remote.postFailure(result, 'd'.repeat(40), 'mogs/preview', evidenceHash);
    assert.equal(failure.state, 'failure'); assert.equal((await s.remote.readStatuses(result, 'd'.repeat(40)))[0].state, 'failure');
    await s.remote.closePullRequest(result); assert.equal(s.fake.prs[0].state, 'closed');
  } finally { s.cleanup(); }
});

test('live success requires human approvals even when the explicit fixture seam is enabled', async () => {
  const s = await setup('live');
  try {
    const submission = await s.service().submit(s.request, s.bundle);
    await assert.rejects(s.remote.postStatus(submission, submission.candidate.candidateSha!, 'mogs/candidate', 'success', candidateStatusEvidenceHash(s.db, submission.runId), enforcement(s, submission)), /original human approvals/);
    assert.equal(s.fake.statuses.size, 0);
  } finally { s.cleanup(); }
});

test('retirement racing an in-flight success ends with a failing context', async () => {
  const s = await setup();
  try {
    const result = await s.service().submit(s.request, s.bundle);
    s.fake.beforeStatusResponse = () => {
      s.fake.beforeStatusResponse = undefined;
      const attempt = s.db.getAttempt(result.launchAttemptId)!; s.db.putAttempt({ ...attempt, state: 'abandoning', revision: attempt.revision + 1 });
    };
    await assert.rejects(s.remote.postStatus(result, result.candidate.candidateSha!, 'mogs/candidate', 'success', candidateStatusEvidenceHash(s.db, result.runId), enforcement(s, result)), /replaced with failure/);
    assert.equal((await s.remote.readStatuses(result, result.candidate.candidateSha!))[0].state, 'failure');
    assert.equal(s.db.activeAttempt(s.remote.target)?.state, 'abandoning');
  } finally { s.cleanup(); }
});

test('interrupted merge-race journal transition cannot leave an unrecoverable abandoning attempt', async () => {
  const s = await setup();
  try {
    const submission = await s.service().submit(s.request, s.bundle);
    s.fake.prs[0].state = 'closed'; s.fake.prs[0].merged_at = REMOTE_FIXTURE_TIME; s.fake.prs[0].merge_commit_sha = 'e'.repeat(40);
    const writeAttempt = s.db.putAttempt.bind(s.db); let interrupt = true;
    s.db.putAttempt = attempt => { if (interrupt && attempt.state === 'merged_failure') { interrupt = false; throw new Error('Fixture failure between journal and attempt writes.'); } writeAttempt(attempt); };
    const recovery = new RemoteRecovery(s.db, s.remote, clock);
    const request = { contractVersion: 2, launchAttemptId: submission.launchAttemptId, runId: submission.runId, expectedAttemptRevision: 0, expectedSubmissionRevision: submission.revision, idempotencyKey: randomUUID(), reason: 'Fixture merge race.' };
    const interrupted = await recovery.abandon(request);
    assert.equal(interrupted.status, 'unknown'); assert.equal(s.db.getAttempt(submission.launchAttemptId)?.state, 'abandoning');
    const resumed = await recovery.abandon(request);
    assert.equal(resumed.status, 'merged_observed'); assert.equal(s.db.getAttempt(submission.launchAttemptId)?.state, 'merged_failure');
    assert.equal(resumed.id, interrupted.id); assert.equal(s.db.reviewActionCount(submission.runId), 2);
  } finally { s.cleanup(); }
});

test('candidate commit identity differs across attempts and cannot be assigned to a second attempt in the store', async () => {
  const s = await setup();
  try {
    const first = await s.service().submit(s.request, s.bundle), attempt = s.db.getAttempt(first.launchAttemptId)!;
    s.db.putAttempt({ ...attempt, state: 'abandoning', revision: 1 }); s.db.putAttempt({ ...attempt, state: 'abandoned', revision: 2, closedAt: REMOTE_FIXTURE_TIME, closureReason: 'Synthetic retired fixture.' });
    const next = buildRemoteFixtures(randomUUID()); seedRemoteFixtureDatabase(s.db, next);
    const bundle = await assembleCandidate(s.db.export(next.state.run.id), next.baseSources, next.state.attempt.baseline, fixtureCombinedJudge(next), REMOTE_FIXTURE_TIME);
    assert.notEqual(expectedCommitSha(s.bundle.candidate, s.fake.baseTree), expectedCommitSha(bundle.candidate, s.fake.baseTree));
    assert.throws(() => s.db.putCandidate({ ...bundle.candidate, candidateSha: first.candidate.candidateSha }), /UNIQUE/);
  } finally { s.cleanup(); }
});

test('restoration verifies seed manifest and fact bytes from the exact pinned Git revision before writing', async () => {
  for (const malicious of [false, true]) {
    const s = await setup();
    try {
      const old = s.db.getAttempt(s.f.state.attempt.id)!;
      s.db.putAttempt({ ...old, state: 'abandoning', revision: 1 }); s.db.putAttempt({ ...old, state: 'abandoned', revision: 2, closedAt: REMOTE_FIXTURE_TIME, closureReason: 'Fixture preparation.' });
      const currentSources = Object.fromEntries(Object.entries(s.f.baseSources).map(([file, source]) => [file, s.bundle.images['content/' + file] ?? source]));
      const currentSha = 'c'.repeat(40), artifact = createPublicArtifact({ sourceCommit: currentSha, mode: 'commit', seedManifestText: readFileSync('fixtures/remote/miniature/seed.json', 'utf8'), factText: s.bundle.images['data/facts.json'], sourceTexts: currentSources });
      const currentFiles = { ...Object.fromEntries(Object.entries(currentSources).map(([file, source]) => ['content/' + file, source])), 'data/facts.json': s.bundle.images['data/facts.json'], 'content/seed.json': readFileSync('fixtures/remote/miniature/seed.json', 'utf8'), 'data/seed/facts.json': s.f.seedFactsText, 'apps/public/index.js': '// untouched public app' };
      const tree = Object.entries(currentFiles).map(([file, source]) => { const sha = gitObjectSha('blob', source); s.fake.blobs.set(sha, source); return { path: file, mode: '100644', type: 'blob', sha }; });
      const treeSha = hashRecord(tree).slice(0, 40); s.fake.trees.set(treeSha, tree); s.fake.commits.set(currentSha, { sha: currentSha, tree: { sha: treeSha } }); s.fake.branches.set('main', currentSha);
      const baseline = { ...old.baseline, baseSha: currentSha, deployedSha: currentSha, factsHash: artifact.factsHash, factsFileHash: artifact.factsFileHash, inventoryHash: artifact.inventoryHash, assets: artifact.assets };
      const extracted = artifact.routes.map(route => extractRenderedAsset(route.html, baseline.target.productionOrigin + route.pathname));
      const coordinator = new RemoteCoordinator({ databasePath: s.db.file, clock, actor: 'test' });
      const started = coordinator.startRestoration({ contractVersion: 2, launchAttemptId: randomUUID(), idempotencyKey: randomUUID(), expectedFactVersion: 2, baselineHash: hashRecord(baseline), seedRevision: old.baseline.baseSha }, { baseline, beforeFacts: s.f.state.facts.find(fact => fact.phase === 'desired')!.snapshot, desiredFacts: s.f.state.facts.find(fact => fact.phase === 'before')!.snapshot, config: s.f.state.run.config, pages: extracted.map(item => item.page), passages: extracted.flatMap(item => item.passages), mode: 'fixture' });
      const seed = structuredClone(s.f.seed);
      if (malicious) { const entry = seed.sources['email/eligible.md']; entry.source = entry.source.replace('Starter is $30 a month.', 'Starter is $31 a month.'); entry.hash = sha256(entry.source); }
      const bundle = assembleRestoration(started.attempt, baseline, currentSources, seed, s.f.seedFactsText, REMOTE_FIXTURE_TIME);
      const request = { contractVersion: 2, launchAttemptId: started.attempt.id, runId: started.run.id, expectedAttemptRevision: 0, baseSha: currentSha, bundleHash: bundle.candidate.bundleHash, approvals: [], idempotencyKey: randomUUID() };
      const result = await s.service().submit(request, bundle);
      if (malicious) { assert.equal(result.status, 'failed'); assert.equal(s.fake.requests.filter(call => call.method !== 'GET').length, 0); assert.equal(s.fake.prs.length, 0); }
      else { assert.equal(result.status, 'submitted'); assert.equal(s.fake.prs.length, 1); assert.deepEqual(s.db.getCandidateChecks(started.run.id), {}); assert.equal(s.db.patches(started.run.id).length, 0); }
      assert.ok(s.fake.requests.some(call => call.path.endsWith('/git/commits/' + old.baseline.baseSha)));
    } finally { s.cleanup(); }
  }
});

test('trusted seed reads reject mutable refs, foreign repositories, mismatched commits and corrupt blob bytes', async () => {
  const s = await setup();
  try {
    const revision = s.f.state.attempt.baseline.baseSha;
    const seed = await s.remote.readSeed(revision);
    assert.equal(seed.seedFactsText, s.f.seedFactsText);
    assert.equal(seed.seedManifestText, readFileSync('fixtures/remote/miniature/seed.json', 'utf8'));
    await assert.rejects(s.remote.readSeed('main'));
    const foreign = new GitHubRemote({ target: s.remote.target, token: 'fixture-only-token', readLocal: () => null, fetch: async () => new Response(JSON.stringify({ full_name: 'another/repository' })) });
    await assert.rejects(foreign.readSeed(revision), /repository identity/);
    const commit = s.fake.commits.get(revision)!; commit.sha = 'f'.repeat(40);
    await assert.rejects(s.remote.readSeed(revision), /commit identity/); commit.sha = revision;
    const factEntry = s.fake.trees.get(s.fake.baseTree)!.find(entry => entry.path === 'data/seed/facts.json')!;
    s.fake.blobs.set(factEntry.sha, s.f.seedFactsText + ' ');
    await assert.rejects(s.remote.readSeed(revision), /bytes do not match/);
    assert.equal(s.fake.requests.filter(call => call.method !== 'GET').length, 0);
  } finally { s.cleanup(); }
});
