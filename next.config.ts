import type { NextConfig } from 'next';
const config: NextConfig = {
  serverExternalPackages: ['node:sqlite'], agentRules: false, distDir: process.env.MOGS_BUILD_DIR ?? '.next',
  outputFileTracingExcludes: { '/*': ['.env', '.env.*', 'data/**/*.db', 'data/**/*.db-*', 'data/evidence/**', '.next-gate1/**'] },
};
export default config;
