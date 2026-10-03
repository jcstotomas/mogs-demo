import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { AssetMetadataSchema, ClaimKindSchema, LabelSchema, ManifestRowSchema, RoleSchema, SurfaceSchema, type ManifestRow } from '../lib/types';
import { parseSource, passageIdFor } from '../lib/assets/source';
import { confirmedFacts, initialFacts, targetForKind } from '../lib/facts/derive';
import { hashRecord, sha256 } from '../lib/hash';

const DefinitionSchema = z.object({
  scenario: z.literal('mogs-starter-2026-10-03'), scope: z.literal('miniature-gate-1'), author: z.literal('agent'), split: z.literal('featured'),
  assets: z.array(z.object({ file: z.string(), surface: SurfaceSchema, meta: AssetMetadataSchema, blocks: z.array(z.object({ id: z.string(), role: RoleSchema, text: z.string(), kind: ClaimKindSchema, label: LabelSchema, replacement: z.string().optional(), withhold: z.string().optional(), template: z.string().optional() }).strict()).min(1) }).strict()).length(3),
}).strict();
async function main(): Promise<void> {
  const root = process.cwd(), contentRoot = path.join(root, 'content');
  const definitions = DefinitionSchema.parse(parse(await readFile(path.join(contentRoot, 'claims.yaml'), 'utf8')));
  const facts = confirmedFacts(initialFacts()), manifest: ManifestRow[] = [], sources: Record<string, { source: string; hash: string }> = {};
  for (const entry of definitions.assets) {
    const source = '---\n' + stringify(entry.meta).trimEnd() + '\n---\n\n' + entry.blocks.map(block => `<!-- source-id: ${block.id} role: ${block.role} -->\n${block.text}\n<!-- /source-id: ${block.id} -->`).join('\n\n') + '\n';
    const asset = parseSource(source, entry.file, entry.surface);
    await mkdir(path.dirname(path.join(contentRoot, entry.file)), { recursive: true });
    await writeFile(path.join(contentRoot, entry.file), source);
    sources[entry.file] = { source, hash: asset.sourceHash };
    for (const block of entry.blocks) {
      const urlPath = entry.surface === 'web' ? '/' + entry.file.slice(0, -3) : '/assets/' + entry.file.slice(0, -3);
      manifest.push(ManifestRowSchema.parse({ id: 'miniature:' + asset.assetId + '#' + block.id, passageId: passageIdFor(asset.assetId, block.id), sourceId: block.id, assetId: asset.assetId, url: 'http://localhost:3000' + urlPath, surface: entry.surface, text: block.text, kind: block.kind, templateId: block.template ?? 'miniature-' + entry.file.replaceAll('/', '-') + '-' + block.id, expectedLabel: block.label, target: block.replacement ? targetForKind(block.kind, facts) : null, expectedReplacement: block.replacement ?? null, expectedWithhold: block.withhold ?? null, split: definitions.split, author: definitions.author, scenarioId: definitions.scenario, expectedFactVersion: facts.version }));
    }
  }
  const manifestText = manifest.map(row => JSON.stringify(row)).join('\n') + '\n';
  await writeFile(path.join(contentRoot, 'manifest.jsonl'), manifestText);
  const initialFactSource = await readFile(path.join(root, 'data/seed/facts.json'), 'utf8');
  const seed = { format: 'mogs-content-seed-v1', scope: definitions.scope, sources, corpusHash: hashRecord(Object.entries(sources).map(([file, item]) => ({ file, hash: item.hash }))), manifestHash: sha256(manifestText), initialFactHash: sha256(initialFactSource) };
  await writeFile(path.join(contentRoot, 'seed.json'), JSON.stringify(seed, null, 2) + '\n');
  console.log(JSON.stringify({ scope: seed.scope, assets: definitions.assets.length, passages: manifest.length, corpusHash: seed.corpusHash, labelHash: seed.manifestHash }));
}
await main();
