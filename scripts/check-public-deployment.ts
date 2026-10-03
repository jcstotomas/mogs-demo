import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { load } from 'cheerio';
import { decodeSource, extractRenderedAsset } from '../lib/assets/source';
import { hashRecord } from '../lib/hash';
import { assertAllowedUrl, assertPublicChrome, extractDeploymentMetadata, renderedSourceBody } from '../lib/deployment/provenance';
import { createDeploymentMetadata, createPublicArtifact, MINIATURE_SOURCE_FILES } from '../lib/deployment/public-artifact';
import { loadLocalEnv } from '../lib/providers/env';

// Anonymous readback; hosting/Git identity is independently recorded by the deployment audit.
loadLocalEnv();
const audit = JSON.parse(await readFile('docs/remote0/public-deployment.json', 'utf8'));
const sourceRoot = process.env.MOGS_REMOTE_SOURCE_ROOT ?? 'data/remote/source';
const sourceCommit = audit.artifact.sourceCommit as string;
const origin = new URL(audit.vercel.productionUrl).origin;
assertAllowedUrl(origin, [origin]);
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Exact deployed Git commit is required.');
const committed = (file: string) => decodeSource(execFileSync('git', ['-C', sourceRoot, 'show', sourceCommit + ':' + file], { maxBuffer: 20_000_000 }));
const artifact = createPublicArtifact({ sourceCommit, mode: 'commit', seedManifestText: committed('content/seed.json'), factText: committed('data/facts.json'), sourceTexts: Object.fromEntries(MINIATURE_SOURCE_FILES.map(file => [file, committed('content/' + file)])) });
const metadata = createDeploymentMetadata(JSON.stringify(artifact, null, 2) + '\n');
const results: { pathname: string; status: number; sourceHash: string; passages: number }[] = [];
const request = (pathname: string) => fetch(assertAllowedUrl(new URL(pathname, origin).href, [origin]), { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
for (const route of artifact.routes) {
  const response = await request(route.pathname), html = await response.text();
  if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html') || Buffer.byteLength(html) > 2_000_000) throw new Error('Public asset unavailable: ' + route.pathname);
  if (hashRecord(extractDeploymentMetadata(html)) !== hashRecord(metadata)) throw new Error('Deployed metadata differs from exact committed artifact: ' + route.pathname);
  const actual = extractRenderedAsset(html, origin + route.pathname), expected = extractRenderedAsset(route.html, origin + route.pathname);
  const identity = (asset: ReturnType<typeof extractRenderedAsset>) => ({ assetId: asset.page.assetId, file: asset.page.file, editable: asset.page.editable, surface: asset.page.surface, sourceHash: asset.page.sourceHash, metadataHash: asset.page.metadataHash, blocks: asset.passages.map(block => [block.id, block.sourceId, block.role, block.text]) });
  if (hashRecord(identity(actual)) !== hashRecord(identity(expected))) throw new Error('Rendered public text/IDs differ from exact Git bytes: ' + route.pathname);
  if (renderedSourceBody(html) !== renderedSourceBody(route.html)) throw new Error('Unmarked public source content differs: ' + route.pathname);
  assertPublicChrome(html, route.title, route.kind === 'email', sourceCommit, true);
  results.push({ pathname: route.pathname, status: response.status, sourceHash: actual.page.sourceHash, passages: actual.passages.length });
}
const sitemapResponse = await request('/sitemap.xml');
if (sitemapResponse.status !== 200) throw new Error('Public sitemap unavailable.');
const sitemap = load(await sitemapResponse.text(), { xmlMode: true });
const links = sitemap('loc').map((_index, element) => sitemap(element).text()).get().sort();
if (hashRecord(links) !== hashRecord(artifact.routes.map(route => origin + route.pathname).sort())) throw new Error('Sitemap must contain exactly the four public production URLs.');
const exclusions = [];
for (const pathname of ['/console', '/api/facts', '/api/v2/runs', '/data/app.db', '/data/facts.json', '/.env.local', '/SPEC.md', '/generated/public-artifact.json']) {
  const response = await request(pathname);
  if (response.status !== 404) throw new Error('Nonpublic path was not excluded: ' + pathname);
  exclusions.push({ pathname, status: response.status });
}
const evidence = { contractVersion: 2, checkedAt: new Date().toISOString(), sourceCommit, deploymentId: audit.vercel.deploymentId, origin, metadata, results, sitemap: links, exclusions, pass: true, freshProviderCalls: 0, note: 'Anonymous readback of all four miniature assets against exact committed source/fact/artifact bytes. This proves baseline rendering and route isolation, not semantic correction, PR preview, merge enforcement, or the 22-asset gate.' };
await mkdir('data/evidence/remote0', { recursive: true });
await writeFile('data/evidence/remote0/public-readback.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
