import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crawlRemoteScope, type RemoteCrawlOptions } from '../lib/crawl/remote';
import { buildRemoteFixtures } from '../lib/runs/remote-fixtures';
import { createDeploymentMetadata, createPublicArtifact } from '../lib/deployment/public-artifact';
import { hashRecord } from '../lib/hash';

function fixture(mutate?: (html: string, pathname: string) => string, origin?: string) {
  const f = buildRemoteFixtures(), baseline = f.state.attempt.baseline;
  const artifact = createPublicArtifact({ sourceCommit: baseline.deployedSha, mode: 'seed', seedManifestText: readFileSync('fixtures/remote/miniature/seed.json', 'utf8'), factText: f.seedFactsText });
  const metadata = createDeploymentMetadata(JSON.stringify(artifact, null, 2) + '\n'), requests: string[] = [];
  const fakeFetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(String(input)); requests.push(url.href);
    assert.equal(url.origin, origin ?? baseline.target.productionOrigin);
    assert.equal(init?.redirect, 'manual'); assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).get('Cache-Control'), 'no-cache');
    const route = artifact.routes.find(route => route.pathname === url.pathname)!;
    const html = route.html + '<script type="application/json" id="deployment-meta">' + JSON.stringify(metadata) + '</script>';
    const response = new Response(mutate?.(html, url.pathname) ?? html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    Object.defineProperty(response, 'url', { value: url.href, configurable: true });
    return response;
  };
  const options: RemoteCrawlOptions = { sources: f.baseSources, publishedFacts: f.state.facts[0].snapshot, fetch: fakeFetch as typeof fetch, ...(origin ? { localTestOrigin: origin } : {}) };
  return { f, baseline, options, requests, metadata };
}

test('remote crawl returns all four pinned assets and forty source/context blocks including read-only pricing', async () => {
  const { f, baseline, options, requests } = fixture();
  // The hosting deployment URL may be immutable; only configured production is crawled.
  baseline.deploymentUrl = 'https://immutable-mogs-fixture.invalid';
  const scope = await crawlRemoteScope(baseline, options);
  assert.equal(scope.pages.length, 4); assert.equal(scope.passages.length, 40); assert.equal(requests.length, 4);
  assert.equal(scope.pages.filter(page => page.surface === 'web').length, 2);
  assert.equal(scope.pages.filter(page => page.surface === 'email').length, 2);
  assert.equal(scope.pages.filter(page => page.editable).length, 3);
  assert.equal(scope.passages.filter(p => p.editable).length, 33);
  assert.ok(scope.passages.filter(p => p.assetId === 'web:site/pricing.md').every(p => !p.editable));
  const paired = scope.passages.filter(p => p.sourceId === 'starter-price' && p.surface === 'email');
  assert.equal(paired.length, 2); assert.equal(paired[0].text, paired[1].text); assert.notEqual(paired[0].id, paired[1].id);
  for (const passage of scope.passages) {
    const expected = f.state.passages.find(p => p.id === passage.id)!;
    assert.equal(passage.text, expected.text); assert.equal(passage.blockHash, expected.blockHash); assert.equal(passage.contextHash, expected.contextHash);
  }
  assert.ok(scope.passages.some(p => p.text.includes('{{ first_name }}') && p.text.includes('?ref=onboarding&step=1')));
});

test('explicit loopback fixture origin remaps URLs while preserving stable identities and source hashes', async () => {
  const { baseline, options } = fixture(undefined, 'http://127.0.0.1:3100');
  const scope = await crawlRemoteScope(baseline, options);
  assert.ok(scope.pages.every(page => page.url.startsWith('http://127.0.0.1:3100/')));
  assert.equal(scope.passages.length, 40);
});

test('unconfigured HTTP/non-origin targets and unsafe local seams fail before requests', async () => {
  for (const origin of ['http://mogs-fixture.invalid', 'https://mogs-fixture.invalid/site/', 'https://user@mogs-fixture.invalid', 'https://mogs-fixture.invalid?x=1']) {
    const { baseline, options, requests } = fixture(); baseline.target.productionOrigin = origin;
    await assert.rejects(crawlRemoteScope(baseline, options)); assert.equal(requests.length, 0);
  }
  for (const origin of ['http://remote.invalid', 'https://localhost:3100', 'http://localhost:3100/site/', 'http://localhost:3100?x=1']) {
    const { baseline, options, requests } = fixture(); options.localTestOrigin = origin;
    await assert.rejects(crawlRemoteScope(baseline, options), /plain configured origin/); assert.equal(requests.length, 0);
  }
});

test('source bytes, published facts and mapped route identity must match before network access', async () => {
  const mutations = [
    (f: ReturnType<typeof fixture>) => { f.options.sources['site/launch.md'] += '\n'; },
    (f: ReturnType<typeof fixture>) => { delete f.options.sources['email/eligible.md']; },
    (f: ReturnType<typeof fixture>) => { f.options.sources['site/extra.md'] = 'unexpected'; },
    (f: ReturnType<typeof fixture>) => { f.options.publishedFacts = f.f.state.facts[1].snapshot; },
    (f: ReturnType<typeof fixture>) => { f.baseline.assets[0].pathname = '/site/alias'; f.baseline.inventoryHash = hashRecord(f.baseline.assets); },
    (f: ReturnType<typeof fixture>) => { f.baseline.inventoryHash = '0'.repeat(64); },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f);
    await assert.rejects(crawlRemoteScope(f.baseline, f.options)); assert.equal(f.requests.length, 0);
  }
});

test('stale commit/facts/source map and mismatched artifact identity reject complete extraction', async () => {
  const mutations = [
    (html: string) => html.replace(/("sourceCommit":")[a-f0-9]{40}/, '$1' + 'b'.repeat(40)),
    (html: string) => html.replace(/("factsFileHash":")[a-f0-9]{64}/, '$1' + '0'.repeat(64)),
    (html: string) => html.replace(/("inventoryHash":")[a-f0-9]{64}/, '$1' + '0'.repeat(64)),
    (html: string) => html.replace(/("sourceHashes":\{)[^}]+\}/, '$1}'),
    (html: string) => html.replace(/("artifactHash":")[a-f0-9]{64}/, '$1' + '0'.repeat(64)),
  ];
  for (const mutate of mutations) {
    const { baseline, options } = fixture((html, pathname) => pathname === '/site/launch' ? mutate(html) : html);
    await assert.rejects(crawlRemoteScope(baseline, options), /differs from pinned baseline|different deployment artifacts/);
  }
});

test('metadata claims cannot hide changed text, missing/duplicate IDs, unmarked content or changed context', async () => {
  const mutations = [
    (html: string) => html.replace('Starter is $30 a month.', 'Starter is $300 a month.'),
    (html: string) => html.replace('data-source-id="starter-price"', 'data-source-id="unknown-price"'),
    (html: string) => html.replace('data-source-id="annual-savings"', 'data-source-id="starter-price"'),
    (html: string) => html.replace('</main>', '<p>Unmarked price: $1.</p></main>'),
    (html: string) => html.replace('</main>', '</main><p data-source-id="external" data-role="body">External offer.</p>'),
    (html: string) => html.replace('data-role="body"', 'data-role="heading"'),
    (html: string) => html.replace('<main>', '<main></main><main>'),
  ];
  for (const mutate of mutations) {
    const { baseline, options } = fixture((html, pathname) => pathname === '/site/launch' ? mutate(html) : html);
    await assert.rejects(crawlRemoteScope(baseline, options));
  }
});

test('redirects, silent followed redirects, non-HTML/missing responses and excessive bytes fail the whole crawl', async () => {
  for (const variant of ['redirect', 'followed', 'wrong-url', 'missing', 'json', 'large', 'large-header'] as const) {
    const { baseline, options } = fixture(), original = options.fetch!;
    options.fetch = async (input, init) => {
      if (new URL(String(input)).pathname !== '/site/launch') return original(input, init);
      if (variant === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://elsewhere.invalid' } });
      if (variant === 'missing') return new Response(null, { status: 404 });
      if (variant === 'json') return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      if (variant === 'large' || variant === 'large-header') return new Response(variant === 'large' ? 'x'.repeat(2_000_001) : '', { headers: { 'Content-Type': 'text/html', ...(variant === 'large-header' ? { 'Content-Length': '2000001' } : {}) } });
      const response = await original(input, init);
      if (variant === 'followed') Object.defineProperty(response, 'redirected', { value: true });
      else Object.defineProperty(response, 'url', { value: 'https://elsewhere.invalid/site/launch' });
      return response;
    };
    await assert.rejects(crawlRemoteScope(baseline, options), /Asset fetch\/extraction failed|bounded response size/);
  }
});
