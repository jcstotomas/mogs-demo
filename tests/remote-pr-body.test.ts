import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRemoteFixtures, fixtureCombinedJudge, seedRemoteFixtureDatabase, REMOTE_FIXTURE_TIME } from '../lib/runs/remote-fixtures';
import { RemoteDatabase, RemoteStateError } from '../lib/runs/remote-db';
import { assembleCandidate } from '../lib/submission/candidate';
import { buildPullRequestDescription } from '../lib/submission/pr-body';
import { GitHubRemote, operationMarker } from '../lib/submission/github';
import { DeploymentObservationSchema, SubmissionSchema } from '../lib/runs/remote-types';
import { hashRecord } from '../lib/hash';
import { createPublicArtifact } from '../lib/deployment/public-artifact';
import { extractRenderedAsset } from '../lib/assets/source';

async function setup() {
  const f = buildRemoteFixtures(), bundle = await assembleCandidate(f.state, f.baseSources, f.state.attempt.baseline, fixtureCombinedJudge(f), REMOTE_FIXTURE_TIME);
  const submission = SubmissionSchema.parse({ id: 'fixture-description-submission', launchAttemptId: f.state.attempt.id, runId: f.state.run.id, candidate: { ...bundle.candidate, candidateSha: 'b'.repeat(40) }, revision: 0, status: 'submitted', journal: 'pr_opened', operationId: 'fixture-description-operation', requestFingerprint: hashRecord(bundle.candidate), prNumber: 17, prUrl: 'https://github.com/jcstotomas/mogs-demo/pull/17', observedHeadSha: 'b'.repeat(40), failure: null, createdAt: REMOTE_FIXTURE_TIME, updatedAt: REMOTE_FIXTURE_TIME });
  const db = new RemoteDatabase(':memory:', { clock: () => new Date(REMOTE_FIXTURE_TIME) }); seedRemoteFixtureDatabase(db, f); db.putSubmission(submission); db.putCandidateImages(submission.runId, bundle.images, bundle.checks);
  const requests: { method: string; path: string; apiVersion: string | null; body?: Record<string, unknown> }[] = [];
  const pr: Record<string, unknown> = { number: submission.prNumber, html_url: submission.prUrl, body: 'Original brief description\n' + operationMarker(submission), head: { ref: submission.candidate.branch, sha: submission.candidate.candidateSha, repo: { full_name: f.state.attempt.baseline.target.repository } }, base: { ref: 'main', sha: submission.candidate.baseSha, repo: { full_name: f.state.attempt.baseline.target.repository } }, state: 'open', auto_merge: null, merged_at: null, merge_commit_sha: null };
  let loseResponseOnce = false, omitMergeShaOnce = false;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    assert.equal(url.origin, 'https://api.github.com');
    const apiVersion = new Headers(init?.headers).get('X-GitHub-Api-Version');
    requests.push({ method, path: url.pathname, apiVersion, body });
    if (method === 'GET' && url.pathname.endsWith('/pulls/17')) {
      const representation = { ...pr }; if (apiVersion === '2026-03-10' && representation.merged_at) delete representation.merge_commit_sha;
      return new Response(JSON.stringify(representation));
    }
    if (method === 'PATCH' && url.pathname.endsWith('/pulls/17')) {
      assert.deepEqual(Object.keys(body ?? {}), ['body']); pr.body = body!.body;
      if (loseResponseOnce) { loseResponseOnce = false; throw new Error('Synthetic response loss after metadata update.'); }
      if (omitMergeShaOnce) { omitMergeShaOnce = false; const { merge_commit_sha: _sha, ...partial } = pr; return new Response(JSON.stringify(partial)); }
      return new Response(JSON.stringify(pr));
    }
    throw new Error('Unexpected fixture request: ' + method + ' ' + url.pathname);
  };
  const options = { target: f.state.attempt.baseline.target, token: 'fixture-only-token', appSlug: 'mogs-status', fetch: fakeFetch, testOnlyAllowFixtureEvidence: true, readLocal: (runId: string) => {
    const stored = db.getSubmission(runId), attempt = stored && db.getAttempt(stored.launchAttemptId); return stored && attempt ? { submission: stored, attempt } : null;
  }, stateStore: () => db };
  const remote = new GitHubRemote(options);
  const preview = () => {
    const artifact = createPublicArtifact({ sourceCommit: submission.candidate.candidateSha!, mode: 'commit', seedManifestText: readFileSync('fixtures/remote/miniature/seed.json', 'utf8'), factText: bundle.images['data/facts.json'], sourceTexts: Object.fromEntries(Object.entries(f.baseSources).map(([file, source]) => [file, bundle.images['content/' + file] ?? source])) });
    const origin = 'https://mogs-description-preview-fixture.invalid', passages = artifact.routes.flatMap(route => extractRenderedAsset(route.html, origin + route.pathname).passages);
    return DeploymentObservationSchema.parse({ id: 'fixture-description-preview', launchAttemptId: submission.launchAttemptId, submissionId: submission.id, environment: 'preview', deploymentId: 'fixture-preview-description', url: origin, candidateSha: submission.candidate.candidateSha, mergedSha: null, deployedSha: submission.candidate.candidateSha, readiness: 'ready', verification: 'passed', inventoryHash: artifact.inventoryHash, factsHash: artifact.factsHash, publishedFacts: f.state.facts.find(fact => fact.phase === 'desired')!.snapshot, sourceHashes: Object.fromEntries(artifact.assets.map(asset => [asset.assetId, asset.sourceHash])), blocks: submission.candidate.approvals.flatMap(approval => approval.eligibleIds).map(id => {
      const patch = f.state.patches.find(value => value.id === id)!, passage = passages.find(value => value.id === patch.passageId)!;
      const { contractVersion: _version, launchAttemptId: _attempt, ...judgment } = f.state.judgments.find(value => value.passageId === patch.passageId)!;
      return { passageId: passage.id, url: passage.url, sourceObserved: true, observedHash: passage.blockHash, judgment: { ...judgment, label: 'consistent' }, pass: true, detail: 'Synthetic full preview proof.', checkedAt: REMOTE_FIXTURE_TIME };
    }), failures: [], observedAt: REMOTE_FIXTURE_TIME });
  };
  return { f, db, bundle, submission, remote, options, requests, pr, preview, loseResponse: () => { loseResponseOnce = true; }, omitMergeSha: () => { omitMergeShaOnce = true; }, body: () => buildPullRequestDescription(db.export(submission.runId), submission, operationMarker(submission)), close: () => db.close() };
}

test('description exposes complete grouped changes, combined checks, facts, exclusions and exact operation marker', async () => {
  const s = await setup();
  try {
    const body = s.body();
    for (const heading of ['## Summary', '## Evidence', '## Merge Danger', '**Door:** two-way', '**Blast Radius:** Content']) assert.ok(body.includes(heading));
    assert.match(body, /- Starter monthly: \$30\n\+ Starter monthly: \$40/);
    assert.match(body, /4 approved complete correction groups combine 5 checked edits/);
    assert.ok(body.includes('content/site/launch.md#starter-price'));
    assert.ok(body.includes('Starter is $30 a month.') && body.includes('Starter is $40 a month.'));
    assert.match(body, /7\/7 passing/); assert.match(body, /8\/8 passing/);
    assert.ok(body.includes('threshold') && body.includes('withheld'));
    assert.ok(body.includes('content/email/eligible.md') && body.includes(s.f.state.attempt.baseline.assets.find(asset => asset.path === 'content/email/eligible.md')!.sourceHash));
    assert.match(body, /Fixture\/test evidence/); assert.match(body, /Matching verified preview is not recorded/);
    assert.equal(body.split(operationMarker(s.submission)).length, 2);
    assert.equal(body, s.body());
  } finally { s.close(); }
});

test('only the latest complete matching verified preview supplies a preview link', async () => {
  const s = await setup();
  try {
    const preview = { ...s.preview(), deploymentId: 'dpl_Ba_fixture' }; s.db.putObservation(preview);
    assert.ok(s.body().includes(`[matching candidate preview](${preview.url}/)`));
    assert.ok(s.body().includes('deployment `dpl_Ba_fixture`'));
    assert.ok(!s.body().includes('dpl\\_Ba\\_fixture'));
    const altered = s.db.export(s.submission.runId);
    for (const change of [
      { submissionId: 'foreign-operation' }, { candidateSha: 'c'.repeat(40), deployedSha: 'c'.repeat(40) },
      { sourceHashes: {} }, { inventoryHash: 'c'.repeat(64) }, { blocks: [] },
      { url: 'https://mogs-description-preview-fixture.invalid/another-path' },
    ]) {
      altered.observations = [{ ...preview, ...change }];
      assert.ok(!buildPullRequestDescription(altered, s.submission, operationMarker(s.submission)).includes('[matching candidate preview]'));
    }
    s.db.putObservation({ ...preview, id: 'fixture-newer-failed-preview', verification: 'failed', failures: ['Synthetic later failure.'], observedAt: '2026-10-03T19:02:00.000Z' });
    assert.ok(!s.body().includes('[matching candidate preview]'));
  } finally { s.close(); }
});

test('missing or changed durable approvals, checks, facts and submission reject description claims', async () => {
  const s = await setup();
  try {
    for (const mutate of [
      (state: ReturnType<typeof s.db.export>) => { state.submission = null; },
      (state: ReturnType<typeof s.db.export>) => { state.approvals[0].checkedPatchHash = 'd'.repeat(64); },
      (state: ReturnType<typeof s.db.export>) => { state.candidateChecks = null; },
      (state: ReturnType<typeof s.db.export>) => { state.candidateChecks![s.submission.candidate.approvals[0].eligibleIds[0]][0].pass = false; },
      (state: ReturnType<typeof s.db.export>) => { state.facts[0].snapshot.plans.starter.monthlyCents = 2000; },
      (state: ReturnType<typeof s.db.export>) => { state.groups[0].membershipHash = 'd'.repeat(64); },
    ]) {
      const state = s.db.export(s.submission.runId); mutate(state);
      assert.throws(() => buildPullRequestDescription(state, s.submission, operationMarker(s.submission)));
    }
    assert.throws(() => buildPullRequestDescription(s.db.export(s.submission.runId), s.submission, '<!-- changed marker -->'));
  } finally { s.close(); }
});

test('known open and merged PR metadata updates are body-only and repeated requests are no-ops', async () => {
  for (const merged of [false, true]) {
    const s = await setup();
    try {
      s.db.putObservation(s.preview());
      if (merged) { s.pr.state = 'closed'; s.pr.merged_at = REMOTE_FIXTURE_TIME; s.pr.merge_commit_sha = 'e'.repeat(40); }
      const before = hashRecord(s.db.export(s.submission.runId));
      const first = await s.remote.updatePullRequestDescription(s.submission), second = await s.remote.updatePullRequestDescription(s.submission);
      assert.deepEqual(second, first); assert.equal(first.number, 17); assert.equal(first.mergedSha, merged ? 'e'.repeat(40) : null);
      assert.equal(s.requests.filter(request => request.method === 'PATCH').length, 1);
      assert.deepEqual(s.requests.filter(request => request.method !== 'GET').map(request => ({ path: request.path, keys: Object.keys(request.body!) })), [{ path: '/repos/jcstotomas/mogs-demo/pulls/17', keys: ['body'] }]);
      assert.equal(hashRecord(s.db.export(s.submission.runId)), before);
      assert.ok(String(s.pr.body).includes(operationMarker(s.submission)));
    } finally { s.close(); }
  }
});

test('changed head, repository and unmerged closure block metadata writes', async () => {
  for (const kind of ['head', 'repository', 'closed'] as const) {
    const s = await setup();
    try {
      if (kind === 'head') (s.pr.head as Record<string, unknown>).sha = 'c'.repeat(40);
      if (kind === 'repository') (s.pr.head as Record<string, unknown>).repo = { full_name: 'foreign/repository' };
      if (kind === 'closed') s.pr.state = 'closed';
      await assert.rejects(s.remote.updatePullRequestDescription(s.submission));
      assert.equal(s.requests.some(request => request.method !== 'GET'), false);
    } finally { s.close(); }
  }
});

test('merged PR description uses independent GET identity when PATCH omits the merge SHA', async () => {
  const s = await setup();
  try {
    s.pr.state = 'closed'; s.pr.merged_at = REMOTE_FIXTURE_TIME; s.pr.merge_commit_sha = 'e'.repeat(40); s.omitMergeSha();
    const result = await s.remote.updatePullRequestDescription(s.submission);
    assert.equal(result.mergedSha, 'e'.repeat(40)); assert.equal(result.headSha, s.submission.candidate.candidateSha);
    assert.deepEqual(s.requests.map(request => request.method), ['GET', 'PATCH', 'GET']);
    assert.deepEqual(s.requests.map(request => request.apiVersion), ['2022-11-28', '2026-03-10', '2022-11-28']);
    assert.equal((await s.remote.readPullRequest(s.submission)).mergedSha, 'e'.repeat(40));
    assert.equal(s.requests.at(-1)!.apiVersion, '2022-11-28');
    assert.equal(s.pr.body, s.body());
  } finally { s.close(); }
});

test('a merged detail without an exact merge SHA remains unknown remote state', async () => {
  const s = await setup();
  try {
    s.pr.state = 'closed'; s.pr.merged_at = REMOTE_FIXTURE_TIME; delete s.pr.merge_commit_sha;
    await assert.rejects(s.remote.readPullRequest(s.submission), error => error instanceof RemoteStateError && error.code === 'unknown_remote_state');
    assert.equal(s.requests.at(-1)!.apiVersion, '2022-11-28');
    assert.equal(s.requests.some(request => request.method !== 'GET'), false);
  } finally { s.close(); }
});

test('lost body update response retries by readback without a duplicate write', async () => {
  const s = await setup();
  try {
    s.loseResponse(); await assert.rejects(s.remote.updatePullRequestDescription(s.submission));
    await s.remote.updatePullRequestDescription(s.submission);
    assert.equal(s.requests.filter(request => request.method === 'PATCH').length, 1);
  } finally { s.close(); }
});

test('a missing durable state store blocks live description updates before network writes', async () => {
  const s = await setup();
  try {
    const { stateStore: _store, ...options } = s.options;
    const remote = new GitHubRemote({ ...options, testOnlyAllowFixtureEvidence: false });
    await assert.rejects(remote.updatePullRequestDescription(s.submission), /complete durable run evidence/);
    assert.equal(s.requests.length, 0);
  } finally { s.close(); }
});

test('restoration descriptions keep exact-seed evidence separate from correction checks and credit', async () => {
  const s = await setup();
  try {
    const state = s.db.export(s.submission.runId), seedRevision = 'e'.repeat(40);
    state.attempt.purpose = 'restoration'; state.attempt.seedRevision = seedRevision;
    state.groups = []; state.patches = []; state.approvals = []; state.judgments = []; state.candidateChecks = {};
    const submission = SubmissionSchema.parse({ ...s.submission, candidate: { ...s.submission.candidate, purpose: 'restoration', approvals: [], branch: 'codex/restore-' + state.attempt.id } });
    state.submission = submission;
    const body = buildPullRequestDescription(state, submission, operationMarker(submission));
    assert.ok(body.includes(seedRevision)); assert.match(body, /zero correction repairs/);
    assert.match(body, /no model classification, correction approval or repair metric is credited/);
    assert.ok(!body.includes('Combined checks') && !body.includes('Applicable paired source'));
  } finally { s.close(); }
});
