import { GitHubAppTokenProvider } from './github-auth';

/** Only local server code may load these values; the public target never imports this module. */
export function githubAppConfig(environment: Record<string, string | undefined> = process.env) {
  const appId = Number(environment.MOGS_STATUS_PRODUCER_APP_ID);
  const installationId = environment.MOGS_GITHUB_INSTALLATION_ID ? Number(environment.MOGS_GITHUB_INSTALLATION_ID) : undefined;
  if (!Number.isSafeInteger(appId) || appId <= 0) throw new Error('A positive MOGS_STATUS_PRODUCER_APP_ID is required.');
  if (installationId !== undefined && (!Number.isSafeInteger(installationId) || installationId <= 0)) throw new Error('MOGS_GITHUB_INSTALLATION_ID must be a positive integer.');
  const repository = environment.MOGS_GITHUB_REPOSITORY ?? 'jcstotomas/mogs-demo';
  const appSlug = environment.MOGS_STATUS_PRODUCER_APP_SLUG ?? '';
  const privateKeyPath = environment.MOGS_GITHUB_PRIVATE_KEY_PATH ?? '';
  if (!appSlug || !privateKeyPath) throw new Error('MOGS_STATUS_PRODUCER_APP_SLUG and MOGS_GITHUB_PRIVATE_KEY_PATH are required for GitHub App authentication.');
  return { appId, clientId: environment.MOGS_GITHUB_APP_CLIENT_ID || undefined, appSlug, repository, installationId, privateKeyPath };
}

export function localGitHubAppTokenProvider(options: { repository: string; appId: number; appSlug: string; fetch?: typeof fetch; clock?: () => Date; administration?: 'read' | 'write' }, environment: Record<string, string | undefined> = process.env) {
  const config = githubAppConfig(environment);
  if (config.appId !== options.appId || config.appSlug !== options.appSlug || config.repository.toLowerCase() !== options.repository.toLowerCase()) throw new Error('GitHub App credentials do not match the configured target.');
  return new GitHubAppTokenProvider({ ...config, fetch: options.fetch, clock: options.clock, administration: options.administration ?? 'read' });
}
