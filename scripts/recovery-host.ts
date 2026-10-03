import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { loadLocalEnv } from '../lib/providers/env';
import { localVercelToken } from '../lib/deployment/vercel';

// Bounded setup for the public recovery target explicitly approved by the user.
const name = 'mogs-recovery', teamId = 'team_tTySQ8aRrx08Ma0X2AMFm40d';
const primaryId = 'prj_hT55y9ozmq67qLkneP8csBNUuVTr';
const repository = 'jcstotomas/mogs-demo', repoId = 1403606624;
const branch = 'codex/recovery-base', sha = '3786e7f8a331b6bf5d54f171624234c00324429b';
const origin = 'https://mogs-recovery.vercel.app';
const directory = 'data/evidence/remote1/recovery', file = directory + '/hosting-setup.json';
type RecordValue = Record<string, any>;
loadLocalEnv();
if (process.argv.slice(2).join(' ') !== '--apply') throw new Error('Use --apply for the approved isolated target.');
const bootstrap = JSON.parse(await readFile(directory + '/bootstrap-branch.json', 'utf8'));
assert.equal(bootstrap.passed, true); assert.equal(bootstrap.branchSha, sha); assert.equal(bootstrap.branch, branch);
let journal: RecordValue;
try { journal = JSON.parse(await readFile(file, 'utf8')); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  journal = { format: 'mogs-recovery-host-v1', operationId: randomUUID(), createdAt: new Date().toISOString(), name, teamId, repository, repoId, branch, sha, origin, publicAuthorized: true, correctionCredit: false, stages: [] };
}
for (const [key, value] of Object.entries({ format: 'mogs-recovery-host-v1', name, teamId, repository, repoId, branch, sha, origin, publicAuthorized: true, correctionCredit: false })) assert.equal(journal[key], value);
const save = async () => { await mkdir(directory, { recursive: true }); await writeFile(file + '.tmp', JSON.stringify(journal, null, 2) + '\n'); await rename(file + '.tmp', file); };
async function stage(event: string, evidence: RecordValue = {}) { journal.stages.push({ at: new Date().toISOString(), event, ...evidence }); await save(); console.log(JSON.stringify({ event, ...evidence })); }
async function api(method: string, route: string, body?: unknown, optional = false): Promise<RecordValue | null> {
  const token = await localVercelToken();
  const response = await fetch('https://api.vercel.com' + route + (route.includes('?') ? '&' : '?') + 'teamId=' + teamId, { method, redirect: 'error', signal: AbortSignal.timeout(20_000), cache: 'no-store', headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (optional && response.status === 404) { await response.body?.cancel(); return null; }
  const text = await response.text();
  if (Buffer.byteLength(text) > 4_000_000) throw new Error('Hosting response exceeded its bound.');
  if (!response.ok) { const detail = JSON.parse(text); throw new Error('Vercel setup returned HTTP ' + response.status + ' (' + String(detail.error?.code ?? 'unknown') + '): ' + String(detail.error?.message ?? 'No diagnostic message.').slice(0, 800)); }
  return text ? JSON.parse(text) : {};
}
const projectRecord = (value: RecordValue) => ({ id: value.id, name: value.name, accountId: value.accountId, framework: value.framework ?? null, nodeVersion: value.nodeVersion, rootDirectory: value.rootDirectory ?? null, ssoProtection: value.ssoProtection ?? null, passwordProtection: value.passwordProtection ?? null, link: value.link ? { type: value.link.type, repo: value.link.repo, repoId: value.link.repoId, org: value.link.org, productionBranch: value.link.productionBranch } : null });
function assertIdentity(value: RecordValue) {
  assert.match(value.id, /^prj_/); assert.notEqual(value.id, primaryId); assert.equal(value.name, name); assert.equal(value.accountId, teamId);
  assert.equal(value.link?.type, 'github'); assert.equal(value.link?.org, 'jcstotomas'); assert.equal(value.link?.repo, 'mogs-demo'); assert.equal(Number(value.link?.repoId), repoId);
}
const deploymentRecord = (value: RecordValue) => ({ id: value.id, projectId: value.projectId, ownerId: value.ownerId, url: value.url, target: value.target, readyState: value.readyState, gitSource: value.gitSource, sourceCommit: value.meta?.githubCommitSha ?? value.gitSource?.sha });

try {
  journal.primaryBefore ??= projectRecord((await api('GET', '/v9/projects/' + primaryId))!);
  await stage('setup-journaled');
  let project = await api('GET', '/v9/projects/' + name, undefined, true);
  if (!project) {
    if (journal.projectId) throw new Error('Recorded recovery project disappeared; do not recreate blindly.');
    await stage('create-project-intent');
    project = await api('POST', '/v11/projects', { name, framework: null, gitRepository: { type: 'github', repo: repository } });
  } else if (!journal.projectId && !journal.stages.some((item: RecordValue) => item.event === 'create-project-intent')) throw new Error('Recovery project already exists without this operation; resolve its ownership before changing it.');
  assertIdentity(project!);
  if (journal.projectId) assert.equal(project!.id, journal.projectId);
  journal.projectId = project!.id; await stage('project-identity-observed', { project: projectRecord(project!) });
  if (project!.link.productionBranch !== branch) {
    await stage('production-branch-intent', { branch });
    await api('PATCH', '/v9/projects/' + project!.id + '/branch', { branch });
  }
  if (project!.ssoProtection || project!.passwordProtection || project!.nodeVersion !== '24.x') {
    await stage('public-auth-settings-intent');
    await api('PATCH', '/v9/projects/' + project!.id, { ssoProtection: null, passwordProtection: null, nodeVersion: '24.x' });
  }
  project = await api('GET', '/v9/projects/' + project!.id);
  assertIdentity(project!); assert.equal(project!.link.productionBranch, branch); assert.equal(project!.ssoProtection ?? null, null); assert.equal(project!.passwordProtection ?? null, null);
  assert.equal(project!.framework ?? null, null); assert.equal(project!.rootDirectory ?? null, null); assert.equal(project!.nodeVersion, '24.x');
  journal.project = projectRecord(project!); await stage('public-project-settings-verified', { project: journal.project });
  const envs = (await api('GET', '/v9/projects/' + project!.id + '/env'))!;
  const matching = envs.envs?.filter((env: RecordValue) => env.key === 'MOGS_PUBLIC_ORIGIN') ?? [];
  if (!matching.length) {
    await stage('public-origin-intent');
    await api('POST', '/v10/projects/' + project!.id + '/env', { key: 'MOGS_PUBLIC_ORIGIN', value: origin, type: 'plain', target: ['production', 'preview'] });
  } else if (matching.length !== 1 || matching[0].value !== origin || !['production', 'preview'].every(value => matching[0].target.includes(value))) throw new Error('Existing public-origin setting differs from the isolated target.');
  const envReadback = (await api('GET', '/v9/projects/' + project!.id + '/env'))!.envs.filter((env: RecordValue) => env.key === 'MOGS_PUBLIC_ORIGIN');
  assert.equal(envReadback.length, 1); assert.equal(envReadback[0].value, origin); assert.deepEqual([...envReadback[0].target].sort(), ['preview', 'production']);
  await stage('public-origin-verified', { origin });
  let deployment: RecordValue | null = null;
  if (journal.deploymentId) deployment = await api('GET', '/v13/deployments/' + journal.deploymentId);
  else {
    const list = (await api('GET', '/v6/deployments?projectId=' + project!.id + '&meta-githubCommitSha=' + sha + '&limit=20'))!;
    const entry = list.deployments?.find((item: RecordValue) => item.target === 'production' && item.meta?.githubCommitSha === sha);
    if (entry) deployment = await api('GET', '/v13/deployments/' + (entry.uid ?? entry.id));
    if (!deployment) {
      await stage('production-deployment-intent', { sourceCommit: sha });
      deployment = await api('POST', '/v13/deployments', { name, project: project!.id, target: 'production', gitSource: { type: 'github', repoId, ref: branch, sha }, projectSettings: { framework: null, buildCommand: project!.buildCommand ?? null, installCommand: project!.installCommand ?? null, outputDirectory: project!.outputDirectory ?? null, rootDirectory: null, nodeVersion: '24.x' }, meta: { mogsRecoveryOperation: journal.operationId } });
    }
  }
  assert.equal(deployment!.projectId, project!.id); assert.equal(deployment!.ownerId, teamId); assert.equal(deployment!.target, 'production'); assert.equal(deployment!.meta?.githubCommitSha ?? deployment!.gitSource?.sha, sha);
  journal.deploymentId = deployment!.id; journal.deployment = deploymentRecord(deployment!);
  journal.primaryAfter = projectRecord((await api('GET', '/v9/projects/' + primaryId))!); assert.deepEqual(journal.primaryAfter, journal.primaryBefore);
  journal.setupPassed = true; journal.ready = deployment!.readyState === 'READY';
  delete journal.failure;
  await stage('deployment-created-or-recovered', { deployment: journal.deployment, primarySettingsUnchanged: true });
} catch (error) {
  journal.failure = error instanceof Error ? error.message : 'Recovery hosting setup failed.';
  await stage('setup-failed', { failure: journal.failure }); process.exitCode = 1;
}
