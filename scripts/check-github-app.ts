import { mkdir, writeFile } from 'node:fs/promises';
import { loadLocalEnv } from '../lib/providers/env';
import { githubAppConfig } from '../lib/submission/github-config';
import { GitHubAppTokenProvider } from '../lib/submission/github-auth';
import { GitHubHttpError, GitHubRemote } from '../lib/submission/github';
import { TargetRepositorySchema } from '../lib/runs/remote-types';

loadLocalEnv();
const config = githubAppConfig();
const tokenProvider = new GitHubAppTokenProvider(config);
const target = TargetRepositorySchema.parse({ repository: config.repository, baseRef: process.env.MOGS_GITHUB_BASE_REF ?? 'main', productionOrigin: process.env.MOGS_PRODUCTION_ORIGIN, vercelProjectId: process.env.MOGS_VERCEL_PROJECT_ID, vercelTeamId: process.env.MOGS_VERCEL_TEAM_ID, statusProducerAppId: config.appId });
const remote = new GitHubRemote({ target, tokenProvider, appSlug: config.appSlug, readLocal: () => null });
const result: Record<string, unknown> = { checkedAt: new Date().toISOString(), repository: target.repository, appId: config.appId, appSlug: config.appSlug, authenticated: false, enforcementProven: false };
try {
  await remote.validateStatusProducer();
  const metadata = await tokenProvider.getTokenMetadata();
  result.authenticated = true;
  result.installation = metadata;
  try {
    const settings = await remote.readEnforcementSettings();
    result.settings = settings;
    remote.assertEnforcementSettings(settings);
    result.settingsSufficient = true;
    result.blocker = 'Merge-blocking behavior probes remain required.';
  } catch (error) {
    result.settingsSufficient = false;
    result.blocker = error instanceof GitHubHttpError ? 'Branch protection inspection returned HTTP ' + error.status + '.' : 'Branch protection settings are absent or insufficient.';
  }
} catch (error) {
  // Provider errors intentionally contain neither server response bodies nor credentials.
  result.blocker = error instanceof Error && error.name === 'GitHubAppAuthError' ? error.message : 'GitHub App authentication did not complete.';
}
await mkdir('data/evidence/remote0', { recursive: true });
await writeFile('data/evidence/remote0/github-app-auth.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (result.authenticated !== true) process.exitCode = 1;
