import path from 'node:path';
import { spawnSync } from 'node:child_process';
// Trusted local dependencies, never resolved from the incoming PR or its scripts.
export const runtime = process.env.CODEX_ARTIFACT_RUNTIME || '/Users/jeremy/.cache/codex-runtimes/codex-primary-runtime/dependencies';
export const skill = process.env.CODEX_PRESENTATION_SKILL || '/Users/jeremy/.codex/plugins/cache/openai-primary-runtime/presentations/26.904.11930/skills/presentations';
process.env.RUNTIME_NODE_MODULES = path.join(runtime, 'node/node_modules');
export function run(executable,args) {
 const result=spawnSync(executable,args,{encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024,env:process.env});
 if(result.error || result.status!==0) throw new Error(`${path.basename(executable)} failed: ${result.error?.message || result.stderr || result.stdout}`);
 return result.stdout;
}
export const escapeHtml = value => String(value).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
