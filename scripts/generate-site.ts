import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { AssetMetadataSchema, ClaimKindSchema, LabelSchema, ManifestRowSchema, RoleSchema, SurfaceSchema, type ManifestRow } from '../lib/types';
import { parseSource, passageIdFor } from '../lib/assets/source';
import { confirmedFacts, initialFacts, targetForKind } from '../lib/facts/derive';
import { hashRecord, sha256 } from '../lib/hash';
import { DETERMINISTIC_KINDS, freezeCoverageRegistry, type CoverageCase, type CoverageFamily } from '../lib/metrics/coverage-contract';

const SplitSchema = z.enum(['featured', 'tuning', 'heldout']);
const DefinitionSchema = z.object({
  scenario: z.literal('mogs-starter-2026-10-03'), scope: z.enum(['miniature-gate-1', 'required-22']), author: z.literal('agent'), split: SplitSchema,
  rubricNotes: z.array(z.string()).optional(),
  assets: z.array(z.object({ file: z.string().regex(/^(site|email)\/[a-z][a-z0-9-]*\.md$/), surface: SurfaceSchema, meta: AssetMetadataSchema, blocks: z.array(z.object({ id: z.string(), role: RoleSchema, text: z.string(), kind: ClaimKindSchema, label: LabelSchema, replacement: z.string().optional(), withhold: z.string().optional(), template: z.string().optional(), family: z.string().optional(), split: SplitSchema.optional(), representative: z.boolean().optional() }).strict()).min(1) }).strict()).min(3),
}).strict();

async function main(): Promise<void> {
  const root = process.cwd(), contentRoot = path.join(root, 'content');
  const args = process.argv.slice(2);
  if (args.length > 1 || args.length === 1 && !/^--freeze-at=[a-f0-9]{40}$/.test(args[0])) throw new Error('Use --freeze-at=<full source commit> only after committing the generated corpus.');
  const sourceCommit = args.length ? args[0].slice('--freeze-at='.length) : null;
  const definitions = DefinitionSchema.parse(parse(await readFile(path.join(contentRoot, 'claims.yaml'), 'utf8')));
  const required = definitions.scope === 'required-22';
  if (new Set(definitions.assets.map(item => item.file)).size !== definitions.assets.length || definitions.assets.some(item => item.surface !== (item.file.startsWith('site/') ? 'web' : 'email'))) throw new Error('Definition source inventory has duplicate or mismatched surfaces.');
  if (required ? definitions.assets.length !== 21 || definitions.assets.filter(item => item.surface === 'web').length !== 19 || definitions.assets.filter(item => item.surface === 'email').length !== 2 : definitions.assets.length !== 3) throw new Error('Definition inventory does not match its frozen scope.');
  const facts = confirmedFacts(initialFacts()), manifest: ManifestRow[] = [], sources: Record<string, { source: string; hash: string }> = {};
  const cases: CoverageCase[] = [], families = new Map<string, CoverageFamily>(), assets: Array<{ assetId: string; surface: 'web' | 'email'; editable: boolean; sourceHash: string }> = [];
  for (const entry of definitions.assets) {
    const source = '---\n' + stringify(entry.meta).trimEnd() + '\n---\n\n' + entry.blocks.map(block => `<!-- source-id: ${block.id} role: ${block.role} -->\n${block.text}\n<!-- /source-id: ${block.id} -->`).join('\n\n') + '\n';
    const asset = parseSource(source, entry.file, entry.surface);
    await mkdir(path.dirname(path.join(contentRoot, entry.file)), { recursive: true });
    await writeFile(path.join(contentRoot, entry.file), source);
    sources[entry.file] = { source, hash: asset.sourceHash };
    assets.push({ assetId: asset.assetId, surface: entry.surface, editable: true, sourceHash: asset.sourceHash });
    for (const block of entry.blocks) {
      const urlPath = entry.surface === 'web' ? '/' + entry.file.slice(0, -3) : '/assets/' + entry.file.slice(0, -3);
      const split = block.split ?? definitions.split, familyId = block.family ?? 'miniature-' + entry.file.replaceAll('/', '-') + '-' + block.id, templateId = block.template ?? familyId;
      const row = ManifestRowSchema.parse({ id: (required ? 'required-22:' : 'miniature:') + asset.assetId + '#' + block.id, passageId: passageIdFor(asset.assetId, block.id), sourceId: block.id, assetId: asset.assetId, url: 'http://localhost:3000' + urlPath, surface: entry.surface, text: block.text, kind: block.kind, templateId, expectedLabel: block.label, target: block.replacement ? targetForKind(block.kind, facts) : null, expectedReplacement: block.replacement ?? null, expectedWithhold: block.withhold ?? null, split, author: definitions.author, scenarioId: definitions.scenario, expectedFactVersion: facts.version });
      manifest.push(row);
      cases.push({ passageId: row.passageId, sourceId: row.sourceId, assetId: row.assetId, surface: row.surface, editable: true, text: row.text, textHash: sha256(row.text), kind: row.kind, expectedLabel: row.expectedLabel, target: row.target, expectedReplacement: row.expectedReplacement, expectedWithhold: row.expectedWithhold, familyId, templateId, split, authoredBy: row.author });
      const family = families.get(familyId) ?? { familyId, kind: row.kind, templateId: familyId, split, authoredBy: row.author, memberPassageIds: [], representativePassageId: null };
      if (family.kind !== row.kind || family.split !== split) throw new Error('A family cannot cross kind or split: ' + familyId);
      family.memberPassageIds.push(row.passageId);
      if (block.representative) {
        if (family.representativePassageId !== null) throw new Error('Duplicate family representative: ' + familyId);
        family.representativePassageId = row.passageId;
      }
      families.set(familyId, family);
    }
  }
  const manifestText = manifest.map(row => JSON.stringify(row)).join('\n') + '\n';
  await writeFile(path.join(contentRoot, 'manifest.jsonl'), manifestText);
  const initialFactSource = await readFile(path.join(root, 'data/seed/facts.json'), 'utf8');
  const seed = { format: 'mogs-content-seed-v1', scope: definitions.scope, sources, corpusHash: hashRecord(Object.entries(sources).map(([file, item]) => ({ file, hash: item.hash }))), manifestHash: sha256(manifestText), initialFactHash: sha256(initialFactSource) };
  const seedText = JSON.stringify(seed, null, 2) + '\n';
  await writeFile(path.join(contentRoot, 'seed.json'), seedText);
  if (required) {
    if (sourceCommit !== null) {
      const committed = (file: string) => execFileSync('git', ['show', sourceCommit + ':' + file], { cwd: root, encoding: 'utf8', maxBuffer: 5_000_000 });
      if (committed('content/seed.json') !== seedText || committed('content/manifest.jsonl') !== manifestText || committed('data/seed/facts.json') !== initialFactSource || Object.entries(sources).some(([file, item]) => committed('content/' + file) !== item.source)) throw new Error('Frozen corpus source commit must contain the exact generated seed, labels, facts and source bytes.');
    }
    const registry = freezeCoverageRegistry({ contractVersion: 'remote0-coverage-v1', id: 'mogs-required-22-v1', evidenceKind: sourceCommit === null ? 'fixture' : 'frozen_corpus', scenarioId: definitions.scenario, sourceCommit, corpusHash: seed.corpusHash, labelHash: seed.manifestHash, factHash: hashRecord(facts), targets: Object.fromEntries(DETERMINISTIC_KINDS.map(kind => [kind, targetForKind(kind, facts)!])) as Parameters<typeof freezeCoverageRegistry>[0]['targets'], assets, families: [...families.values()], cases });
    const independent = DETERMINISTIC_KINDS.map(kind => ({ kind, heldout: registry.families.filter(family => family.kind === kind && family.representativePassageId !== null).length }));
    if (independent.some(item => item.heldout !== 5)) throw new Error('Required coverage needs exactly five preselected representatives per deterministic kind.');
    await writeFile(path.join(root, 'fixtures/remote/coverage-required-22.json'), JSON.stringify(registry, null, 2) + '\n');
  }
  console.log(JSON.stringify({ scope: seed.scope, editableAssets: definitions.assets.length, webAssets: definitions.assets.filter(item => item.surface === 'web').length + 1, emailAssets: definitions.assets.filter(item => item.surface === 'email').length, editablePassages: manifest.length, contradictions: manifest.filter(row => row.expectedLabel === 'contradicting').length, deterministicRepairs: manifest.filter(row => row.expectedReplacement !== null).length, withheld: manifest.filter(row => row.expectedWithhold !== null).length, corpusHash: seed.corpusHash, labelHash: seed.manifestHash }));
}
await main();
