import { z } from 'zod';
import { extractRenderedAsset } from '../assets/source';
import { confirmedFacts, targetForKind } from '../facts/derive';
import { createPublicArtifact } from '../deployment/public-artifact';
import { hashRecord, sha256 } from '../hash';
import { ShaSchema } from '../runs/remote-types';
import { FactSnapshotSchema, HashSchema, ManifestRowSchema } from '../types';
import { assertCoverageResolution, CoverageRegistrySchema, DETERMINISTIC_KINDS } from './coverage-contract';

const SeedSchema = z.object({ format: z.literal('mogs-content-seed-v1'), scope: z.enum(['miniature-gate-1', 'required-22']), sources: z.record(z.string(), z.object({ source: z.string(), hash: HashSchema }).strict()), corpusHash: HashSchema, manifestHash: HashSchema, initialFactHash: HashSchema }).strict();

export interface MiniaturePreparationInput {
  sourceCommit: string;
  seedManifestText: string;
  seedFactsText: string;
  manifestText: string;
  registryText: string;
}

/** Validate isolated preparation inputs. This does not judge, approve or score any run. */
function prepareEvaluation(input: MiniaturePreparationInput, scope: 'miniature-gate-1' | 'required-22') {
  const sourceCommit = ShaSchema.parse(input.sourceCommit), seed = SeedSchema.parse(JSON.parse(input.seedManifestText));
  if (seed.scope !== scope) throw new Error('Preparation scope does not match the requested frozen corpus.');
  const required = scope === 'required-22';
  const beforeFacts = FactSnapshotSchema.parse(JSON.parse(input.seedFactsText)), desiredFacts = confirmedFacts(beforeFacts);
  const registry = CoverageRegistrySchema.parse(JSON.parse(input.registryText));
  if (beforeFacts.phase !== 'initial' || beforeFacts.version !== 1 || sha256(input.seedFactsText) !== seed.initialFactHash || sha256(input.manifestText) !== seed.manifestHash) throw new Error('Preparation requires the pristine frozen seed and labels.');
  if ((registry.evidenceKind === 'fixture' ? registry.sourceCommit !== null : registry.sourceCommit === null) || registry.corpusHash !== seed.corpusHash || registry.labelHash !== seed.manifestHash || registry.factHash !== hashRecord(desiredFacts) || registry.scenarioId !== desiredFacts.scenarioId) throw new Error('Registry is not bound to the seed, labels and explicit desired facts.');
  if (!required && (registry.cases.some(item => item.split !== 'featured') || registry.families.some(family => family.split !== 'featured'))) throw new Error('This preparation supports only the featured miniature; held-out corpus expansion is deferred.');
  const manifest = input.manifestText.trim().split('\n').map(line => ManifestRowSchema.parse(JSON.parse(line)));
  const artifact = createPublicArtifact({ sourceCommit, mode: 'seed', seedManifestText: input.seedManifestText, factText: input.seedFactsText });
  const extracted = artifact.routes.map(route => extractRenderedAsset(route.html, 'http://127.0.0.1:3100' + route.pathname));
  const editablePages = extracted.map(item => item.page).filter(page => page.editable), editablePassages = extracted.flatMap(item => item.passages).filter(p => p.editable);
  assertCoverageResolution(registry, editablePassages, editablePages);
  if (manifest.length !== registry.cases.length || new Set(manifest.map(row => row.passageId)).size !== manifest.length) throw new Error('Manifest rows must resolve exactly once.');
  for (const row of manifest) {
    const expected = registry.cases.find(item => item.passageId === row.passageId);
    if (!expected || row.expectedFactVersion !== desiredFacts.version || row.scenarioId !== desiredFacts.scenarioId || row.assetId !== expected.assetId || row.sourceId !== expected.sourceId || row.surface !== expected.surface || row.text !== expected.text || row.kind !== expected.kind || row.expectedLabel !== expected.expectedLabel || row.expectedReplacement !== expected.expectedReplacement || row.expectedWithhold !== expected.expectedWithhold || row.split !== expected.split || row.author !== expected.authoredBy || row.templateId !== expected.templateId || hashRecord(row.target) !== hashRecord(expected.target)) throw new Error('Manifest/registry label mismatch: ' + row.passageId);
  }
  for (const kind of DETERMINISTIC_KINDS) if (hashRecord(registry.targets[kind]) !== hashRecord(targetForKind(kind, desiredFacts))) throw new Error('Expected target differs from explicit desired facts: ' + kind);
  if (required && (editablePages.length !== 21 || artifact.assets.length !== 22 || artifact.assets.filter(item => item.surface === 'web').length !== 20 || artifact.assets.filter(item => item.surface === 'email').length !== 2)) throw new Error('Required preparation needs exactly 20 web assets and two email previews.');
  const independentHeldout = DETERMINISTIC_KINDS.map(kind => ({ kind, families: registry.families.filter(family => family.kind === kind && family.split === 'heldout' && family.representativePassageId !== null).length, requiredFamilies: 5, eligibility: registry.families.filter(family => family.kind === kind && family.split === 'heldout' && family.representativePassageId !== null).length >= 5 ? 'eligible' as const : 'not_eligible' as const }));
  if (required && independentHeldout.some(item => item.families !== 5)) throw new Error('Required preparation needs five preselected held-out representatives per kind.');
  return {
    sources: Object.fromEntries(Object.entries(seed.sources).map(([file, item]) => [file, item.source])),
    beforeFacts, desiredFacts, registry, artifact,
    summary: {
      format: required ? 'mogs-required-22-evaluation-preparation-v1' as const : 'mogs-miniature-evaluation-preparation-v1' as const,
      status: 'prepared' as const, evidenceKind: 'fixture_preparation' as const,
      notice: 'Pristine synthetic ' + (required ? 'required 22-asset corpus' : 'miniature') + ' preparation only. No provider, evaluation, approval, submission or deployment has run.',
      sourceCommit, corpusHash: seed.corpusHash, labelHash: seed.manifestHash, registryHash: registry.registryHash,
      beforeFactsHash: hashRecord(beforeFacts), desiredFactsHash: hashRecord(desiredFacts), factsFileHash: seed.initialFactHash,
      scope: { editableAssets: editablePages.length, editablePassages: editablePassages.length, canonicalPricingAssets: 1, allAssets: artifact.assets.length, allPassages: extracted.flatMap(item => item.passages).length },
      expected: { featuredCases: registry.cases.filter(item => item.split === 'featured').length, contradictions: registry.cases.filter(item => item.expectedLabel === 'contradicting').length, deterministicRepairs: registry.cases.filter(item => item.expectedReplacement !== null).length, withheld: registry.cases.filter(item => item.expectedWithhold !== null).length },
      independentHeldout,
      evaluationRunId: null, providerConfiguration: null, publicationMode: null, servedOrigin: null, metrics: null,
    },
  };
}

/** Keep the original miniature preparation bound to its preserved source and label images. */
export function prepareMiniatureEvaluation(input: MiniaturePreparationInput) { return prepareEvaluation(input, 'miniature-gate-1'); }

/** Freeze required-scope preparation and independent denominators without provider execution or scoring. */
export function prepareRequiredEvaluation(input: MiniaturePreparationInput) { return prepareEvaluation(input, 'required-22'); }
