import { assetIdFor, extractRenderedAsset, parseSource, renderSource } from '../assets/source';
import { assertAllowedUrl, assertPublicChrome, extractDeploymentMetadata, renderedSourceBody } from '../deployment/provenance';
import { renderCanonicalPricingFromFacts } from '../deployment/pricing';
import { hashRecord, sha256 } from '../hash';
import { BaselineSchema, type Baseline } from '../runs/remote-types';
import { FactSnapshotSchema, type FactSnapshot } from '../types';
import type { CrawledScope } from './index';

export interface RemoteCrawlOptions {
  /** Exact content-relative UTF-8 source images from the pinned Git commit. */
  sources: Record<string, string>;
  /** The published snapshot in that commit, never the desired change. */
  publishedFacts: FactSnapshot;
  fetch?: typeof fetch;
  /** Explicit fixture seam. Live crawling requires the configured HTTPS origin. */
  localTestOrigin?: string;
}

const MAX_ASSET_BYTES = 2_000_000;

function checkedOrigin(value: string, local = false): URL {
  const url = new URL(value);
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password || (local
    ? url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    : url.protocol !== 'https:')) throw new Error('Remote crawl requires a plain configured origin.');
  return url;
}

async function boundedHtml(response: Response): Promise<string> {
  const declaredBytes = response.headers.get('content-length');
  if (declaredBytes && (!/^\d+$/.test(declaredBytes) || Number(declaredBytes) > MAX_ASSET_BYTES)) throw new Error('Asset exceeds bounded response size.');
  if (!response.body) throw new Error('Asset response has no body.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ASSET_BYTES) { await reader.cancel(); throw new Error('Asset exceeds bounded response size.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Crawl every pinned asset once. Public metadata alone cannot prove source text. */
export async function crawlRemoteScope(input: Baseline, options: RemoteCrawlOptions): Promise<CrawledScope> {
  const baseline = BaselineSchema.parse(input), facts = FactSnapshotSchema.parse(options.publishedFacts);
  const production = checkedOrigin(baseline.target.productionOrigin);
  const origin = options.localTestOrigin ? checkedOrigin(options.localTestOrigin, true) : production;
  if (hashRecord(baseline.assets) !== baseline.inventoryHash) throw new Error('Inventory hash mismatch.');
  if (hashRecord(facts) !== baseline.factsHash) throw new Error('Pinned published facts differ from baseline.');

  const sourceFiles = baseline.assets.flatMap(asset => asset.path === null ? [] : [asset.path.slice('content/'.length)]);
  if (new Set(sourceFiles).size !== sourceFiles.length || hashRecord(Object.keys(options.sources).sort()) !== hashRecord([...sourceFiles].sort())) throw new Error('Pinned source scope has missing, duplicate, or extra files.');
  const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, sha256(options.sources[file])]));
  const expected = baseline.assets.map(asset => {
    const file = asset.path === null ? null : asset.path.slice('content/'.length);
    if (file === null) {
      if (asset.assetId !== 'web:site/pricing.md' || asset.surface !== 'web' || asset.pathname !== '/site/pricing') throw new Error('Invalid canonical pricing identity.');
    } else if (asset.assetId !== assetIdFor(asset.surface, file) || asset.pathname !== (asset.surface === 'web' ? '/' : '/assets/') + file.slice(0, -3) || asset.sourceHash !== sourceHashes[file]) throw new Error('Pinned source identity or hash mismatch: ' + asset.pathname);
    const url = new URL(asset.pathname, origin);
    if (url.pathname !== asset.pathname) throw new Error('Asset route is not normalized.');
    assertAllowedUrl(url.href, [production.origin], options.localTestOrigin);
    const html = file === null ? renderCanonicalPricingFromFacts(facts) : renderSource(parseSource(options.sources[file], file, asset.surface));
    const extracted = extractRenderedAsset(html, url.href);
    if (extracted.page.sourceHash !== asset.sourceHash || extracted.page.metadataHash !== asset.metadataHash || hashRecord(extracted.passages.map(p => p.sourceId)) !== hashRecord(asset.sourceIds)) throw new Error('Pinned source render differs from baseline: ' + asset.pathname);
    return { asset, file, url, html, extracted };
  });

  const request = options.fetch ?? fetch, crawledAt = new Date().toISOString();
  const results = await Promise.all(expected.map(async item => {
    const response = await request(item.url, { cache: 'no-store', redirect: 'manual', headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok || response.redirected || !response.headers.get('content-type')?.split(';')[0].trim().toLowerCase().match(/^text\/html$/) || (response.url ? response.url !== item.url.href : !options.fetch)) throw new Error('Asset fetch/extraction failed: ' + item.asset.pathname + ' (' + response.status + ').');
    const html = await boundedHtml(response), metadata = extractDeploymentMetadata(html);
    const extracted = extractRenderedAsset(html, item.url.href, crawledAt), { page, passages } = extracted;
    if (metadata.repository !== baseline.target.repository || metadata.sourceCommit !== baseline.deployedSha || metadata.inventoryHash !== baseline.inventoryHash || metadata.factsHash !== baseline.factsHash || metadata.factsFileHash !== baseline.factsFileHash || hashRecord(metadata.sourceHashes) !== hashRecord(sourceHashes) || page.assetId !== item.asset.assetId || page.file !== item.file || page.surface !== item.asset.surface || page.editable !== item.asset.editable || page.sourceHash !== item.asset.sourceHash || page.metadataHash !== item.asset.metadataHash || hashRecord(passages.map(p => p.sourceId)) !== hashRecord(item.asset.sourceIds)) throw new Error('Deployed asset/revision differs from pinned baseline: ' + item.asset.pathname);
    const identity = (rows: typeof passages) => rows.map(({ id, role, text, blockHash, contextHash, heading, before, after }) => ({ id, role, text, blockHash, contextHash, heading, before, after }));
    if (renderedSourceBody(html) !== renderedSourceBody(item.html) || hashRecord(identity(passages)) !== hashRecord(identity(item.extracted.passages))) throw new Error('Rendered text/context differs from pinned source: ' + item.asset.pathname);
    assertPublicChrome(html, item.extracted.page.meta.title, item.asset.surface === 'email', baseline.deployedSha, !options.fetch && !options.localTestOrigin);
    return { ...extracted, artifactHash: metadata.artifactHash };
  }));
  const pages = results.map(result => result.page), passages = results.flatMap(result => result.passages);
  if (new Set(results.map(result => result.artifactHash)).size !== 1) throw new Error('Assets resolved different deployment artifacts.');
  if (new Set(pages.map(page => page.assetId)).size !== pages.length || new Set(passages.map(passage => passage.id)).size !== passages.length || passages.length !== baseline.assets.reduce((sum, asset) => sum + asset.sourceIds.length, 0)) throw new Error('Crawl resolved duplicate or missing identities.');
  return { pages, passages };
}
