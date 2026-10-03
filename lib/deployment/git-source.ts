import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { parseSeedManifest, createPublicArtifact } from './public-artifact';
import { FactSnapshotSchema } from '../types';
import { decodeSource } from '../assets/source';

const execute = promisify(execFile);
export async function readRemoteSourceSnapshot(repository: string, sha: string, options: { fetch?: boolean; root?: string } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('Exact configured repository and commit are required.');
  const root = path.resolve(options.root ?? process.env.MOGS_REMOTE_SOURCE_ROOT ?? 'data/remote/source');
  async function git(args: string[]) { try { return decodeSource((await execute('git', ['-C', root, ...args], { encoding: 'buffer', maxBuffer: 8_000_000, timeout: 30_000 })).stdout); } catch { throw new Error('Pinned remote source checkout is unavailable or incomplete.'); } }
  const remote = (await git(['remote', 'get-url', 'origin'])).trim().replace(/\.git$/, '');
  if (remote.toLowerCase() !== ('https://github.com/' + repository).toLowerCase()) throw new Error('Isolated source checkout origin does not match the configured GitHub repository.');
  if (options.fetch !== false) await git(['fetch', 'origin', '--no-tags']);
  const committed = (file: string) => git(['show', sha + ':' + file]);
  const [seedManifestText, factText] = await Promise.all([committed('content/seed.json'), committed('data/facts.json')]);
  const seed = parseSeedManifest(seedManifestText);
  const sourceEntries = await Promise.all(Object.keys(seed.sources).map(async file => [file, await committed('content/' + file)] as const));
  const sources = Object.fromEntries(sourceEntries), publishedFacts = FactSnapshotSchema.parse(JSON.parse(factText));
  const artifact = createPublicArtifact({ sourceCommit: sha, mode: 'commit', seedManifestText, factText, sourceTexts: sources });
  return { sources, publishedFacts, factText, seedManifestText, artifact, artifactText: JSON.stringify(artifact, null, 2) + '\n' };
}
