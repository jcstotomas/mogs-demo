import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { loadLocalEnv } from '../lib/providers/env';
import { runtimeProviderConfig } from '../lib/providers';
import { hashRecord } from '../lib/hash';
import { githubAppConfig } from '../lib/submission/github-config';

loadLocalEnv();
const required = ['MOGS_STATUS_PRODUCER_APP_ID', 'MOGS_STATUS_PRODUCER_APP_SLUG', 'MOGS_PRODUCTION_ORIGIN', 'MOGS_VERCEL_PROJECT_ID', 'MOGS_VERCEL_TEAM_ID'];
const credentials = Object.fromEntries([...required, 'MOGS_GITHUB_TOKEN', 'MOGS_GITHUB_APP_CLIENT_ID', 'MOGS_GITHUB_INSTALLATION_ID', 'MOGS_GITHUB_PRIVATE_KEY_PATH'].map(key => [key, Boolean(process.env[key]) ]));
const blockers = required.filter(key => !credentials[key]).map(key => 'Missing local configuration: ' + key);
const githubAuthMode = credentials.MOGS_GITHUB_PRIVATE_KEY_PATH ? 'app-private-key' : credentials.MOGS_GITHUB_TOKEN ? 'manual-installation-token' : 'missing';
if (githubAuthMode === 'missing') blockers.push('Configure MOGS_GITHUB_PRIVATE_KEY_PATH for token refresh or MOGS_GITHUB_TOKEN for a manual installation token.');
if (githubAuthMode === 'app-private-key') { try { githubAppConfig(); } catch (error) { blockers.push(error instanceof Error ? error.message : 'Invalid GitHub App configuration.'); } }
const config = runtimeProviderConfig();
const saved = JSON.parse(await readFile('data/evidence/gate1-live-complete-ff57ceec-5f59-49e0-9a26-d9911b2fdd57.json', 'utf8'));
const validatedConfig = saved.final?.run?.config ?? saved.final?.config;
const result = {
  contractVersion: 2, checkedAt: new Date().toISOString(),
  remote: execFileSync('git', ['remote', '-v'], { encoding: 'utf8' }).trim(),
  repository: process.env.MOGS_GITHUB_REPOSITORY ?? 'jcstotomas/mogs-demo',
  credentialsConfigured: credentials,
  githubAuth: { mode: githubAuthMode, authenticationChecked: false, enforcementChecked: false },
  provider: { config, credentialsConfigured: Boolean(process.env.ANTHROPIC_API_KEY), reusedEvidence: 'gate1-live-complete-ff57ceec-5f59-49e0-9a26-d9911b2fdd57', configMatchesValidatedRun: validatedConfig ? hashRecord(config) === hashRecord(validatedConfig) : false, freshProviderCalls: 0 },
  blockers,
};
console.log(JSON.stringify(result, null, 2));
await mkdir('data/evidence/remote0', { recursive: true });
await writeFile('data/evidence/remote0/config-audit.json', JSON.stringify(result, null, 2) + '\n');
if (result.blockers.length || !result.provider.configMatchesValidatedRun) process.exitCode = 1;
