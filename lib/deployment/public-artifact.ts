import { extractRenderedAsset, parseSource, renderSource } from '../assets/source';
import { deriveFacts } from '../facts/derive';
import { hashRecord, sha256 } from '../hash';
import { FactSnapshotSchema, type Surface } from '../types';
import { InventoryAssetSchema, type Baseline } from '../runs/remote-types';
import { DeploymentMetadataSchema } from './provenance';
import { renderCanonicalPricingFromFacts } from './pricing';

export const PUBLIC_ARTIFACT_VERSION = 'mogs-public-artifact-v1';
export const DEPLOYMENT_META_VERSION = 'mogs-deployment-meta-v1';
export const PUBLIC_REPOSITORY = 'jcstotomas/mogs-demo';
export const MINIATURE_SOURCE_FILES = ['email/eligible.md', 'email/onboarding.md', 'site/launch.md'] as const;
type InventoryAsset = Baseline['assets'][number];

interface SeedSource { source: string; hash: string }
interface SeedManifest {
  format: 'mogs-content-seed-v1';
  scope: string;
  sources: Record<string, SeedSource>;
  corpusHash: string;
  initialFactHash: string;
}

export type PublicBuildMode = 'seed' | 'commit';
export interface PublicArtifactInput {
  sourceCommit: string;
  mode: PublicBuildMode;
  seedManifestText: string;
  factText: string;
  /** Exact bytes from the source commit, decoded as UTF-8 by the caller. */
  sourceTexts?: Record<string, string>;
}
export interface PublicRoute {
  pathname: string;
  kind: 'web' | 'email' | 'pricing';
  title: string;
  sourceFile: string | null;
  sourceHash: string;
  sourceIds: string[];
  html: string;
}
export interface PublicArtifact {
  format: typeof PUBLIC_ARTIFACT_VERSION;
  contractVersion: 2;
  repository: typeof PUBLIC_REPOSITORY;
  scope: 'miniature';
  mode: PublicBuildMode;
  sourceCommit: string;
  factsHash: string;
  factsFileHash: string;
  inventoryHash: string;
  sourceHashes: Record<string, string>;
  assets: InventoryAsset[];
  routes: PublicRoute[];
}
export interface DeploymentMetadata {
  format: typeof DEPLOYMENT_META_VERSION;
  contractVersion: 2;
  repository: string;
  artifactHash: string;
  sourceCommit: string;
  factsHash: string;
  factsFileHash: string;
  inventoryHash: string;
  sourceHashes: Record<string, string>;
}

function parseSeedManifest(text: string): SeedManifest {
  const candidate: unknown = JSON.parse(text);
  if (!candidate || typeof candidate !== 'object') throw new Error('Seed manifest must be an object.');
  const seed = candidate as Partial<SeedManifest>;
  if (seed.format !== 'mogs-content-seed-v1' || seed.scope !== 'miniature-gate-1' || !seed.sources || typeof seed.sources !== 'object') throw new Error('Unsupported miniature seed manifest.');
  const files = Object.keys(seed.sources).sort();
  if (files.length !== MINIATURE_SOURCE_FILES.length || files.some((file, index) => file !== MINIATURE_SOURCE_FILES[index])) throw new Error('Miniature seed inventory changed.');
  for (const file of files) {
    const entry = seed.sources[file];
    if (!entry || typeof entry.source !== 'string' || !/^[a-f0-9]{64}$/.test(entry.hash) || sha256(entry.source) !== entry.hash) throw new Error('Seed source hash mismatch: ' + file);
  }
  const corpusHash = hashRecord(Object.entries(seed.sources).map(([file, item]) => ({ file, hash: item.hash })));
  if (seed.corpusHash !== corpusHash) throw new Error('Seed corpus hash mismatch.');
  if (!seed.initialFactHash || !/^[a-f0-9]{64}$/.test(seed.initialFactHash)) throw new Error('Missing seed fact hash.');
  return seed as SeedManifest;
}

function routeFor(file: string): string {
  return file.startsWith('site/') ? '/' + file.slice(0, -3) : '/assets/' + file.slice(0, -3);
}

function bodyOf(html: string): string {
  const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1];
  if (!body) throw new Error('Shared renderer produced no body.');
  return body;
}

function checkedRenderedRoute(route: PublicRoute): PublicRoute {
  const { page, passages } = extractRenderedAsset(route.html, 'https://public.invalid' + route.pathname, '2026-10-03T00:00:00.000Z');
  if (page.sourceHash !== route.sourceHash || page.file !== route.sourceFile || page.editable !== (route.kind !== 'pricing') || (route.kind !== 'pricing' && route.kind !== page.surface) || (route.kind === 'pricing' && route.pathname !== '/site/pricing')) throw new Error('Rendered asset metadata diverged: ' + route.pathname);
  const sourceIds = passages.map(passage => passage.sourceId);
  if (hashRecord(sourceIds) !== hashRecord(route.sourceIds)) throw new Error('Rendered source IDs diverged: ' + route.pathname);
  return route;
}

function inventoryAssetFor(route: PublicRoute): InventoryAsset {
  const { page, passages } = extractRenderedAsset(route.html, 'https://public.invalid' + route.pathname, '2026-10-03T00:00:00.000Z');
  return InventoryAssetSchema.parse({
    assetId: page.assetId,
    path: route.sourceFile === null ? null : 'content/' + route.sourceFile,
    pathname: route.pathname,
    surface: page.surface,
    editable: page.editable,
    sourceHash: page.sourceHash,
    metadataHash: page.metadataHash,
    sourceIds: passages.map(passage => passage.sourceId),
  });
}

/** Build a content-only artifact from exact commit inputs; no local files or environment are read. */
export function createPublicArtifact(input: PublicArtifactInput): PublicArtifact {
  if (!/^[a-f0-9]{40}$/.test(input.sourceCommit)) throw new Error('sourceCommit must be an exact Git commit SHA.');
  if (input.mode !== 'seed' && input.mode !== 'commit') throw new Error('Unsupported public build mode.');
  const seed = parseSeedManifest(input.seedManifestText);
  const facts = FactSnapshotSchema.parse(JSON.parse(input.factText));
  if (hashRecord(facts.derived) !== hashRecord(deriveFacts(facts))) throw new Error('Published derived facts are inconsistent.');
  if (input.mode === 'seed' && (sha256(input.factText) !== seed.initialFactHash || facts.phase !== 'initial')) throw new Error('Seed facts do not match the committed seed.');

  const sourceTexts = input.mode === 'seed'
    ? Object.fromEntries(Object.entries(seed.sources).map(([file, item]) => [file, item.source]))
    : input.sourceTexts;
  if (!sourceTexts) throw new Error('Commit mode requires source texts from the exact commit.');
  const files = Object.keys(sourceTexts).sort();
  if (files.length !== MINIATURE_SOURCE_FILES.length || files.some((file, index) => file !== MINIATURE_SOURCE_FILES[index])) throw new Error('Public source inventory changed.');

  const routes: PublicRoute[] = [];
  const sourceHashes: Record<string, string> = {};
  for (const file of files) {
    const surface: Surface = file.startsWith('site/') ? 'web' : 'email';
    const asset = parseSource(sourceTexts[file], file, surface);
    if (input.mode === 'seed' && asset.sourceHash !== seed.sources[file].hash) throw new Error('Seed source changed: ' + file);
    sourceHashes[file] = asset.sourceHash;
    routes.push(checkedRenderedRoute({
      pathname: routeFor(file), kind: surface, title: asset.meta.title,
      sourceFile: file, sourceHash: asset.sourceHash,
      sourceIds: asset.blocks.map(block => block.sourceId), html: bodyOf(renderSource(asset)),
    }));
  }

  const pricingHtml = renderCanonicalPricingFromFacts(facts);
  const pricingPage = extractRenderedAsset(pricingHtml, 'https://public.invalid/site/pricing', '2026-10-03T00:00:00.000Z');
  const factsHash = hashRecord(facts);
  routes.push(checkedRenderedRoute({
    pathname: '/site/pricing', kind: 'pricing', title: 'MOGS canonical pricing', sourceFile: null,
    sourceHash: factsHash, sourceIds: pricingPage.passages.map(passage => passage.sourceId), html: pricingHtml,
  }));
  routes.sort((a, b) => a.pathname.localeCompare(b.pathname));
  const assets = routes.map(inventoryAssetFor);
  return {
    format: PUBLIC_ARTIFACT_VERSION, contractVersion: 2, repository: PUBLIC_REPOSITORY,
    scope: 'miniature', mode: input.mode, sourceCommit: input.sourceCommit,
    factsHash, factsFileHash: sha256(input.factText), inventoryHash: hashRecord(assets),
    sourceHashes, assets, routes,
  };
}

/** Bind the exact generated artifact bytes and every source/fact identity. */
export function createDeploymentMetadata(artifactText: string): DeploymentMetadata {
  const artifact = JSON.parse(artifactText) as Partial<PublicArtifact>;
  if (artifact.format !== PUBLIC_ARTIFACT_VERSION || artifact.contractVersion !== 2 || artifact.repository !== PUBLIC_REPOSITORY || artifact.scope !== 'miniature' || !artifact.routes || !Array.isArray(artifact.routes) || !artifact.assets || !Array.isArray(artifact.assets)) throw new Error('Unsupported public artifact.');
  if (!artifact.sourceCommit || !/^[a-f0-9]{40}$/.test(artifact.sourceCommit) || !artifact.factsHash || !artifact.factsFileHash || !artifact.inventoryHash || !artifact.sourceHashes) throw new Error('Incomplete public artifact identity.');
  const routes = artifact.routes;
  const assets = artifact.assets.map(item => InventoryAssetSchema.parse(item));
  if (routes.length !== 4 || assets.length !== routes.length || hashRecord(assets) !== artifact.inventoryHash || routes.filter(route => route.pathname === '/site/pricing' && route.kind === 'pricing' && route.sourceFile === null).length !== 1) throw new Error('Public artifact inventory hash mismatch.');
  for (const route of routes) {
    checkedRenderedRoute(route);
    const expected = inventoryAssetFor(route);
    const stored = assets.find(item => item.pathname === route.pathname);
    if (!stored || hashRecord(expected) !== hashRecord(stored)) throw new Error('Public artifact route inventory mismatch: ' + route.pathname);
  }
  for (const file of MINIATURE_SOURCE_FILES) {
    const route = routes.find(item => item.sourceFile === file);
    if (!route || artifact.sourceHashes[file] !== route.sourceHash) throw new Error('Public artifact source hash mismatch: ' + file);
  }
  return DeploymentMetadataSchema.parse({
    format: DEPLOYMENT_META_VERSION, contractVersion: 2, repository: PUBLIC_REPOSITORY,
    artifactHash: sha256(artifactText), sourceCommit: artifact.sourceCommit,
    factsHash: artifact.factsHash, factsFileHash: artifact.factsFileHash,
    inventoryHash: artifact.inventoryHash, sourceHashes: artifact.sourceHashes,
  });
}
