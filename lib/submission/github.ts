import { createHash } from 'node:crypto';
import { z } from 'zod';
import { hashRecord, sha256 } from '../hash';
import { RemoteStateError, type RemoteDatabase } from '../runs/remote-db';
import { RequiredContextSchema, ShaSchema, StatusEvidenceSchema, type Baseline, type Candidate, type DeploymentObservation, type LaunchAttempt, type Submission } from '../runs/remote-types';
import { assertStatusAllowed, authorizeStatusSuccess, type EnforcementEvidence } from './enforcement';
import { FactSnapshotSchema } from '../types';
import type { PullRequestState, RecoveryRemote } from './recovery';
import type { GitHubAppTokenProvider } from './github-auth';
import { localGitHubAppTokenProvider } from './github-config';

type StatusEvidence = z.infer<typeof StatusEvidenceSchema>;
type Context = z.infer<typeof RequiredContextSchema>;
type Target = Baseline['target'];
type LocalState = { attempt: LaunchAttempt; submission: Submission };
const sha = (value: unknown) => ShaSchema.parse(value);
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid GitHub object response.');
  return value as Record<string, unknown>;
};
const list = (value: unknown): unknown[] => { if (!Array.isArray(value)) throw new Error('Invalid GitHub list response.'); return value; };
const text = (value: unknown): string => { if (typeof value !== 'string') throw new Error('Invalid GitHub text response.'); return value; };
const number = (value: unknown): number => { if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error('Invalid GitHub numeric identity.'); return Number(value); };
const segment = (value: string) => encodeURIComponent(value);
const referencePath = (value: string) => value.split('/').map(segment).join('/');
const same = (a: unknown, b: unknown) => hashRecord(a) === hashRecord(b);
export const gitObjectSha = (kind: 'blob' | 'commit', content: string): string => createHash('sha1').update(kind + ' ' + Buffer.byteLength(content) + '\0').update(content).digest('hex');
export function commitRequest(candidate: Candidate, treeSha: string) {
  const date = new Date(Math.floor(Date.parse(candidate.createdAt) / 1000) * 1000).toISOString();
  const identity = { name: 'MOGS Launch Correction', email: 'mogs@users.noreply.github.com', date };
  return { message: candidate.commitMessage.replace(/\n*$/, '\n'), tree: sha(treeSha), parents: [candidate.baseSha], author: identity, committer: identity };
}
export function expectedCommitSha(candidate: Candidate, treeSha: string): string {
  const body = commitRequest(candidate, treeSha), seconds = Math.floor(Date.parse(body.author.date) / 1000);
  const author = body.author.name + ' <' + body.author.email + '> ' + seconds + ' +0000';
  return gitObjectSha('commit', `tree ${body.tree}\nparent ${candidate.baseSha}\nauthor ${author}\ncommitter ${author}\n\n${body.message}`);
}
export const operationMarker = (submission: Submission): string => `<!-- mogs-operation:${submission.operationId};attempt:${submission.launchAttemptId};bundle:${submission.candidate.bundleHash} -->`;

export interface GitHubEnforcementSettings {
  repository: string; baseRef: string; producerAppId: number;
  checks: { context: string; appId: number | null }[];
  strict: boolean; enforceAdmins: boolean; bypassActors: unknown[];
  mergeQueue: boolean; autoMerge: boolean; allowForcePushes: boolean; allowDeletions: boolean;
  observedAt: string;
}
export class GitHubHttpError extends Error {
  constructor(readonly status: number, method: string, route: string) { super(`GitHub ${method} ${route.split('?')[0]} returned ${status}.`); }
}
interface TreeEntry { path: string; mode: string; type: string; sha: string }
export interface GitHubOptions {
  target: Target;
  token?: string;
  tokenProvider?: Pick<GitHubAppTokenProvider, 'getToken' | 'invalidate' | 'getAppMetadata'>;
  appSlug?: string;
  fetch?: typeof fetch;
  clock?: () => Date;
  readLocal: (runId: string) => LocalState | null;
  stateStore?: () => RemoteDatabase;
  testOnlyAllowFixtureEvidence?: boolean;
  observeProduction?: (submission: Submission, deploymentId: string) => Promise<DeploymentObservation>;
}

/** GitHub.com only, explicit configured repository, no merge or ref-update methods. */
export class GitHubRemote implements RecoveryRemote {
  readonly target: Target;
  private readonly token: string;
  private readonly tokenProvider?: Pick<GitHubAppTokenProvider, 'getToken' | 'invalidate' | 'getAppMetadata'>;
  private readonly appSlug: string;
  private readonly request: typeof fetch;
  private readonly clock: () => Date;
  private readonly prefix: string;
  constructor(private readonly options: GitHubOptions) {
    this.target = options.target;
    this.token = options.token ?? process.env.MOGS_GITHUB_TOKEN ?? '';
    this.appSlug = options.appSlug ?? process.env.MOGS_STATUS_PRODUCER_APP_SLUG ?? '';
    this.request = options.fetch ?? fetch; this.clock = options.clock ?? (() => new Date());
    if (!/^[\w.-]+\/[\w.-]+$/.test(this.target.repository) || !this.target.baseRef || /[\0~^:?*\[\\]|\.\.|@\{|\/\//.test(this.target.baseRef)) throw new Error('Invalid configured repository/base ref.');
    this.prefix = '/repos/' + this.target.repository.split('/').map(segment).join('/');
    this.tokenProvider = options.tokenProvider ?? (options.token === undefined && process.env.MOGS_GITHUB_PRIVATE_KEY_PATH ? localGitHubAppTokenProvider({ repository: this.target.repository, appId: this.target.statusProducerAppId, appSlug: this.appSlug, fetch: this.request, clock: this.clock }) : undefined);
  }
  private async api(method: 'GET' | 'POST' | 'PATCH', route: string, body?: unknown): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = this.tokenProvider ? await this.tokenProvider.getToken() : this.token;
      if (!token) throw new RemoteStateError('validation', 'Configure local GitHub App credentials or MOGS_GITHUB_TOKEN; no GitHub operation was attempted.');
      let response: Response;
      try {
        response = await this.request('https://api.github.com' + route, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2026-03-10', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      } catch { throw new Error('GitHub request failed or timed out; remote outcome may be unknown.'); }
      if (response.status === 401 && attempt === 0 && this.tokenProvider) { this.tokenProvider.invalidate(token); continue; }
      if (!response.ok) throw new GitHubHttpError(response.status, method, route);
      const source = await response.text();
      if (Buffer.byteLength(source) > 8_000_000) throw new Error('GitHub response exceeds the bounded size.');
      try { return source ? JSON.parse(source) : null; } catch { throw new Error('GitHub returned invalid JSON.'); }
    }
    throw new Error('GitHub authentication retry was exhausted.');
  }
  private async optional(route: string): Promise<unknown | null> { try { return await this.api('GET', route); } catch (error) { if (error instanceof GitHubHttpError && error.status === 404) return null; throw error; } }
  private async paginated(route: string): Promise<unknown[]> {
    const result: unknown[] = [];
    for (let page = 1; page <= 10; page++) {
      const rows = list(await this.api('GET', route + (route.includes('?') ? '&' : '?') + 'per_page=100&page=' + page));
      result.push(...rows); if (rows.length < 100) return result;
    }
    throw new Error('GitHub pagination exceeded its bound; remote identity remains unknown.');
  }
  private local(submission: Submission): LocalState {
    const current = this.options.readLocal(submission.runId);
    const core = ({ candidateSha: _sha, ...rest }: Candidate) => rest;
    if (!current || current.attempt.id !== submission.launchAttemptId || current.submission.id !== submission.id || current.submission.operationId !== submission.operationId || !same(current.attempt.baseline.target, this.target) || !same(core(current.submission.candidate), core(submission.candidate)) || (submission.candidate.candidateSha !== null && submission.candidate.candidateSha !== current.submission.candidate.candidateSha)) throw new RemoteStateError('stale', 'GitHub operation does not match the stored attempt and configured target.');
    return current;
  }
  private active(submission: Submission): LocalState {
    const current = this.local(submission);
    if (current.attempt.state !== 'active' || current.submission.status === 'closed') throw new RemoteStateError('stale', 'Inactive attempt cannot write a candidate or PR.');
    return current;
  }
  async assertBase(candidate: Candidate): Promise<void> {
    const ref = object(await this.api('GET', this.prefix + '/git/ref/heads/' + referencePath(this.target.baseRef)));
    if (text(ref.ref) !== 'refs/heads/' + this.target.baseRef || sha(object(ref.object).sha) !== candidate.baseSha) throw new RemoteStateError('stale', 'Base head changed; abandon this attempt before creating a new candidate.');
  }
  async validateStatusProducer(): Promise<number> {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(this.appSlug)) throw new RemoteStateError('validation', 'A configured GitHub status producer App slug is required.');
    const app = object(this.tokenProvider ? await this.tokenProvider.getAppMetadata() : await this.api('GET', '/apps/' + segment(this.appSlug)));
    if (number(app.id) !== this.target.statusProducerAppId || app.slug !== this.appSlug) throw new RemoteStateError('validation', 'Configured App slug and required status producer ID do not match.');
    return this.target.statusProducerAppId;
  }
  /** Settings are observations only. They do not assert that merge-blocking probes passed. */
  async readEnforcementSettings(): Promise<GitHubEnforcementSettings> {
    await this.validateStatusProducer();
    const repo = object(await this.api('GET', this.prefix));
    if (text(repo.full_name).toLowerCase() !== this.target.repository.toLowerCase()) throw new Error('Repository identity mismatch.');
    const protection = object(await this.api('GET', this.prefix + '/branches/' + segment(this.target.baseRef) + '/protection'));
    const required = object(protection.required_status_checks), checks = list(required.checks).map(value => { const item = object(value); return { context: text(item.context), appId: item.app_id === null ? null : number(item.app_id) }; });
    const reviews = protection.required_pull_request_reviews ? object(protection.required_pull_request_reviews) : {};
    const allowances = reviews.bypass_pull_request_allowances ? object(reviews.bypass_pull_request_allowances) : {};
    const bypassActors = Object.values(allowances).flatMap(value => Array.isArray(value) ? value : []);
    const branchRules = await this.paginated(this.prefix + '/rules/branches/' + segment(this.target.baseRef));
    const activeRulesetIds = new Set(branchRules.map(value => object(value).ruleset_id).filter((value): value is number => typeof value === 'number'));
    if (activeRulesetIds.size) {
      const rulesets = await this.paginated(this.prefix + '/rulesets?includes_parents=true');
      for (const id of activeRulesetIds) {
        const summary = rulesets.map(object).find(value => value.id === id);
        if (!summary) throw new Error('Applied ruleset source is unknown.');
        const endpoint = summary.source_type === 'Repository' ? this.prefix + '/rulesets/' + id : summary.source_type === 'Organization' ? '/orgs/' + segment(text(summary.source)) + '/rulesets/' + id : null;
        if (!endpoint) throw new Error('Unsupported inherited ruleset source.');
        const ruleset = object(await this.api('GET', endpoint));
        if (ruleset.enforcement !== 'active') throw new Error('Applied ruleset enforcement is unknown.');
        bypassActors.push(...list(ruleset.bypass_actors));
      }
    }
    return { repository: this.target.repository, baseRef: this.target.baseRef, producerAppId: this.target.statusProducerAppId, checks, strict: required.strict === true, enforceAdmins: object(protection.enforce_admins).enabled === true, bypassActors, mergeQueue: branchRules.some(value => object(value).type === 'merge_queue'), autoMerge: repo.allow_auto_merge !== false, allowForcePushes: protection.allow_force_pushes ? object(protection.allow_force_pushes).enabled !== false : false, allowDeletions: protection.allow_deletions ? object(protection.allow_deletions).enabled !== false : false, observedAt: this.clock().toISOString() };
  }
  assertEnforcementSettings(settings: GitHubEnforcementSettings): void {
    if (settings.repository !== this.target.repository || settings.baseRef !== this.target.baseRef || settings.producerAppId !== this.target.statusProducerAppId || !settings.strict || !settings.enforceAdmins || settings.bypassActors.length || settings.mergeQueue || settings.autoMerge || settings.allowForcePushes || settings.allowDeletions || RequiredContextSchema.options.some(context => !settings.checks.some(check => check.context === context && check.appId === this.target.statusProducerAppId))) throw new RemoteStateError('validation', 'Observed merge protection is insufficient; live enforcement probes remain required.');
  }
  private async tree(treeSha: string): Promise<TreeEntry[]> {
    const result = object(await this.api('GET', this.prefix + '/git/trees/' + sha(treeSha) + '?recursive=1'));
    if (result.truncated !== false || result.sha !== treeSha) throw new Error('Git tree is incomplete or mismatched.');
    return list(result.tree).map(value => { const item = object(value); return { path: text(item.path), mode: text(item.mode), type: text(item.type), sha: sha(item.sha) }; });
  }
  private async blobText(entry: TreeEntry): Promise<string> {
    if (entry.type !== 'blob' || entry.mode !== '100644') throw new Error('Trusted seed/source must be a regular file.');
    const blob = object(await this.api('GET', this.prefix + '/git/blobs/' + entry.sha));
    if (blob.encoding !== 'base64' || blob.sha !== entry.sha) throw new Error('Seed blob encoding/identity mismatch.');
    const bytes = Buffer.from(text(blob.content).replaceAll('\n', ''), 'base64');
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (gitObjectSha('blob', value) !== entry.sha) throw new Error('Seed/source bytes do not match their Git blob.');
    return value;
  }
  async readSeed(revision: string): Promise<{ seedManifestText: string; seedFactsText: string }> {
    const pinned = sha(revision);
    const repository = object(await this.api('GET', this.prefix));
    if (text(repository.full_name).toLowerCase() !== this.target.repository.toLowerCase()) throw new Error('Seed repository identity mismatch.');
    const commit = object(await this.api('GET', this.prefix + '/git/commits/' + pinned));
    if (commit.sha !== pinned) throw new Error('Seed commit identity mismatch.');
    const tree = await this.tree(sha(object(commit.tree).sha));
    const manifestEntry = tree.find(entry => entry.path === 'content/seed.json'), factsEntry = tree.find(entry => entry.path === 'data/seed/facts.json');
    if (!manifestEntry || !factsEntry) throw new Error('Pinned seed revision lacks committed manifest or facts.');
    return { seedManifestText: await this.blobText(manifestEntry), seedFactsText: await this.blobText(factsEntry) };
  }
  private async assertTrustedRestoration(attempt: LaunchAttempt, candidate: Candidate, finalHashes: Record<string, string>): Promise<void> {
    if (!attempt.seedRevision) throw new Error('Restoration seed revision is missing.');
    const { seedManifestText, seedFactsText: factsText } = await this.readSeed(attempt.seedRevision);
    const manifest = object(JSON.parse(seedManifestText)), sources = object(manifest.sources);
    const desired = FactSnapshotSchema.parse(JSON.parse(factsText));
    if (hashRecord(desired) !== attempt.desiredFactsHash) throw new Error('Committed seed facts differ from restoration desired facts.');
    const trusted: Record<string, string> = { 'data/facts.json': sha256(factsText) };
    for (const [file, input] of Object.entries(sources)) {
      const item = object(input), source = text(item.source), sourceHash = sha256(source);
      if (item.hash !== sourceHash || !attempt.baseline.assets.some(asset => asset.editable && asset.path === 'content/' + file)) throw new Error('Committed seed source mapping/hash is invalid.');
      trusted['content/' + file] = sourceHash;
    }
    if (hashRecord(trusted) !== hashRecord(finalHashes) || hashRecord(trusted) !== candidate.treeHash) throw new Error('Restoration candidate differs from the trusted committed seed.');
  }
  async createCommit(submission: Submission, images: Record<string, string>): Promise<string> {
    const captured = this.active(submission); const candidate = submission.candidate;
    await this.assertBase(candidate);
    if (!same(Object.keys(images).sort(), candidate.files.map(file => file.path).sort()) || candidate.files.some(file => sha256(images[file.path] ?? '') !== file.afterHash)) throw new Error('Durable candidate images do not match checked hashes.');
    const base = object(await this.api('GET', this.prefix + '/git/commits/' + candidate.baseSha));
    if (sha(base.sha) !== candidate.baseSha) throw new Error('Base commit identity mismatch.');
    const baseTreeSha = sha(object(base.tree).sha), baseTree = await this.tree(baseTreeSha);
    const mappedHashes: Record<string, string> = Object.fromEntries(captured.attempt.baseline.assets.filter(asset => asset.editable).map(asset => [asset.path!, asset.sourceHash]));
    mappedHashes['data/facts.json'] = captured.attempt.baseline.factsFileHash;
    if (candidate.files.some(file => mappedHashes[file.path] !== file.beforeHash)) throw new RemoteStateError('stale', 'Candidate changed paths differ from the pinned source mapping.');
    const finalHashes = { ...mappedHashes, ...Object.fromEntries(candidate.files.map(file => [file.path, file.afterHash])) };
    if (hashRecord(finalHashes) !== candidate.treeHash) throw new Error('Candidate does not preserve the complete protected source tree.');
    if (candidate.purpose === 'restoration') await this.assertTrustedRestoration(captured.attempt, candidate, finalHashes);
    for (const [file, beforeHash] of Object.entries(mappedHashes)) {
      const entry = baseTree.find(item => item.path === file);
      if (!entry || entry.type !== 'blob' || entry.mode !== '100644') throw new Error('Candidate path is not an existing regular source file.');
      const blob = object(await this.api('GET', this.prefix + '/git/blobs/' + entry.sha));
      if (blob.encoding !== 'base64' || blob.sha !== entry.sha) throw new Error('Base blob encoding/identity mismatch.');
      const bytes = Buffer.from(text(blob.content).replaceAll('\n', ''), 'base64');
      if (sha256(bytes) !== beforeHash) throw new RemoteStateError('stale', 'Pinned base bytes do not match the checked candidate, including protected assets.');
    }
    const tree: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
    for (const file of [...candidate.files].sort((a, b) => a.path.localeCompare(b.path))) {
      this.active(submission);
      const content = images[file.path], expected = gitObjectSha('blob', content);
      const uploaded = object(await this.api('POST', this.prefix + '/git/blobs', { content, encoding: 'utf-8' }));
      if (sha(uploaded.sha) !== expected) throw new Error('Uploaded blob differs from durable checked bytes.');
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: expected });
    }
    this.active(submission);
    const createdTree = object(await this.api('POST', this.prefix + '/git/trees', { base_tree: baseTreeSha, tree })), treeSha = sha(createdTree.sha);
    const observedTree = await this.tree(treeSha);
    const oldLeaves = baseTree.filter(entry => entry.type !== 'tree'), newLeaves = observedTree.filter(entry => entry.type !== 'tree');
    const expectedLeaves = oldLeaves.map(entry => tree.find(change => change.path === entry.path) ?? entry).sort((a, b) => a.path.localeCompare(b.path));
    if (!same(expectedLeaves, newLeaves.sort((a, b) => a.path.localeCompare(b.path)))) throw new Error('Combined Git tree changes unapproved paths.');
    const body = commitRequest(candidate, treeSha), expected = expectedCommitSha(candidate, treeSha);
    this.active(submission);
    const commit = object(await this.api('POST', this.prefix + '/git/commits', body));
    if (sha(commit.sha) !== expected) throw new Error('GitHub returned a non-deterministic candidate commit.');
    return expected;
  }
  private async branchSha(candidate: Candidate): Promise<string | null> {
    const result = await this.optional(this.prefix + '/git/ref/heads/' + referencePath(candidate.branch));
    if (result === null) return null;
    const ref = object(result);
    if (ref.ref !== 'refs/heads/' + candidate.branch) throw new Error('Run branch identity mismatch.');
    return sha(object(ref.object).sha);
  }
  async ensureBranch(submission: Submission): Promise<void> {
    this.active(submission); const candidate = submission.candidate;
    if (!candidate.candidateSha || candidate.branch !== 'codex/' + (candidate.purpose === 'restoration' ? 'restore-' : 'launch-') + candidate.launchAttemptId) throw new Error('Candidate requires its exact owned run branch and assigned SHA.');
    await this.assertBase(candidate);
    const existing = await this.branchSha(candidate);
    if (existing !== null) { if (existing !== candidate.candidateSha) throw new RemoteStateError('stale', 'Run branch has unknown content; it will not be overwritten.'); return; }
    this.active(submission);
    try { await this.api('POST', this.prefix + '/git/refs', { ref: 'refs/heads/' + candidate.branch, sha: candidate.candidateSha }); }
    catch (error) { if (!(error instanceof GitHubHttpError && error.status === 422)) throw error; }
    if (await this.branchSha(candidate) !== candidate.candidateSha) throw new RemoteStateError('stale', 'Created run branch does not match the immutable candidate.');
  }
  private parsePullRequest(value: unknown, submission: Submission, requireMarker = true): PullRequestState {
    const pr = object(value), head = object(pr.head), base = object(pr.base);
    if (text(object(head.repo).full_name).toLowerCase() !== this.target.repository.toLowerCase() || text(object(base.repo).full_name).toLowerCase() !== this.target.repository.toLowerCase() || head.ref !== submission.candidate.branch || base.ref !== this.target.baseRef || (requireMarker && !text(pr.body).includes(operationMarker(submission))) || pr.auto_merge !== null) throw new RemoteStateError('stale', 'PR repository, branch, marker or merge settings differ from this operation.');
    const prNumber = number(pr.number), url = text(pr.html_url);
    if (url !== 'https://github.com/' + this.target.repository + '/pull/' + prNumber || !['open', 'closed'].includes(text(pr.state))) throw new Error('PR identity is outside the configured repository.');
    return { number: prNumber, url, headSha: sha(head.sha), baseSha: sha(base.sha), state: pr.state as 'open' | 'closed', mergedSha: pr.merged_at !== null && pr.merged_at !== undefined ? sha(pr.merge_commit_sha) : null };
  }
  async findPullRequest(submission: Submission): Promise<PullRequestState | null> {
    this.local(submission);
    const head = this.target.repository.split('/')[0] + ':' + submission.candidate.branch;
    const rows = await this.paginated(this.prefix + '/pulls?state=all&head=' + segment(head) + '&base=' + segment(this.target.baseRef));
    if (!rows.length) return null;
    if (rows.length !== 1) throw new RemoteStateError('stale', 'Ambiguous run branch PR identity; no new PR will be created.');
    const summary = object(rows[0]);
    const pr = this.parsePullRequest(await this.api('GET', this.prefix + '/pulls/' + number(summary.number)), submission);
    if (pr.headSha !== submission.candidate.candidateSha) throw new RemoteStateError('stale', 'Existing PR head differs from the immutable candidate.');
    return pr;
  }
  async createPullRequest(submission: Submission): Promise<PullRequestState> {
    this.active(submission);
    const existing = await this.findPullRequest(submission); if (existing) return existing;
    await this.assertBase(submission.candidate);
    if (await this.branchSha(submission.candidate) !== submission.candidate.candidateSha) throw new RemoteStateError('stale', 'PR head must be the owned immutable candidate.');
    this.active(submission);
    try {
      const result = await this.api('POST', this.prefix + '/pulls', { title: submission.candidate.purpose === 'restoration' ? 'Restore frozen MOGS seed' : 'Apply approved MOGS launch corrections', head: submission.candidate.branch, base: this.target.baseRef, body: `Checked MOGS ${submission.candidate.purpose} candidate. Human merge is required after candidate and preview verification.\n\n${operationMarker(submission)}\n`, maintainer_can_modify: false, draft: false });
      const pr = this.parsePullRequest(result, submission);
      if (pr.headSha !== submission.candidate.candidateSha || pr.baseSha !== submission.candidate.baseSha) throw new RemoteStateError('stale', 'Created PR head/base changed during submission.');
      return pr;
    } catch (error) {
      if (!(error instanceof GitHubHttpError && error.status === 422)) throw error;
      const recovered = await this.findPullRequest(submission); if (recovered) return recovered;
      throw error;
    }
  }
  async readPullRequest(submission: Submission): Promise<PullRequestState> {
    this.local(submission);
    if (!submission.prNumber) throw new Error('No recorded PR to observe.');
    // Once journaled, the immutable PR number/URL owns recovery even if its body is edited.
    const pr = this.parsePullRequest(await this.api('GET', this.prefix + '/pulls/' + submission.prNumber), submission, false);
    if (pr.number !== submission.prNumber || pr.url !== submission.prUrl) throw new Error('Observed PR identity mismatch.');
    return pr;
  }
  async closePullRequest(submission: Submission): Promise<void> {
    const current = this.local(submission);
    if (current.attempt.state !== 'abandoning') throw new RemoteStateError('stale', 'Only a journaled abandonment may close its PR.');
    const pr = await this.readPullRequest(submission);
    if (pr.mergedSha || pr.state === 'closed') return;
    await this.api('PATCH', this.prefix + '/pulls/' + pr.number, { state: 'closed' });
  }
  private status(value: unknown, expectedSha: string): StatusEvidence {
    const item = object(value), creator = object(item.creator), context = RequiredContextSchema.parse(item.context);
    if (creator.type !== 'Bot' || creator.login !== this.appSlug + '[bot]') throw new Error('Status was not authored by the configured GitHub App bot.');
    const description = text(item.description), match = /^MOGS evidence ([a-f0-9]{64})$/.exec(description);
    if (!match) throw new Error('Status lacks the recorded evidence hash.');
    const url = text(item.url);
    if (!url.startsWith('https://api.github.com' + this.prefix + '/statuses/' + expectedSha)) throw new Error('Status URL does not bind the expected commit.');
    return StatusEvidenceSchema.parse({ context, sha: expectedSha, state: item.state, producerAppId: this.target.statusProducerAppId, evidenceHash: match[1], statusUrl: url, at: item.created_at });
  }
  async postStatus(submission: Submission, expectedSha: string, context: Context, state: StatusEvidence['state'], evidenceHash: string, enforcement?: EnforcementEvidence): Promise<StatusEvidence> {
    sha(expectedSha); RequiredContextSchema.parse(context); if (!/^[a-f0-9]{64}$/.test(evidenceHash)) throw new Error('Invalid evidence hash.');
    await this.validateStatusProducer();
    const current = this.local(submission);
    if (state === 'failure' && expectedSha !== current.submission.candidate.candidateSha) {
      const pr = await this.readPullRequest(current.submission);
      if (pr.headSha !== expectedSha) throw new RemoteStateError('stale', 'Failure retirement is limited to the known candidate or observed PR head.');
    }
    if (state === 'success') {
      assertStatusAllowed(current.attempt, current.submission, expectedSha, context, state, enforcement);
      const store = this.options.stateStore?.();
      if (!store) throw new Error('A durable state store is required to authorize success evidence.');
      authorizeStatusSuccess(store, current.submission, expectedSha, context, evidenceHash, { testOnlyAllowFixtureEvidence: this.options.testOnlyAllowFixtureEvidence });
      this.assertEnforcementSettings(await this.readEnforcementSettings());
      const pr = await this.readPullRequest(current.submission);
      if (pr.headSha !== expectedSha || pr.baseSha !== current.submission.candidate.baseSha || pr.state !== 'open' || pr.mergedSha) throw new RemoteStateError('stale', 'Success requires the exact current open PR head and pinned base.');
      await this.assertBase(current.submission.candidate);
    } else if (state !== 'failure' && current.attempt.state !== 'active') throw new RemoteStateError('stale', 'Inactive attempts can receive terminal failure statuses only.');
    const latest = this.local(submission); assertStatusAllowed(latest.attempt, latest.submission, expectedSha, context, state, enforcement);
    if (state === 'success') authorizeStatusSuccess(this.options.stateStore!(), latest.submission, expectedSha, context, evidenceHash, { testOnlyAllowFixtureEvidence: this.options.testOnlyAllowFixtureEvidence });
    const result = await this.api('POST', this.prefix + '/statuses/' + expectedSha, { state, context, description: 'MOGS evidence ' + evidenceHash });
    const evidence = this.status(result, expectedSha);
    if (evidence.state !== state || evidence.context !== context || evidence.evidenceHash !== evidenceHash) throw new Error('Returned status differs from the requested evidence.');
    if (state === 'success') {
      const after = this.local(submission);
      try { assertStatusAllowed(after.attempt, after.submission, expectedSha, context, state, enforcement); }
      catch {
        // A retirement that raced an in-flight success must leave a failing context.
        await this.postFailure(after.submission, expectedSha, context, evidenceHash);
        throw new RemoteStateError('stale', 'Success raced attempt retirement and was replaced with failure.');
      }
    }
    return evidence;
  }
  postFailure(submission: Submission, sha: string, context: Context, evidenceHash: string): Promise<StatusEvidence> { return this.postStatus(submission, sha, context, 'failure', evidenceHash); }
  async readStatuses(submission: Submission, expectedSha: string): Promise<StatusEvidence[]> {
    this.local(submission); sha(expectedSha); await this.validateStatusProducer();
    const rows = await this.paginated(this.prefix + '/commits/' + expectedSha + '/statuses'), seen = new Set<string>(), result: StatusEvidence[] = [];
    for (const row of rows) {
      const item = object(row), context = String(item.context);
      if (!RequiredContextSchema.options.includes(context as Context) || seen.has(context)) continue;
      seen.add(context); result.push(this.status(row, expectedSha));
    }
    return result;
  }
  async observeProduction(submission: Submission, deploymentId: string): Promise<DeploymentObservation> {
    this.local(submission);
    if (!this.options.observeProduction) throw new Error('Production observation adapter is not configured.');
    return this.options.observeProduction(submission, deploymentId);
  }
}
