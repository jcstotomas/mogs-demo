import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { FactSnapshotSchema, type Surface } from '../types';
import { renderCanonicalPricingFromFacts } from '../deployment/pricing';
import { decodeSource, parseSource, renderSource, type SourceAsset } from './source';

export const CONTENT_ROOT = path.resolve(process.env.MOGS_CONTENT_ROOT ?? 'content');
export interface AssetEntry { file: string; surface: Surface; pathname: string }
export async function listAssetEntries(): Promise<AssetEntry[]> {
  const entries: AssetEntry[] = [];
  async function visit(directory: string, surface: Surface): Promise<void> {
    for (const entry of await readdir(path.join(CONTENT_ROOT, directory), { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const file = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file, surface);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        const stem = file.slice(0, -3);
        const pathname = surface === 'web' ? '/' + stem : '/assets/' + stem;
        if (pathname === '/site/pricing') throw new Error('Canonical pricing must not have editable source.');
        entries.push({ file, surface, pathname });
      }
    }
  }
  await Promise.all([visit('site', 'web'), visit('email', 'email')]);
  return entries.sort((a, b) => a.pathname.localeCompare(b.pathname));
}
export async function readSourceAsset(file: string, surface: Surface): Promise<SourceAsset> {
  const source = decodeSource(await readFile(path.join(CONTENT_ROOT, file)));
  return parseSource(source, file, surface);
}
export function renderedBody(asset: SourceAsset): string {
  const html = renderSource(asset), match = /<body>([\s\S]*)<\/body>/.exec(html);
  if (!match) throw new Error('Shared renderer did not produce an asset body.');
  return match[1];
}
export async function renderCanonicalPricing(): Promise<string> {
  const facts = FactSnapshotSchema.parse(JSON.parse(await readFile(path.resolve(process.env.MOGS_FACTS_PATH ?? 'data/facts.json'), 'utf8')));
  return renderCanonicalPricingFromFacts(facts);
}
