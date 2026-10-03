import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRemoteFixtures } from '../lib/runs/remote-fixtures';
import { GitHubHttpError, GitHubRemote } from '../lib/submission/github';
import { githubAppConfig, localGitHubAppTokenProvider } from '../lib/submission/github-config';

const target = () => buildRemoteFixtures().state.attempt.baseline.target;
const metadata = { id: target().statusProducerAppId, slug: 'mogs-status', clientId: 'fixture-client' };

test('private App validation uses authenticated App metadata', async () => {
  const remote = new GitHubRemote({ target: target(), appSlug: metadata.slug, readLocal: () => null,
    tokenProvider: { getToken: async () => 'unused', invalidate: () => {}, getAppMetadata: async () => metadata },
    fetch: async () => { throw new Error('Public slug lookup must not be requested.'); } });
  assert.equal(await remote.validateStatusProducer(), metadata.id);
  const wrong = new GitHubRemote({ target: target(), appSlug: metadata.slug, readLocal: () => null,
    tokenProvider: { getToken: async () => 'unused', invalidate: () => {}, getAppMetadata: async () => ({ ...metadata, id: metadata.id + 1 }) } });
  await assert.rejects(wrong.validateStatusProducer(), /do not match/);
});

test('GitHub requests refresh once on 401 and never retry a permission denial', async () => {
  let token = 'fixture-expired', requests = 0, invalidations = 0;
  const remote = new GitHubRemote({ target: target(), appSlug: metadata.slug, readLocal: () => null,
    tokenProvider: { getToken: async () => token, getAppMetadata: async () => metadata, invalidate: stale => { assert.equal(stale, token); invalidations++; token = 'fixture-fresh'; } },
    fetch: async (_input, init) => {
      requests++;
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer ' + token);
      return new Response('', { status: requests === 1 ? 401 : 403 });
    } });
  await assert.rejects(remote.readEnforcementSettings(), (error: unknown) => error instanceof GitHubHttpError && error.status === 403);
  assert.equal(requests, 2); assert.equal(invalidations, 1);
});

test('a second authentication rejection is returned after the bounded retry', async () => {
  let requests = 0, invalidations = 0;
  const remote = new GitHubRemote({ target: target(), appSlug: metadata.slug, readLocal: () => null,
    tokenProvider: { getToken: async () => 'fixture-token', getAppMetadata: async () => metadata, invalidate: () => { invalidations++; } },
    fetch: async () => { requests++; return new Response('', { status: 401 }); } });
  await assert.rejects(remote.readEnforcementSettings(), (error: unknown) => error instanceof GitHubHttpError && error.status === 401);
  assert.equal(requests, 2); assert.equal(invalidations, 1);
});

test('network errors expose no bearer token', async () => {
  const secret = 'fixture-secret';
  const remote = new GitHubRemote({ target: target(), appSlug: metadata.slug, readLocal: () => null, token: secret,
    fetch: async () => { throw new Error('Failed ' + secret); } });
  await assert.rejects(remote.validateStatusProducer(), error => error instanceof Error && !error.message.includes(secret) && /outcome may be unknown/.test(error.message));
});

test('App configuration rejects malformed IDs and target mismatches before authentication', () => {
  const environment = { MOGS_STATUS_PRODUCER_APP_ID: '5179329', MOGS_STATUS_PRODUCER_APP_SLUG: 'memberofgtmstaff', MOGS_GITHUB_REPOSITORY: 'jcstotomas/mogs-demo', MOGS_GITHUB_PRIVATE_KEY_PATH: '/fixture-only.pem', MOGS_GITHUB_APP_CLIENT_ID: 'Iv23lingN6UVLfBTBqhH' };
  assert.equal(githubAppConfig(environment).clientId, environment.MOGS_GITHUB_APP_CLIENT_ID);
  assert.throws(() => githubAppConfig({ ...environment, MOGS_GITHUB_INSTALLATION_ID: 'unknown' }), /positive integer/);
  assert.throws(() => localGitHubAppTokenProvider({ repository: 'jcstotomas/other', appId: 5179329, appSlug: 'memberofgtmstaff' }, environment), /do not match/);
});
