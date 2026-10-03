import { labOrigin, multichannelEnabled } from './runtime';

export const MULTICHANNEL_PREFIX = '/api/multichannel';
const MAX_BODY_BYTES = 15 * 1024 * 1024;
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const commonHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
class ProxyError extends Error { constructor(message: string, readonly status: number) { super(message); } }

function localRequest(request: Request) {
  const url = new URL(request.url), host = request.headers.get('host');
  if (!localHosts.has(url.hostname) || (host && host !== url.host)) throw new ProxyError('Multichannel review is available only on localhost.', 403);
  const origin = request.headers.get('origin'), site = request.headers.get('sec-fetch-site');
  if ((origin && origin !== url.origin) || (site && !['same-origin', 'none'].includes(site))) throw new ProxyError('Use the local MOGS console for this request.', 403);
  return url;
}

function allowedPath(method: string, parts: string[], url: URL): string {
  const value = parts.join('/');
  const reads = /^(?:ui|app\.js|styles\.css|api\/state|api\/agent\/task_[a-z0-9-]+|api\/runs\/lab_[a-z0-9-]+(?:\/export)?|api\/assets\/asset_[a-f0-9]+\/preview\/[1-9]\d*)$/;
  const writes = /^(?:api\/import|api\/demo|api\/analyze|api\/agent)$/;
  if (!(method === 'GET' ? reads.test(value) : method === 'POST' && writes.test(value))) throw new ProxyError('Not found.', 404);
  const entries = [...url.searchParams];
  if (entries.length && (!/^api\/assets\//.test(value) || entries.length !== 1 || entries[0][0] !== 'unit' || !/^[a-zA-Z0-9_-]{1,200}$/.test(entries[0][1]))) throw new ProxyError('Invalid preview query.', 400);
  return (value === 'ui' ? '/' : '/' + value) + url.search;
}

async function boundedJson(request: Request): Promise<string> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ProxyError('Use an application/json request.', 415);
  const advertised = request.headers.get('content-length');
  if (advertised && (!/^\d+$/.test(advertised) || Number(advertised) > MAX_BODY_BYTES)) throw new ProxyError('Upload exceeds the 15 MB request limit.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ProxyError('A JSON request body is required.', 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new ProxyError('Upload exceeds the 15 MB request limit.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); JSON.parse(text); }
  catch { throw new ProxyError('Invalid JSON request.', 400); }
  return text;
}

function uiHtml(source: string): string {
  return source
    .replace(/<html\b/i, `<html data-api-prefix="${MULTICHANNEL_PREFIX}"`)
    .replace('href="/styles.css"', `href="${MULTICHANNEL_PREFIX}/styles.css"`)
    .replace('src="/app.js"', `src="${MULTICHANNEL_PREFIX}/app.js"`)
    .replace('href="/"', `href="${MULTICHANNEL_PREFIX}/ui"`);
}

export async function proxyMultichannel(request: Request, parts: string[]): Promise<Response> {
  // The switch is evaluated before body consumption, process startup, or lab storage.
  if (!multichannelEnabled()) return Response.json({ error: 'Multichannel review is disabled.' }, { status: 404, headers: commonHeaders });
  try {
    const url = localRequest(request), pathname = allowedPath(request.method, parts, url);
    const body = request.method === 'POST' ? await boundedJson(request) : undefined;
    if (!multichannelEnabled()) return Response.json({ error: 'Multichannel review is disabled.' }, { status: 404, headers: commonHeaders });
    const origin = await labOrigin();
    // Never forward incoming credentials, cookies, Origin, Host, or proxy headers.
    const upstream = await fetch(origin + pathname, {
      method: request.method, body, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(65_000),
    });
    const headers = new Headers(commonHeaders);
    for (const name of ['content-type', 'content-disposition', 'content-security-policy']) {
      const value = upstream.headers.get(name); if (value) headers.set(name, value);
    }
    if (parts.length === 1 && parts[0] === 'ui' && upstream.ok) {
      const policy = headers.get('content-security-policy');
      if (policy) headers.set('content-security-policy', policy.replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
      return new Response(uiHtml(await upstream.text()), { status: upstream.status, headers });
    }
    // Asset previews retain the lab's sandbox and inert-content policy.
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    const status = error instanceof ProxyError ? error.status : 503;
    const message = error instanceof ProxyError ? error.message : 'Multichannel review is unavailable. Check the local lab process and its port.';
    return Response.json({ error: message }, { status, headers: commonHeaders });
  }
}
