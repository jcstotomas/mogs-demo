import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Baseline, Submission } from '../runs/remote-types';
import type { DeploymentHost, HostedDeployment } from './verify';

type Target = Baseline['target'];
type Json = Record<string, any>;
export async function localVercelToken(): Promise<string> {
  if (process.env.MOGS_VERCEL_TOKEN) return process.env.MOGS_VERCEL_TOKEN;
  // Reuse this local user's existing CLI login. It never enters the environment or evidence.
  const root = process.platform === 'darwin' ? path.join(homedir(), 'Library/Application Support/com.vercel.cli') : path.join(homedir(), '.local/share/com.vercel.cli');
  try { const auth = JSON.parse(await readFile(path.join(root, 'auth.json'), 'utf8')); if (typeof auth.token === 'string' && auth.token) return auth.token; } catch {}
  throw new Error('Configure MOGS_VERCEL_TOKEN or sign in with the Vercel CLI locally.');
}

/** Read-only host identity adapter; source claims from page HTML never identify a deployment. */
export class VercelDeploymentHost implements DeploymentHost {
  constructor(readonly target: Target, private readonly options: { token?: () => Promise<string>; fetch?: typeof fetch } = {}) {}
  private async api(route: string): Promise<Json> {
    const token = await (this.options.token ?? localVercelToken)();
    let response: Response;
    try { response = await (this.options.fetch ?? fetch)('https://api.vercel.com' + route + (route.includes('?') ? '&' : '?') + 'teamId=' + encodeURIComponent(this.target.vercelTeamId), { redirect: 'error', signal: AbortSignal.timeout(20_000), cache: 'no-store', headers: { Authorization: 'Bearer ' + token } }); } catch { throw new Error('Vercel read failed or timed out.'); }
    if (!response.ok) throw new Error('Vercel deployment read returned HTTP ' + response.status + '.');
    const text = await response.text(); if (Buffer.byteLength(text) > 4_000_000) throw new Error('Vercel deployment response exceeded size limit.');
    try { return JSON.parse(text); } catch { throw new Error('Vercel returned invalid deployment JSON.'); }
  }
  private checked(value: Json, expectedSha?: string, environment?: 'preview' | 'production'): HostedDeployment {
    const deployedSha = value.meta?.githubCommitSha ?? value.gitSource?.sha;
    if ((value.projectId ?? value.project?.id) !== this.target.vercelProjectId || value.ownerId !== this.target.vercelTeamId || typeof value.id !== 'string' || !/^dpl_/.test(value.id) || typeof value.url !== 'string' || !/^[a-zA-Z0-9.-]+\.vercel\.app$/.test(value.url) || !/^[a-f0-9]{40}$/.test(deployedSha ?? '') || (expectedSha && deployedSha !== expectedSha) || (environment && (environment === 'production' ? value.target !== 'production' : value.target === 'production'))) throw new Error('Vercel deployment identity differs from the configured project, environment or Git commit.');
    const owner = value.meta?.githubCommitOrg, repository = value.meta?.githubCommitRepo;
    if (owner && repository && (owner + '/' + repository).toLowerCase() !== this.target.repository.toLowerCase()) throw new Error('Vercel Git repository differs from the configured target.');
    return { deploymentId: value.id, url: 'https://' + value.url, deployedSha, readiness: value.readyState === 'READY' ? 'ready' : ['ERROR', 'CANCELED'].includes(value.readyState) ? 'failed' : 'pending' };
  }
  async production(expectedSha?: string): Promise<HostedDeployment> {
    const hosted = this.checked(await this.api('/v13/deployments/' + encodeURIComponent(new URL(this.target.productionOrigin).hostname)), expectedSha, 'production');
    return { ...hosted, url: this.target.productionOrigin };
  }
  async byId(deploymentId: string, expectedSha: string, environment: 'preview' | 'production'): Promise<HostedDeployment> {
    if (!/^dpl_[A-Za-z0-9]+$/.test(deploymentId)) throw new Error('Invalid Vercel deployment ID.');
    return this.checked(await this.api('/v13/deployments/' + deploymentId), expectedSha, environment);
  }
  async resolve(input: { environment: 'preview' | 'production'; submission: Submission; mergedSha: string | null }): Promise<HostedDeployment> {
    if (input.environment === 'production') {
      if (!input.mergedSha) throw new Error('Production requires the observed PR merge commit.');
      return this.production(input.mergedSha);
    }
    const sha = input.submission.candidate.candidateSha;
    if (!sha) throw new Error('Preview requires a submitted Git commit.');
    const list = await this.api('/v6/deployments?projectId=' + encodeURIComponent(this.target.vercelProjectId) + '&meta-githubCommitSha=' + sha + '&limit=20');
    if (!Array.isArray(list.deployments)) throw new Error('Vercel deployment list is unavailable.');
    for (const entry of list.deployments) {
      if (entry.target === 'production') continue;
      const detail = await this.api('/v13/deployments/' + encodeURIComponent(entry.uid ?? entry.id));
      if ((detail.meta?.githubCommitSha ?? detail.gitSource?.sha) === sha) return this.checked(detail, sha, 'preview');
    }
    throw new Error('No preview deployment exists for the submitted Git commit yet.');
  }
}
