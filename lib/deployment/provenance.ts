import { load } from 'cheerio';
import { z } from 'zod';
import { extractRenderedAsset, parseSource, renderSource } from '../assets/source';
import { renderCanonicalPricingFromFacts } from './pricing';
import { BaselineSchema, ShaSchema, type Baseline } from '../runs/remote-types';
import { HashSchema, type FactSnapshot } from '../types';
import { hashRecord } from '../hash';

export const DeploymentMetadataSchema = z.object({
  format: z.literal('mogs-deployment-meta-v1'), artifactHash: HashSchema,
  contractVersion: z.literal(2), repository: z.string(), sourceCommit: ShaSchema,
  inventoryHash: HashSchema, factsHash: HashSchema, factsFileHash: HashSchema, sourceHashes: z.record(z.string(), HashSchema),
}).strict();
export function extractDeploymentMetadata(html: string) {
  const $ = load(html), metadata = $('#deployment-meta');
  if (metadata.length !== 1) throw new Error('One deployed revision record is required.');
  return DeploymentMetadataSchema.parse(JSON.parse(metadata.text()));
}
export function assertAllowedUrl(value: string, origins: string[], localTestOrigin?: string): URL {
  const url = new URL(value), local = localTestOrigin && url.origin === new URL(localTestOrigin).origin;
  if (url.username || url.password || url.hash || url.search || (!local && (url.protocol !== 'https:' || !origins.includes(url.origin))) || (local && !['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('URL is outside configured origins.');
  return url;
}
export async function observeBaseline(input: Baseline, options: { sources: Record<string, string>; publishedFacts: FactSnapshot; localTestOrigin?: string; fetch?: typeof fetch }): Promise<Baseline> {
  const baseline = BaselineSchema.parse(input);
  if (hashRecord(baseline.assets) !== baseline.inventoryHash) throw new Error('Inventory hash mismatch.');
  if (hashRecord(options.publishedFacts) !== baseline.factsHash) throw new Error('Pinned fact snapshot mismatch.');
  const request = options.fetch ?? fetch;
  for (const asset of baseline.assets) {
    const url = new URL(asset.pathname, options.localTestOrigin ?? baseline.target.productionOrigin);
    assertAllowedUrl(url.href, [new URL(baseline.target.productionOrigin).origin], options.localTestOrigin);
    const response = await request(url, { redirect: 'manual', cache: 'no-store', headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Asset fetch/extraction failed: ' + asset.pathname);
    const html = await response.text();
    if (Buffer.byteLength(html) > 2_000_000) throw new Error('Asset exceeds bounded response size.');
    const metadata = extractDeploymentMetadata(html), { page, passages } = extractRenderedAsset(html, url.href);
    const relativeFile = asset.path === null ? null : asset.path.slice('content/'.length);
    if (metadata.repository !== baseline.target.repository || metadata.sourceCommit !== baseline.deployedSha || metadata.inventoryHash !== baseline.inventoryHash || metadata.factsHash !== baseline.factsHash || metadata.factsFileHash !== baseline.factsFileHash || page.assetId !== asset.assetId || page.file !== relativeFile || page.surface !== asset.surface || page.editable !== asset.editable || page.sourceHash !== asset.sourceHash || page.metadataHash !== asset.metadataHash || hashRecord(passages.map(p => p.sourceId)) !== hashRecord(asset.sourceIds)) throw new Error('Deployed asset/revision differs from pinned baseline: ' + asset.pathname);
    const expectedHtml = relativeFile === null ? renderCanonicalPricingFromFacts(options.publishedFacts) : renderSource(parseSource(options.sources[relativeFile], relativeFile, asset.surface));
    const expected = extractRenderedAsset(expectedHtml, url.href);
    if (hashRecord(expected.passages.map(p => [p.id, p.role, p.text])) !== hashRecord(passages.map(p => [p.id, p.role, p.text]))) throw new Error('Rendered text differs from committed source: ' + asset.pathname);
  }
  return { ...baseline, observedAt: new Date().toISOString() };
}
