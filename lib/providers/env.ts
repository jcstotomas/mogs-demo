import { existsSync } from 'node:fs';
import { z } from 'zod';
export function loadLocalEnv(): void { for (const file of ['.env.local', '.env']) if (existsSync(file)) process.loadEnvFile(file); }
export const EnvironmentSchema = z.object({
  JUDGE_ADAPTER: z.enum(['jev', 'frontier']).default('frontier'), JEV_MODEL: z.string().default('jev-1.13.0'), FRONTIER_MODEL: z.string().default('claude-sonnet-5-5'), FIX_MODEL: z.string().default('claude-sonnet-5-5'),
  T_REL: z.coerce.number().min(0).max(1).default(0.2), T_LABEL: z.coerce.number().min(0).max(1).default(0.7), JUDGE_CONCURRENCY: z.coerce.number().int().positive().default(4), PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
});
export function providerEnvironment() { const env = { ...process.env }; if (env.JUDGE_ADAPTER === '') delete env.JUDGE_ADAPTER; return EnvironmentSchema.parse(env); }
