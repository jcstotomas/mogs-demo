import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadLocalEnv } from '../lib/providers/env';
import { githubAppConfig } from '../lib/submission/github-config';
import { GitHubAppTokenProvider } from '../lib/submission/github-auth';
import { GitHubRemote } from '../lib/submission/github';
import { EnforcementEvidenceSchema } from '../lib/submission/enforcement';
import { TargetRepositorySchema } from '../lib/runs/remote-types';

loadLocalEnv();
const config = githubAppConfig(), provider = new GitHubAppTokenProvider({ ...config, administration: 'write' });
const target = TargetRepositorySchema.parse({ repository: config.repository, baseRef: process.env.MOGS_GITHUB_BASE_REF ?? 'main', productionOrigin: process.env.MOGS_PRODUCTION_ORIGIN, vercelProjectId: process.env.MOGS_VERCEL_PROJECT_ID, vercelTeamId: process.env.MOGS_VERCEL_TEAM_ID, statusProducerAppId: config.appId });
const prefix = '/repos/' + config.repository, contexts = ['mogs/candidate', 'mogs/preview'] as const;
const directory = 'data/evidence/remote0', journalFile = directory + '/enforcement-probes.json';
await mkdir(directory, { recursive: true });
let journal: { id: string; repository: string; baseSha?: string; passed: boolean; closed: boolean; probes: { number: number; url: string; sha: string; branch: string; kind: string }[]; stages: Record<string, unknown>[]; failure?: string };
try { journal = JSON.parse(await readFile(journalFile, 'utf8')); } catch { journal = { id: randomUUID(), repository: config.repository, passed: false, closed: false, probes: [], stages: [] }; }
if (journal.repository !== config.repository || journal.closed) throw new Error('Existing probe journal is closed or belongs to another repository; preserve it before starting a new test.');
const save = () => writeFile(journalFile, JSON.stringify(journal, null, 2) + '\n');
async function api(method: string, route: string, body?: unknown): Promise<any> {
  const token = await provider.getToken();
  let response: Response;
  try { response = await fetch('https://api.github.com' + route, { method, redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); } catch { throw new Error('GitHub probe request failed; inspect the durable journal before retrying.'); }
  if (!response.ok) throw new Error('GitHub probe ' + method + ' ' + route.split('?')[0] + ' returned ' + response.status + '.');
  const text = await response.text(); if (Buffer.byteLength(text) > 1_000_000) throw new Error('Probe response exceeded size limit.');
  return text ? JSON.parse(text) : null;
}
async function status(sha: string, state: 'pending' | 'failure' | 'success') {
  for (const context of contexts) {
    const posted = await api('POST', prefix + '/statuses/' + sha, { context, state, description: 'Disposable enforcement probe; no correction verification.', target_url: 'https://github.com/' + config.repository });
    if (posted.creator?.type !== 'Bot' || posted.creator?.login !== config.appSlug + '[bot]') throw new Error('Probe status was not authored by the configured App bot.');
  }
}
async function makeProbe(parentSha: string, kind: string) {
  const branch = 'codex/enforcement-' + journal.id + '-' + kind;
  const existing = journal.probes.find(probe => probe.kind === kind); if (existing) return existing;
  // Recover an observed branch/PR after an interrupted write; no force updates.
  let branchRef: any;
  try { branchRef = await api('GET', prefix + '/git/ref/heads/' + branch); } catch { branchRef = null; }
  let sha: string;
  if (branchRef) sha = branchRef.object.sha;
  else {
    const base = await api('GET', prefix + '/git/commits/' + parentSha);
    const blob = await api('POST', prefix + '/git/blobs', { content: '# MOGS enforcement probe\n\nDisposable ' + kind + ' check. No content or canonical facts changed.\nOperation: ' + journal.id + '\n', encoding: 'utf-8' });
    const tree = await api('POST', prefix + '/git/trees', { base_tree: base.tree.sha, tree: [{ path: 'docs/enforcement-probes/' + journal.id + '-' + kind + '.md', mode: '100644', type: 'blob', sha: blob.sha }] });
    const commit = await api('POST', prefix + '/git/commits', { message: 'Probe MOGS merge enforcement\n\nOperation: ' + journal.id + '\nKind: ' + kind, tree: tree.sha, parents: [parentSha] });
    sha = commit.sha;
    await api('POST', prefix + '/git/refs', { ref: 'refs/heads/' + branch, sha });
  }
  const existingPrs = await api('GET', prefix + '/pulls?state=all&head=' + encodeURIComponent(config.repository.split('/')[0] + ':' + branch) + '&base=' + target.baseRef);
  const pr = existingPrs[0] ?? await api('POST', prefix + '/pulls', { head: branch, base: target.baseRef, title: 'MOGS disposable enforcement probe: ' + kind, body: 'Coordinator gate test ' + journal.id + '. Changes one audit file only. No launch correction or approval credit. This PR will be closed without merging.' });
  if (pr.head?.sha !== sha || pr.base?.repo?.full_name !== config.repository || pr.merged_at) throw new Error('Probe PR identity is unresolved.');
  const value = { number: pr.number, url: pr.html_url, sha, branch, kind }; journal.probes.push(value); await save();
  console.log('Created/recovered disposable probe: ' + value.url);
  return value;
}
async function state(probe: { number: number; sha: string }, name: string, expected: string[]) {
  let pr: any;
  for (let attempt = 0; attempt < 15; attempt++) {
    pr = await api('GET', prefix + '/pulls/' + probe.number);
    if (pr.head?.sha !== probe.sha || pr.state !== 'open' || pr.merged_at) throw new Error('Probe changed or was merged unexpectedly.');
    if (expected.includes(pr.mergeable_state)) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  const value = { name, number: probe.number, sha: probe.sha, mergeable: pr.mergeable, mergeableState: pr.mergeable_state, expected, observedAt: new Date().toISOString() };
  journal.stages.push(value); await save(); console.log(JSON.stringify(value));
  if (!expected.includes(pr.mergeable_state)) throw new Error('GitHub did not report expected merge eligibility for ' + name + '.');
}
try {
  const repository = await api('GET', prefix);
  if (repository.full_name !== config.repository || repository.private !== false) throw new Error('Expected user-created public MOGS repository.');
  const head = await api('GET', prefix + '/git/ref/heads/' + target.baseRef), baseSha = head.object.sha;
  if (journal.baseSha && journal.baseSha !== baseSha) throw new Error('Base changed during probe; preserve this failed journal.'); journal.baseSha = baseSha; await save();
  await api('PATCH', prefix, { allow_auto_merge: false });
  await status(baseSha, 'pending');
  await api('PUT', prefix + '/branches/' + encodeURIComponent(target.baseRef) + '/protection', { required_status_checks: { strict: true, checks: contexts.map(context => ({ context, app_id: config.appId })) }, enforce_admins: true, required_pull_request_reviews: { dismiss_stale_reviews: true, require_code_owner_reviews: false, required_approving_review_count: 0 }, restrictions: null, allow_force_pushes: false, allow_deletions: false });
  const remote = new GitHubRemote({ target, appSlug: config.appSlug, tokenProvider: provider, readLocal: () => null });
  const settings = await remote.readEnforcementSettings(); remote.assertEnforcementSettings(settings);
  const current = await makeProbe(baseSha, 'current');
  await status(current.sha, 'pending'); await state(current, 'pending-blocked', ['blocked']);
  await status(current.sha, 'failure'); await state(current, 'failure-blocked', ['blocked']);
  await status(current.sha, 'pending'); await status(baseSha, 'success'); await state(current, 'wrong-head-blocked', ['blocked']);
  await status(current.sha, 'success'); await state(current, 'current-head-eligible', ['clean']);
  const baseCommit = await api('GET', prefix + '/git/commits/' + baseSha);
  if (!baseCommit.parents?.[0]?.sha) throw new Error('No parent commit available for strict-base probe.');
  const behind = await makeProbe(baseCommit.parents[0].sha, 'behind'); await status(behind.sha, 'success'); await state(behind, 'strict-base-behind-blocked', ['behind']);
  const proof = EnforcementEvidenceSchema.parse({ repository: config.repository, baseRef: target.baseRef, producerAppId: config.appId, checks: contexts.map(context => ({ context, appId: config.appId })), strict: true, enforceAdmins: true, bypassActors: [], mergeQueue: false, autoMerge: false, probes: { pendingBlocked: true, failureBlocked: true, wrongHeadBlocked: true, currentHeadEligible: true }, testedSha: current.sha, verifiedAt: new Date().toISOString() });
  await writeFile(directory + '/enforcement-pass.json', JSON.stringify(proof, null, 2) + '\n'); journal.passed = true;
} catch (error) { journal.failure = error instanceof Error ? error.message : 'Enforcement probe failed.'; process.exitCode = 1; }
finally {
  let closed = true;
  for (const probe of journal.probes) {
    try { const pr = await api('GET', prefix + '/pulls/' + probe.number); if (pr.merged_at) throw new Error('Unexpected probe merge.'); if (pr.state === 'open') await api('PATCH', prefix + '/pulls/' + probe.number, { state: 'closed' }); } catch { closed = false; }
  }
  journal.closed = closed; await save();
  console.log(JSON.stringify({ passed: journal.passed, closed: journal.closed, failure: journal.failure ?? null, prs: journal.probes.map(probe => probe.url) }));
}
