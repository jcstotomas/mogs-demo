import { ProviderConfigSchema, type FactSnapshot, type Page, type Passage } from '../types';
import { providerEnvironment } from './env';
import { judgeWithJev } from './jev';
import { judgeWithFrontier } from './frontier';
export function runtimeProviderConfig() {
  const env = providerEnvironment();
  return ProviderConfigSchema.parse({ adapter: env.JUDGE_ADAPTER, connection: env.JUDGE_ADAPTER === 'jev' ? 'typesafe_http' : 'anthropic_direct', fixConnection: 'anthropic_direct', judgeModel: env.JUDGE_ADAPTER === 'jev' ? env.JEV_MODEL : env.FRONTIER_MODEL, fixModel: env.FIX_MODEL, tRel: env.T_REL, tLabel: env.T_LABEL, concurrency: env.JUDGE_CONCURRENCY, timeoutMs: env.PROVIDER_TIMEOUT_MS, promptVersion: env.JUDGE_ADAPTER === 'frontier' ? 'gate1-v2' : 'step0-v1' });
}
export function judge(runId: string, passage: Passage, page: Page, before: FactSnapshot, after: FactSnapshot) {
  const env = providerEnvironment();
  return env.JUDGE_ADAPTER === 'jev' ? judgeWithJev(runId, passage, page, before, after) : judgeWithFrontier(runId, passage, page, before, after);
}
export { fixWithFrontier } from './frontier';
