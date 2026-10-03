import { load } from 'cheerio';
import { assetIdFor, extractRenderedAsset } from '../assets/source';
import type { Page, Passage } from '../types';

export interface CrawledScope { pages: Page[]; passages: Passage[] }
function checkedUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('Crawl scope requires plain local HTTP asset URLs.');
  if (!/^\/site\/[a-z0-9/-]+$/.test(url.pathname) && !/^\/assets\/email\/[a-z0-9-]+$/.test(url.pathname)) throw new Error('URL is not an enabled asset route.');
  return url;
}
export async function crawlScope(urls: string[]): Promise<CrawledScope> {
  if (!urls.length || new Set(urls).size !== urls.length) throw new Error('Crawl scope must contain unique assets.');
  const parsed = urls.map(checkedUrl);
  if (new Set(parsed.map(url => url.origin)).size !== 1 || new Set(parsed.map(url => url.href)).size !== urls.length) throw new Error('Crawl scope must use one origin and unique normalized URLs.');
  const results = await Promise.all(urls.map(async url => {
    const response = await fetch(url, { cache: 'no-store', redirect: 'error', headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Asset fetch failed: ' + url + ' (' + response.status + ').');
    const extracted = extractRenderedAsset(await response.text(), url);
    const pathname = new URL(url).pathname;
    const surface = pathname.startsWith('/site/') ? 'web' : 'email';
    const file = surface === 'web' ? pathname.slice(1) + '.md' : pathname.slice('/assets/'.length) + '.md';
    if (extracted.page.surface !== surface || extracted.page.assetId !== assetIdFor(surface, file) || (pathname === '/site/pricing' ? extracted.page.editable || extracted.page.file !== null : !extracted.page.editable || extracted.page.file !== file)) throw new Error('Asset metadata identity does not match its scoped URL: ' + url);
    return extracted;
  }));
  const pages = results.map(result => result.page), passages = results.flatMap(result => result.passages);
  if (new Set(pages.map(page => page.assetId)).size !== pages.length || new Set(passages.map(passage => passage.id)).size !== passages.length) throw new Error('Crawl resolved duplicate asset or passage IDs.');
  return { pages, passages };
}
export async function discoverScope(baseUrl: string): Promise<CrawledScope> {
  const base = new URL(baseUrl);
  if (base.pathname !== '/' || base.search || base.hash || base.username || base.password || base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Sitemap discovery requires a local HTTP origin.');
  const response = await fetch(new URL('/sitemap.xml', base), { cache: 'no-store', redirect: 'error', headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('Sitemap fetch failed (' + response.status + ').');
  const $ = load(await response.text(), { xmlMode: true });
  const urls = $('urlset > url > loc').toArray().map(element => $(element).text());
  if (!urls.length || urls.some(url => new URL(url).origin !== base.origin)) throw new Error('Sitemap has no assets or contains a different origin.');
  const result = await crawlScope(urls);
  const pages = result.pages.filter(page => page.editable), ids = new Set(pages.map(page => page.assetId));
  return { pages, passages: result.passages.filter(passage => ids.has(passage.assetId)) };
}
