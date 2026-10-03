import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Local verification of the same static files shipped by hosting. No APIs,
// state or source directories are reachable through this server.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/public/out');
const port = Number(process.env.MOGS_PUBLIC_TEST_PORT ?? 3100);
createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname); } catch { response.writeHead(400); response.end(); return; }
  if (pathname.split('/').some(p => p === '..') || pathname.includes('\\')) { response.writeHead(404); response.end(); return; }
  const mapped = pathname === '/' ? 'index.html' : pathname.startsWith('/_next/') ? pathname.slice(1) : pathname === '/sitemap.xml' ? 'sitemap.xml' : /^(?:\/site\/(?:launch|pricing)|\/assets\/email\/(?:onboarding|eligible))$/.test(pathname) ? pathname.slice(1) + '.html' : '404.html';
  try {
    const body = await readFile(path.join(root, mapped));
    const type = mapped.endsWith('.html') ? 'text/html; charset=utf-8' : mapped.endsWith('.xml') ? 'application/xml' : mapped.endsWith('.css') ? 'text/css' : mapped.endsWith('.js') ? 'application/javascript' : 'application/octet-stream';
    response.writeHead(mapped === '404.html' ? 404 : 200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(404); response.end(); }
}).listen(port, '127.0.0.1', () => console.log('Content-only artifact available at http://127.0.0.1:' + port));
