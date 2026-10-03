import { execFileSync } from 'node:child_process';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeSource } from '../lib/assets/source';
import { createPublicArtifact, parseSeedManifest, type PublicBuildMode } from '../lib/deployment/public-artifact';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedRoot = path.join(repositoryRoot, 'apps/public/generated');

function options(): { mode: PublicBuildMode; sourceCommit: string } {
  let mode: PublicBuildMode = process.env.MOGS_PUBLIC_BUILD_SOURCE === 'seed' ? 'seed' : 'commit';
  let requestedCommit = process.env.VERCEL_GIT_COMMIT_SHA ?? '';
  for (const argument of process.argv.slice(2)) {
    if (argument === '--mode=seed') mode = 'seed';
    else if (argument === '--mode=commit') mode = 'commit';
    else if (argument.startsWith('--source-commit=')) requestedCommit = argument.slice('--source-commit='.length);
    else throw new Error('Unknown public bootstrap option: ' + argument);
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  const candidate = requestedCommit || head;
  if (!/^[a-f0-9]{40}$/.test(candidate)) throw new Error('sourceCommit must be a full commit SHA.');
  if (candidate !== head) throw new Error('sourceCommit does not match the build checkout HEAD.');
  const verified = execFileSync('git', ['rev-parse', '--verify', candidate + '^{commit}'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  if (verified !== candidate) throw new Error('sourceCommit does not resolve to the exact requested commit.');
  return { mode, sourceCommit: candidate };
}

function committedFile(sourceCommit: string, file: string): string {
  const bytes = execFileSync('git', ['show', sourceCommit + ':' + file], { cwd: repositoryRoot, maxBuffer: 20 * 1024 * 1024 });
  return decodeSource(bytes);
}

async function main(): Promise<void> {
  const { mode, sourceCommit } = options();
  const seedManifestText = committedFile(sourceCommit, 'content/seed.json');
  const factText = committedFile(sourceCommit, mode === 'seed' ? 'data/seed/facts.json' : 'data/facts.json');
  const sourceTexts = mode === 'commit'
    ? Object.fromEntries(Object.keys(parseSeedManifest(seedManifestText).sources).map(file => [file, committedFile(sourceCommit, 'content/' + file)]))
    : undefined;
  const artifact = createPublicArtifact({ sourceCommit, mode, seedManifestText, factText, sourceTexts });
  await mkdir(generatedRoot, { recursive: true });
  await rm(path.join(generatedRoot, 'deployment-meta.json'), { force: true });
  const temporary = path.join(generatedRoot, 'public-artifact.json.tmp');
  await writeFile(temporary, JSON.stringify(artifact, null, 2) + '\n', { flag: 'w' });
  await rename(temporary, path.join(generatedRoot, 'public-artifact.json'));
  console.log(JSON.stringify({ mode, sourceCommit, factsHash: artifact.factsHash, factsFileHash: artifact.factsFileHash, inventoryHash: artifact.inventoryHash, sources: artifact.sourceHashes, routes: artifact.routes.map(route => route.pathname) }));
}

await main();
