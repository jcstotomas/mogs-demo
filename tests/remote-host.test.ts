import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VercelDeploymentHost } from '../lib/deployment/vercel';
import { readRemoteSourceSnapshot } from '../lib/deployment/git-source';
import { buildRemoteFixtures } from '../lib/runs/remote-fixtures';
import { SubmissionSchema } from '../lib/runs/remote-types';
import { hashRecord, sha256 } from '../lib/hash';

const fixture = buildRemoteFixtures(), target = fixture.state.attempt.baseline.target;
const COMMIT = 'b'.repeat(40), MERGED = 'c'.repeat(40), SECRET = 'fixture-vercel-token-never-log';
type Json = Record<string, any>;
function detail(sha = COMMIT, overrides: Json = {}): Json {
  return { id: 'dpl_Fixture123', url: 'mogs-fixture-deployment.vercel.app', projectId: target.vercelProjectId, ownerId: target.vercelTeamId, readyState: 'READY', target: 'production', meta: { githubCommitSha: sha, githubCommitOrg: 'jcstotomas', githubCommitRepo: 'mogs-demo' }, ...overrides };
}
function host(routes: (url: URL) => Json | Response | Promise<Json | Response>) {
  const requests: URL[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal(url.origin, 'https://api.vercel.com'); assert.equal(url.searchParams.get('teamId'), target.vercelTeamId);
    assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store'); assert.ok(init?.signal);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer ' + SECRET);
    const result = await routes(url);
    return result instanceof Response ? result : new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  };
  return { value: new VercelDeploymentHost(target, { token: async () => SECRET, fetch }), requests };
}
function submission() {
  return SubmissionSchema.parse({ id: 'host-submission', launchAttemptId: fixture.state.attempt.id, runId: fixture.state.run.id, candidate: { id: 'host-candidate', launchAttemptId: fixture.state.attempt.id, runId: fixture.state.run.id, purpose: 'correction', baselineHash: fixture.state.attempt.baselineHash, baseSha: fixture.state.attempt.baseline.baseSha, desiredFactsHash: fixture.state.attempt.desiredFactsHash, approvals: fixture.state.approvals, files: [{ path: 'data/facts.json', beforeHash: fixture.state.attempt.baseline.factsFileHash, afterHash: '0'.repeat(64) }], bundleHash: '0'.repeat(64), treeHash: '0'.repeat(64), branch: 'codex/launch-' + fixture.state.attempt.id, candidateSha: COMMIT, commitMessage: 'Fixture only\nLaunch-Attempt: ' + fixture.state.attempt.id, createdAt: fixture.state.run.confirmedAt }, revision: 0, status: 'submitted', journal: 'pr_opened', operationId: 'host-operation', requestFingerprint: '0'.repeat(64), prNumber: 1, prUrl: 'https://github.com/jcstotomas/mogs-demo/pull/1', observedHeadSha: COMMIT, failure: null, createdAt: fixture.state.run.confirmedAt, updatedAt: fixture.state.run.confirmedAt });
}

test('Vercel production resolves configured alias identity then returns canonical production origin', async () => {
  const { value, requests } = host(url => {
    assert.equal(url.pathname, '/v13/deployments/mogs-fixture.invalid');
    return detail(MERGED);
  });
  const resolved = await value.resolve({ environment: 'production', submission: submission(), mergedSha: MERGED });
  assert.deepEqual(resolved, { deploymentId: 'dpl_Fixture123', url: target.productionOrigin, deployedSha: MERGED, readiness: 'ready' });
  assert.equal(requests.length, 1);
  await assert.rejects(value.resolve({ environment: 'production', submission: submission(), mergedSha: null }), /observed PR merge commit/);
});

test('Vercel rejects wrong project, owner, repository, Git commit, deployment identity and environment', async () => {
  const variants = [
    { projectId: 'another-project' }, { ownerId: 'another-team' }, { id: 'not-a-deployment' },
    { url: 'mogs-fixture.vercel.app/console' }, { url: 'evil.invalid' }, { target: null },
    { meta: { githubCommitSha: 'd'.repeat(40), githubCommitOrg: 'jcstotomas', githubCommitRepo: 'mogs-demo' } },
    { meta: { githubCommitSha: MERGED, githubCommitOrg: 'somebody-else', githubCommitRepo: 'mogs-demo' } },
    { meta: { githubCommitSha: 'not-a-sha', githubCommitOrg: 'jcstotomas', githubCommitRepo: 'mogs-demo' } },
  ];
  for (const overrides of variants) await assert.rejects(host(() => detail(MERGED, overrides)).value.production(MERGED), /deployment identity|Git repository/);
  await assert.rejects(host(() => detail(MERGED)).value.byId('dpl_Fixture123', MERGED, 'preview'), /environment/);
});

test('Vercel preview uses candidate SHA and excludes production and other heads', async () => {
  const { value, requests } = host(url => {
    if (url.pathname === '/v6/deployments') {
      assert.equal(url.searchParams.get('projectId'), target.vercelProjectId);
      assert.equal(url.searchParams.get('meta-githubCommitSha'), COMMIT);
      return { deployments: [{ uid: 'dpl_Production', target: 'production' }, { uid: 'dpl_Old' }, { uid: 'dpl_Preview' }] };
    }
    if (url.pathname === '/v13/deployments/dpl_Old') return detail('d'.repeat(40), { target: null });
    if (url.pathname === '/v13/deployments/dpl_Preview') return detail(COMMIT, { id: 'dpl_Preview', target: null, readyState: 'BUILDING' });
    throw new Error('Unexpected host request.');
  });
  const resolved = await value.resolve({ environment: 'preview', submission: submission(), mergedSha: null });
  assert.deepEqual(resolved, { deploymentId: 'dpl_Preview', url: 'https://mogs-fixture-deployment.vercel.app', deployedSha: COMMIT, readiness: 'pending' });
  assert.equal(requests.length, 3);
  assert.ok(requests.every(url => !url.pathname.endsWith('dpl_Production')));
  await assert.rejects(host(() => ({ deployments: [] })).value.resolve({ environment: 'preview', submission: submission(), mergedSha: null }), /No preview deployment/);
});

test('Vercel preserves explicit failed/pending states and redacts transport/HTTP/JSON response failures', async () => {
  for (const [readyState, readiness] of [['ERROR', 'failed'], ['CANCELED', 'failed'], ['QUEUED', 'pending']] as const) {
    assert.equal((await host(() => detail(MERGED, { readyState })).value.production(MERGED)).readiness, readiness);
  }
  const transports = [
    () => { throw new Error('request contained ' + SECRET); },
    () => new Response(SECRET, { status: 403 }),
    () => new Response('invalid-json-' + SECRET),
    () => new Response('x'.repeat(4_000_001)),
  ];
  for (const transport of transports) {
    await assert.rejects(host(transport).value.production(MERGED), error => error instanceof Error && !error.message.includes(SECRET) && /Vercel/.test(error.message));
  }
});

function sourceRepository() {
  const root = mkdtempSync(path.join(tmpdir(), 'mogs-pinned-source-'));
  const git = (args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--quiet']); git(['config', 'user.name', 'MOGS source fixture']); git(['config', 'user.email', 'fixture@mogs.invalid']); git(['config', 'commit.gpgsign', 'false']);
  git(['remote', 'add', 'origin', 'https://github.com/jcstotomas/mogs-demo.git']);
  const seedManifestText = readFileSync('fixtures/remote/miniature/seed.json', 'utf8'), seedFactsText = readFileSync('data/seed/facts.json', 'utf8');
  const seed = JSON.parse(seedManifestText);
  for (const [file, { source }] of Object.entries(seed.sources) as Array<[string, { source: string }]>) {
    const destination = path.join(root, 'content', file); mkdirSync(path.dirname(destination), { recursive: true }); writeFileSync(destination, source);
  }
  mkdirSync(path.join(root, 'data'), { recursive: true }); writeFileSync(path.join(root, 'content/seed.json'), seedManifestText); writeFileSync(path.join(root, 'data/facts.json'), seedFactsText);
  git(['add', 'content', 'data/facts.json']); git(['commit', '--quiet', '-m', 'Pinned pristine source fixture']);
  return { root, git, sha: git(['rev-parse', 'HEAD']), seedManifestText, seedFactsText, seed };
}

test('Git source snapshot reads exact pinned commit bytes despite mutable working content', async () => {
  const f = sourceRepository();
  try {
    writeFileSync(path.join(f.root, 'content/site/launch.md'), 'working-copy-is-not-a-source');
    writeFileSync(path.join(f.root, 'data/facts.json'), 'working-copy-is-not-facts');
    const snapshot = await readRemoteSourceSnapshot(target.repository, f.sha, { root: f.root, fetch: false });
    assert.equal(snapshot.sources['site/launch.md'], f.seed.sources['site/launch.md'].source);
    assert.equal(snapshot.factText, f.seedFactsText); assert.equal(snapshot.seedManifestText, f.seedManifestText);
    assert.equal(snapshot.artifact.sourceCommit, f.sha); assert.equal(snapshot.artifact.factsFileHash, sha256(f.seedFactsText));
    assert.equal(snapshot.artifact.inventoryHash, hashRecord(snapshot.artifact.assets));
    assert.equal(snapshot.artifact.routes.length, 4); assert.equal(snapshot.publishedFacts.plans.starter.monthlyCents, 3000);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('Git source snapshot rejects an unconfigured origin, unavailable revision and malformed exact source', async () => {
  const f = sourceRepository();
  try {
    await assert.rejects(readRemoteSourceSnapshot(target.repository, 'z'.repeat(40), { root: f.root, fetch: false }), /Exact configured/);
    await assert.rejects(readRemoteSourceSnapshot(target.repository, '0'.repeat(40), { root: f.root, fetch: false }), /unavailable or incomplete/);
    f.git(['remote', 'set-url', 'origin', 'https://github.com/another/repository.git']);
    await assert.rejects(readRemoteSourceSnapshot(target.repository, f.sha, { root: f.root, fetch: false }), /origin does not match/);
    f.git(['remote', 'set-url', 'origin', 'https://github.com/jcstotomas/mogs-demo.git']);
    writeFileSync(path.join(f.root, 'content/site/launch.md'), 'Malformed source with no block identities.');
    f.git(['add', 'content/site/launch.md']); f.git(['commit', '--quiet', '-m', 'Malformed source fixture']);
    await assert.rejects(readRemoteSourceSnapshot(target.repository, f.git(['rev-parse', 'HEAD']), { root: f.root, fetch: false }), /Missing YAML frontmatter/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('Git source snapshot rejects invalid UTF-8 bytes before source hashes can normalize them', async () => {
  const f = sourceRepository();
  try {
    const source: string = f.seed.sources['site/launch.md'].source, offset = source.indexOf('MOGS');
    const bytes = Buffer.concat([Buffer.from(source.slice(0, offset)), Buffer.from([0xff]), Buffer.from(source.slice(offset + 1))]);
    writeFileSync(path.join(f.root, 'content/site/launch.md'), bytes);
    f.git(['add', 'content/site/launch.md']); f.git(['commit', '--quiet', '-m', 'Invalid UTF-8 fixture']);
    await assert.rejects(readRemoteSourceSnapshot(target.repository, f.git(['rev-parse', 'HEAD']), { root: f.root, fetch: false }), /unavailable or incomplete/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
