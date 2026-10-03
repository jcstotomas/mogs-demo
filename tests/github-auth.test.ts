import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitHubAppTokenProvider, type GitHubAppTokenOptions } from '../lib/submission/github-auth';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const START = Date.parse('2026-10-03T20:00:00.000Z');
const APP_ID = 5179329, CLIENT_ID = 'Iv23lingN6UVLfBTBqhH', INSTALL_ID = 19019;
const PERMISSIONS = { contents: 'write', pull_requests: 'write', statuses: 'write', administration: 'read' };
type Json = Record<string, unknown>;
const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function fixture(options: Partial<GitHubAppTokenOptions> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'mogs-app-auth-')), privateKeyPath = path.join(root, 'fixture.pem');
  writeFileSync(privateKeyPath, pem, { mode: 0o600 });
  let now = START, mintCount = 0;
  const requests: { method: string; pathname: string; jwt: string; body: Json | undefined }[] = [];
  const app: Json = { id: APP_ID, slug: 'mogs-status-fixture', client_id: CLIENT_ID };
  const installation: Json = { id: INSTALL_ID, app_id: APP_ID, app_slug: 'mogs-status-fixture', account: { id: 991, login: 'jcstotomas', type: 'User' }, target_id: 991, target_type: 'User', suspended_at: null, suspended_by: null, permissions: { ...PERMISSIONS, administration: 'write', metadata: 'read' } };
  let transformToken: (value: Json) => Json = value => value;
  let transport: ((pathname: string) => Response | Promise<Response> | undefined) | undefined;
  let tokenGate: Promise<void> | undefined;
  let tokenStarted: (() => void) | undefined;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? 'GET';
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(init?.redirect, 'manual'); assert.equal(init?.cache, 'no-store'); assert.ok(init?.signal);
    const jwt = new Headers(init?.headers).get('Authorization')!.slice('Bearer '.length);
    const [header, claims, signature] = jwt.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
    assert.ok(verify('RSA-SHA256', Buffer.from(header + '.' + claims), keys.publicKey, Buffer.from(signature, 'base64url')));
    requests.push({ method, pathname: url.pathname, jwt, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const custom = await transport?.(url.pathname); if (custom) return custom;
    if (url.pathname === '/app' && method === 'GET') return jsonResponse(app);
    if (url.pathname === '/repos/jcstotomas/mogs-demo/installation' && method === 'GET') return jsonResponse(installation);
    if (url.pathname === '/app/installations/' + INSTALL_ID + '/access_tokens' && method === 'POST') {
      mintCount++; tokenStarted?.(); await tokenGate;
      return jsonResponse(transformToken({ token: 'ghs_fixture_' + mintCount, expires_at: new Date(now + 3_600_000).toISOString(), permissions: { ...PERMISSIONS, administration: options.administration ?? 'read', metadata: 'read' }, repository_selection: 'selected', repositories: [{ id: 998, name: 'mogs-demo', full_name: 'jcstotomas/mogs-demo', owner: { login: 'jcstotomas' } }] }), 201);
    }
    throw new Error('Unexpected test request.');
  };
  const config: GitHubAppTokenOptions = { appId: APP_ID, clientId: CLIENT_ID, appSlug: 'mogs-status-fixture', repository: 'jcstotomas/mogs-demo', installationId: INSTALL_ID, privateKeyPath, fetch: fakeFetch, clock: () => new Date(now), ...options };
  const provider = new GitHubAppTokenProvider(config);
  return { provider, config, requests, app, installation, root, privateKeyPath, get mintCount() { return mintCount; }, advance(ms: number) { now += ms; }, transform(fn: typeof transformToken) { transformToken = fn; }, transport(fn: NonNullable<typeof transport>) { transport = fn; }, pauseMint() { let release!: () => void; tokenGate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { tokenStarted = resolve; }); return { release, started }; }, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}

test('signs client-ID RS256 JWT and mints a token restricted to the configured repository and minimum permissions', async () => {
  const f = fixture();
  try {
    assert.equal(await f.provider.getToken(), 'ghs_fixture_1');
    assert.deepEqual(f.requests.map(r => [r.method, r.pathname]), [['GET', '/app'], ['GET', '/repos/jcstotomas/mogs-demo/installation'], ['POST', '/app/installations/19019/access_tokens']]);
    const payload = JSON.parse(Buffer.from(f.requests[0].jwt.split('.')[1], 'base64url').toString());
    assert.deepEqual(payload, { iat: START / 1000 - 60, exp: START / 1000 + 540, iss: CLIENT_ID });
    assert.deepEqual(f.requests[2].body, { repositories: ['mogs-demo'], permissions: PERMISSIONS });
    assert.deepEqual(readdirSync(f.root), ['fixture.pem']);
    assert.equal(JSON.stringify(f.provider), '{}');
  } finally { f.cleanup(); }
});

test('uses numeric App ID when Client ID is omitted and supports authenticated private App metadata', async () => {
  const f = fixture({ clientId: undefined, installationId: undefined });
  try {
    assert.deepEqual(await f.provider.getAppMetadata(), { id: APP_ID, slug: 'mogs-status-fixture', clientId: CLIENT_ID });
    assert.equal(f.mintCount, 0);
    assert.equal(JSON.parse(Buffer.from(f.requests[0].jwt.split('.')[1], 'base64url').toString()).iss, String(APP_ID));
    assert.equal(await f.provider.getToken(), 'ghs_fixture_1');
  } finally { f.cleanup(); }
});

test('serializes concurrent refresh, caches until the expiry margin, and ignores stale-token invalidation', async () => {
  const f = fixture();
  try {
    const first = await Promise.all(Array.from({ length: 20 }, () => f.provider.getToken()));
    assert.equal(new Set(first).size, 1); assert.equal(f.mintCount, 1);
    f.advance(3_539_000); assert.equal(await f.provider.getToken(), first[0]); assert.equal(f.mintCount, 1);
    f.advance(1_000);
    const refreshed = await Promise.all(Array.from({ length: 20 }, () => f.provider.getToken()));
    assert.equal(new Set(refreshed).size, 1); assert.equal(refreshed[0], 'ghs_fixture_2'); assert.equal(f.mintCount, 2);
    f.provider.invalidate(first[0]); assert.equal(await f.provider.getToken(), refreshed[0]); assert.equal(f.mintCount, 2);
    f.provider.invalidate(refreshed[0]); assert.equal(await f.provider.getToken(), 'ghs_fixture_3');
    f.provider.invalidate(); assert.equal(await f.provider.getToken(), 'ghs_fixture_4');
  } finally { f.cleanup(); }
});

test('explicit invalidation during mint prevents returning or caching the invalidated result', async () => {
  const f = fixture();
  try {
    const gate = f.pauseMint(), pending = f.provider.getToken();
    await gate.started; f.provider.invalidate(); gate.release();
    await assert.rejects(pending, /invalidated during refresh/);
    assert.equal(await f.provider.getToken(), 'ghs_fixture_2');
  } finally { f.cleanup(); }
});

test('invalidation of an old token does not cancel an already running refresh', async () => {
  const f = fixture();
  try {
    const old = await f.provider.getToken(); f.advance(3_540_000);
    const gate = f.pauseMint(), pending = f.provider.getToken();
    await gate.started; f.provider.invalidate(old); gate.release();
    assert.equal(await pending, 'ghs_fixture_2');
    assert.equal(await f.provider.getToken(), 'ghs_fixture_2'); assert.equal(f.mintCount, 2);
  } finally { f.cleanup(); }
});

test('safe token metadata discovers the installation and returns fresh nonsecret copies after refresh', async () => {
  const f = fixture({ installationId: undefined });
  try {
    const metadata = await f.provider.getTokenMetadata();
    assert.deepEqual(metadata, { installationId: INSTALL_ID, repositoryId: 998, expiresAt: new Date(START + 3_600_000).toISOString(), permissions: { ...PERMISSIONS, metadata: 'read' } });
    assert.equal('token' in metadata, false); assert.equal(JSON.stringify(metadata).includes('ghs_fixture'), false);
    (metadata.permissions as Record<string, string>).contents = 'read'; metadata.installationId = 1;
    const again = await f.provider.getTokenMetadata();
    assert.equal(again.permissions.contents, 'write'); assert.equal(again.installationId, INSTALL_ID); assert.equal(f.mintCount, 1);
    f.advance(3_540_000);
    assert.equal((await f.provider.getTokenMetadata()).expiresAt, new Date(START + 3_540_000 + 3_600_000).toISOString()); assert.equal(f.mintCount, 2);
  } finally { f.cleanup(); }
});

test('rejects mismatched App, installation, account or suspended identities before minting', async () => {
  const cases: ((f: ReturnType<typeof fixture>) => void)[] = [
    f => { f.app.id = APP_ID + 1; }, f => { f.app.slug = 'different-app'; }, f => { f.app.client_id = 'different-client'; },
    f => { f.installation.id = INSTALL_ID + 1; }, f => { f.installation.app_id = APP_ID + 1; }, f => { f.installation.app_slug = 'different-app'; },
    f => { (f.installation.account as Json).login = 'another-owner'; }, f => { f.installation.target_id = 992; }, f => { f.installation.target_type = 'Organization'; },
    f => { f.installation.suspended_at = new Date(START).toISOString(); }, f => { f.installation.suspended_by = { login: 'admin' }; },
    f => { (f.installation.permissions as Json).statuses = 'read'; },
  ];
  for (const change of cases) {
    const f = fixture();
    try { change(f); await assert.rejects(f.provider.getToken(), /identity|permissions/); assert.equal(f.mintCount, 0); }
    finally { f.cleanup(); }
  }
});

test('rejects missing, excessive or wrong token scope and invalid expiration without caching', async () => {
  const cases: ((value: Json) => void)[] = [
    value => { delete (value.permissions as Json).statuses; }, value => { (value.permissions as Json).contents = 'read'; },
    value => { (value.permissions as Json).administration = 'write'; }, value => { (value.permissions as Json).workflows = 'write'; },
    value => { value.repository_selection = 'all'; }, value => { value.repositories = []; },
    value => { (value.repositories as Json[]).push({ id: 999, full_name: 'jcstotomas/another' }); },
    value => { (value.repositories as Json[])[0].full_name = 'another/mogs-demo'; },
    value => { ((value.repositories as Json[])[0].owner as Json).login = 'another'; },
    value => { value.expires_at = 'invalid'; }, value => { value.expires_at = new Date(START).toISOString(); },
    value => { value.expires_at = new Date(START + 30_000).toISOString(); }, value => { value.expires_at = new Date(START + 7_200_000).toISOString(); },
    value => { value.token = 'secret\nheader'; },
  ];
  for (const change of cases) {
    const f = fixture();
    try {
      f.transform(value => { change(value); return value; });
      await assert.rejects(f.provider.getToken(), /scope|identity|expiry/);
      f.transform(value => value); assert.equal(await f.provider.getToken(), 'ghs_fixture_2');
    } finally { f.cleanup(); }
  }
});

test('administration write requires the explicit setup option and matching installation permission', async () => {
  const f = fixture({ administration: 'write' });
  try {
    await f.provider.getToken();
    assert.equal((f.requests.at(-1)!.body!.permissions as Json).administration, 'write');
    f.provider.invalidate(); (f.installation.permissions as Json).administration = 'read';
    await assert.rejects(f.provider.getToken(), /lacks required permissions/); assert.equal(f.mintCount, 1);
  } finally { f.cleanup(); }
});

test('HTTP, network, JSON and size failures are bounded and never expose response credentials or key paths', async () => {
  const secret = 'fixture-secret-do-not-echo';
  for (const response of [() => jsonResponse({ message: secret }, 401), () => new Response(secret, { status: 302, headers: { Location: 'https://untrusted.invalid/' } }), () => new Response(secret), () => new Response('x'.repeat(262_145)), () => { throw new Error(secret); }]) {
    const f = fixture();
    try {
      f.transport(() => response());
      await assert.rejects(f.provider.getToken(), error => {
        assert.ok(error instanceof Error); assert.ok(error.message.length < 180);
        assert.ok(!error.message.includes(secret)); assert.ok(!error.message.includes(f.privateKeyPath)); assert.ok(!error.message.includes('BEGIN PRIVATE KEY'));
        return true;
      });
      assert.equal(f.requests.length, 1); assert.equal(f.mintCount, 0);
    } finally { f.cleanup(); }
  }
});

test('key failures remain local and sanitized and a corrected supplied key can retry', async () => {
  const f = fixture();
  try {
    writeFileSync(f.privateKeyPath, 'not-a-key');
    await assert.rejects(f.provider.getToken(), error => error instanceof Error && error.message === 'GitHub App authentication could not be signed.');
    assert.equal(f.requests.length, 0);
    writeFileSync(f.privateKeyPath, pem);
    assert.equal(await f.provider.getToken(), 'ghs_fixture_1');
    const missing = new GitHubAppTokenProvider({ ...f.config, privateKeyPath: path.join(f.root, 'missing-secret-key.pem') });
    await assert.rejects(missing.getToken(), /could not be signed/);
  } finally { f.cleanup(); }
});
