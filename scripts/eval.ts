import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { prepareMiniatureEvaluation } from '../lib/metrics/remote-preparation';
import { RemoteDatabase } from '../lib/runs/remote-db';
import { ShaSchema } from '../lib/runs/remote-types';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== '--prepare') throw new Error('Use npm run eval -- --prepare for isolated miniature preparation. Evaluation/scoring is pending the named remote run and frozen full-scope handoff.');
  const root = process.cwd();
  const sourceCommit = ShaSchema.parse(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
  const readPinned = (file: string) => execFileSync('git', ['show', sourceCommit + ':' + file], { cwd: root, encoding: 'utf8', maxBuffer: 5_000_000 });
  const seedManifestText = readPinned('content/seed.json'), seedFactsText = readPinned('data/seed/facts.json'), manifestText = readPinned('content/manifest.jsonl'), registryText = readPinned('fixtures/remote/coverage-miniature.json');
  const prepared = prepareMiniatureEvaluation({ sourceCommit, seedManifestText, seedFactsText, manifestText, registryText });
  const preparationId = randomUUID(), directory = path.join(root, 'data/eval', preparationId), sourceRoot = path.join(directory, 'source');
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory, { recursive: false });
  for (const [file, source] of Object.entries(prepared.sources)) {
    const destination = path.join(sourceRoot, 'content', file);
    await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, source, { flag: 'wx' });
  }
  await mkdir(path.join(sourceRoot, 'data/seed'), { recursive: true });
  await writeFile(path.join(sourceRoot, 'content/seed.json'), seedManifestText, { flag: 'wx' });
  await writeFile(path.join(sourceRoot, 'data/facts.json'), seedFactsText, { flag: 'wx' });
  await writeFile(path.join(sourceRoot, 'data/seed/facts.json'), seedFactsText, { flag: 'wx' });
  await writeFile(path.join(directory, 'manifest.jsonl'), manifestText, { flag: 'wx' });
  await writeFile(path.join(directory, 'coverage-registry.json'), registryText, { flag: 'wx' });
  await writeFile(path.join(directory, 'desired-facts.json'), JSON.stringify(prepared.desiredFacts, null, 2) + '\n', { flag: 'wx' });
  const databasePath = path.join(directory, 'app.db');
  const database = new RemoteDatabase(databasePath); database.close();
  const summary = { ...prepared.summary, preparationId, sourceRoot, databasePath, createdAt: new Date().toISOString() };
  await writeFile(path.join(directory, 'preparation.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  // Preparation has no evaluated metrics and never replaces data/eval/latest.json.
  console.log(JSON.stringify(summary, null, 2));
}
await main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
