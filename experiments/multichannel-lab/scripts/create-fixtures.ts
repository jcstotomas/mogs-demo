import { assertEnabled } from '../src/gate.ts';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { hash } from '../src/contracts.ts';
assertEnabled();
const root=fileURLToPath(new URL('../',import.meta.url));
const manifestPath=resolve(root,'fixtures/manifest.json');
if (existsSync(manifestPath)) {
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  for (const entry of manifest.assets) {
    const bytes=readFileSync(resolve(root,'fixtures',entry.filename));
    if (hash(bytes)!==entry.sha256) throw new Error(`Frozen fixture changed: ${entry.filename}`);
  }
  console.log(`Frozen fixture corpus verified: ${manifest.assets.length} assets. Existing files were not regenerated.`);
} else {
  const bundled=resolve(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
  const python=process.env.MOGS_LAB_PYTHON || (existsSync(bundled) ? bundled : 'python3');
  const result=spawnSync(python,[resolve(root,'scripts/fixtures-python.py'),resolve(root,'fixtures')],{stdio:'inherit',timeout:30000});
  if (result.error) throw result.error;
  if (result.status!==0) process.exit(result.status || 1);
}
