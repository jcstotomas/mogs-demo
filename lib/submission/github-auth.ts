import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface GitHubAppMetadata { id: number; slug: string; clientId: string | null }
export interface GitHubTokenMetadata { installationId: number; repositoryId: number; expiresAt: string; permissions: Readonly<Record<string, 'read' | 'write'>> }
export interface GitHubTokenProvider {
  getToken(): Promise<string>;
  invalidate(token?: string): void;
  getAppMetadata?(): Promise<GitHubAppMetadata>;
  getTokenMetadata?(): Promise<GitHubTokenMetadata>;
}
export interface GitHubAppTokenOptions {
  appId: number;
  clientId?: string;
  appSlug: string;
  repository: string;
  installationId?: number;
  privateKeyPath: string;
  /** Elevated administration is for explicit setup operations only. */
  administration?: 'read' | 'write';
  fetch?: typeof fetch;
  clock?: () => Date;
}

type Json = Record<string, unknown>;
type CachedToken = { token: string; expiresAt: number; metadata: GitHubTokenMetadata };
const EXPIRY_SKEW_MS = 60_000;
const MAX_JSON_BYTES = 262_144;
const positiveId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const record = (value: unknown): Json => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GitHubAppAuthError('Invalid authentication response.');
  return value as Json;
};
const sameName = (actual: unknown, expected: string) => typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase();

/** Errors deliberately omit response bodies, key paths, JWTs and installation tokens. */
export class GitHubAppAuthError extends Error {
  constructor(message: string) { super(message); this.name = 'GitHubAppAuthError'; }
}

/** Local-only credential holder. No credentials or token responses are persisted. */
export class GitHubAppTokenProvider implements GitHubTokenProvider {
  readonly #options: GitHubAppTokenOptions;
  readonly #fetch: typeof fetch;
  readonly #clock: () => Date;
  readonly #owner: string;
  readonly #repositoryName: string;
  readonly #permissions: Record<string, 'read' | 'write'>;
  #key: Promise<KeyObject> | undefined;
  #cached: CachedToken | undefined;
  #inFlight: Promise<string> | undefined;
  #generation = 0;

  constructor(options: GitHubAppTokenOptions) {
    if (!positiveId(options.appId) || (options.installationId !== undefined && !positiveId(options.installationId)) || !/^[a-z0-9][a-z0-9-]*$/.test(options.appSlug) || !/^[\w.-]+\/[\w.-]+$/.test(options.repository) || !options.privateKeyPath || options.privateKeyPath.includes('\0') || (options.clientId !== undefined && !/^[A-Za-z0-9_.-]+$/.test(options.clientId)) || (options.administration !== undefined && !['read', 'write'].includes(options.administration))) throw new GitHubAppAuthError('Invalid GitHub App authentication configuration.');
    this.#options = { ...options };
    this.#fetch = options.fetch ?? fetch;
    this.#clock = options.clock ?? (() => new Date());
    [this.#owner, this.#repositoryName] = options.repository.split('/');
    this.#permissions = { contents: 'write', pull_requests: 'write', statuses: 'write', administration: options.administration ?? 'read' };
  }

  async getToken(): Promise<string> {
    if (this.#cached && this.#cached.expiresAt - EXPIRY_SKEW_MS > this.now()) return this.#cached.token;
    if (this.#inFlight) return this.#inFlight;
    const generation = this.#generation;
    const pending = this.mint().then(value => {
      if (generation !== this.#generation) throw new GitHubAppAuthError('Authentication was invalidated during refresh; retry the operation.');
      this.#cached = value;
      return value.token;
    }).finally(() => { if (this.#inFlight === pending) this.#inFlight = undefined; });
    this.#inFlight = pending;
    return pending;
  }

  invalidate(token?: string): void {
    // A delayed 401 for an older token must not discard an already refreshed token.
    if (token !== undefined && token !== this.#cached?.token) return;
    this.#cached = undefined;
    // A known old token does not invalidate a newer mint already in flight.
    if (token === undefined) this.#generation++;
  }

  async getAppMetadata(): Promise<GitHubAppMetadata> {
    return this.app(await this.jwt());
  }

  async getTokenMetadata(): Promise<GitHubTokenMetadata> {
    const token = await this.getToken();
    if (!this.#cached || this.#cached.token !== token) throw new GitHubAppAuthError('Authentication metadata was invalidated; retry the operation.');
    return { ...this.#cached.metadata, permissions: { ...this.#cached.metadata.permissions } };
  }

  private now(): number {
    const now = this.#clock().getTime();
    if (!Number.isFinite(now)) throw new GitHubAppAuthError('Invalid authentication clock.');
    return now;
  }

  private async jwt(): Promise<string> {
    try {
      if (!this.#key) {
        this.#key = readFile(this.#options.privateKeyPath).then(pem => {
          if (pem.byteLength > 65_536) throw new Error('Key size');
          const key = createPrivateKey(pem);
          if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error('Key type');
          return key;
        }).catch(() => { this.#key = undefined; throw new GitHubAppAuthError('GitHub App private key could not be loaded.'); });
      }
      const key = await this.#key, now = Math.floor(this.now() / 1000);
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({ iat: now - 60, exp: now + 540, iss: this.#options.clientId ?? String(this.#options.appId) });
      return unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url');
    } catch { throw new GitHubAppAuthError('GitHub App authentication could not be signed.'); }
  }

  private async api(method: 'GET' | 'POST', route: string, jwt: string, body?: unknown): Promise<Json> {
    try {
      const response = await this.#fetch('https://api.github.com' + route, { method, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + jwt, 'X-GitHub-Api-Version': '2026-03-10', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) {
        await response.body?.cancel();
        throw new GitHubAppAuthError('GitHub App authentication request failed (HTTP ' + response.status + ').');
      }
      if (!response.body) throw new GitHubAppAuthError('GitHub App authentication response was empty.');
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_JSON_BYTES) { await reader.cancel(); throw new GitHubAppAuthError('GitHub App authentication response exceeded its size limit.'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      return record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
    } catch (error) {
      if (error instanceof GitHubAppAuthError) throw error;
      throw new GitHubAppAuthError('GitHub App authentication request could not be completed.');
    }
  }

  private async app(jwt: string): Promise<GitHubAppMetadata> {
    const app = await this.api('GET', '/app', jwt);
    if (app.id !== this.#options.appId || app.slug !== this.#options.appSlug || (this.#options.clientId !== undefined && app.client_id !== this.#options.clientId)) throw new GitHubAppAuthError('Authenticated GitHub App identity does not match configuration.');
    return { id: this.#options.appId, slug: this.#options.appSlug, clientId: typeof app.client_id === 'string' ? app.client_id : null };
  }

  private async mint(): Promise<CachedToken> {
    const jwt = await this.jwt();
    await this.app(jwt);
    const installation = await this.api('GET', '/repos/' + [this.#owner, this.#repositoryName].map(encodeURIComponent).join('/') + '/installation', jwt);
    const account = record(installation.account);
    if (!positiveId(installation.id) || installation.app_id !== this.#options.appId || installation.app_slug !== this.#options.appSlug || (this.#options.installationId !== undefined && installation.id !== this.#options.installationId) || !positiveId(account.id) || !sameName(account.login, this.#owner) || !['User', 'Organization'].includes(String(account.type)) || installation.target_id !== account.id || installation.target_type !== account.type || installation.suspended_at !== null || installation.suspended_by !== null) throw new GitHubAppAuthError('GitHub App installation identity is mismatched or suspended.');
    const available = record(installation.permissions);
    if (Object.entries(this.#permissions).some(([name, access]) => available[name] !== access && !(access === 'read' && available[name] === 'write'))) throw new GitHubAppAuthError('GitHub App installation lacks required permissions.');
    const response = await this.api('POST', '/app/installations/' + installation.id + '/access_tokens', jwt, { repositories: [this.#repositoryName], permissions: this.#permissions });
    const permissions = record(response.permissions), repositories = response.repositories;
    if (Object.entries(this.#permissions).some(([name, access]) => permissions[name] !== access) || Object.entries(permissions).some(([name, access]) => !(name in this.#permissions) && !(name === 'metadata' && access === 'read')) || response.repository_selection !== 'selected' || !Array.isArray(repositories) || repositories.length !== 1) throw new GitHubAppAuthError('Installation token scope differs from the requested repository and permissions.');
    const repository = record(repositories[0]);
    if (!positiveId(repository.id) || !sameName(repository.full_name, this.#options.repository) || !sameName(repository.name, this.#repositoryName) || !sameName(record(repository.owner).login, this.#owner)) throw new GitHubAppAuthError('Installation token repository identity does not match configuration.');
    const expiresAt = typeof response.expires_at === 'string' ? Date.parse(response.expires_at) : NaN, now = this.now();
    if (!Number.isFinite(expiresAt) || expiresAt <= now + EXPIRY_SKEW_MS || expiresAt > now + 3_660_000 || typeof response.token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(response.token)) throw new GitHubAppAuthError('Installation token expiry or credential is invalid.');
    return { token: response.token, expiresAt, metadata: { installationId: installation.id, repositoryId: repository.id, expiresAt: new Date(expiresAt).toISOString(), permissions: { ...permissions } as Record<string, 'read' | 'write'> } };
  }
}
