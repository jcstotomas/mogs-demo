import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { proxyMultichannel } from './proxy';
import { labEnvironment, stopLabRuntime } from './runtime';

async function unusedPort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test('local multichannel proxy stays inert when disabled and preserves the isolated import/review contract', async () => {
  const names = ['MOGS_MULTICHANNEL_ENABLED', 'MOGS_LAB_PORT', 'MOGS_LAB_STORAGE'] as const;
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const storage = `bridge-check-${process.pid}`;
  const storageRoot = path.join(process.cwd(), 'experiments/multichannel-lab/.runtime', storage);
  assert.equal(existsSync(storageRoot), false);
  const request = (parts: string[], body?: unknown, origin = 'http://127.0.0.1:3110') => proxyMultichannel(new Request(`http://127.0.0.1:3110/api/multichannel/${parts.join('/')}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), parts);
  try {
    process.env.MOGS_LAB_STORAGE = storage;
    delete process.env.MOGS_MULTICHANNEL_ENABLED;
    const disabled = await request(['api', 'import'], { invalid: true });
    assert.equal(disabled.status, 404);
    assert.equal(existsSync(storageRoot), false);
    process.env.MOGS_MULTICHANNEL_ENABLED = '1';
    assert.equal((await request(['api', 'state'], undefined, 'https://outside.invalid')).status, 403);
    assert.equal((await request(['unknown'])).status, 404);
    assert.equal(existsSync(storageRoot), false);
    const allowedEnvironment = new Set(['NODE_ENV', 'PATH', 'HOME', 'TMPDIR', 'MOGS_LAB_PYTHON', 'MOGS_LAB_PDFTOPPM', 'MOGS_LAB_TESSERACT', 'MOGS_LAB_MODEL', 'MOGS_MULTICHANNEL_ENABLED', 'MOGS_LAB_PORT', 'MOGS_LAB_STORAGE', 'MOGS_LAB_ANTHROPIC_API_KEY']);
    assert.ok(Object.keys(labEnvironment(3220, storage)).every(name => allowedEnvironment.has(name)));
    process.env.MOGS_LAB_PORT = String(await unusedPort());
    const ui = await request(['ui']);
    assert.equal(ui.status, 200);
    const html = await ui.text();
    assert.ok(html.includes('data-api-prefix="/api/multichannel"'));
    assert.ok(html.includes('src="/api/multichannel/app.js"'));
    assert.ok(ui.headers.get('content-security-policy')?.includes("frame-ancestors 'self'"));
    assert.equal(existsSync(storageRoot), false, 'Serving the UI must not initialize lab storage.');
    const initial = await (await request(['api', 'state'])).json();
    assert.equal(initial.assets.length, 0);
    assert.equal(initial.facts.monthlyCents, 4000);
    assert.equal((await request(['api', 'import'], { filename: 'bridge.html', base64: 'AA==', unsupported: true })).status, 400);
    const imported = await request(['api', 'import'], {
      filename: 'bridge.html', base64: Buffer.from('<html><body><p>Starter is $30 a month.</p></body></html>').toString('base64'),
      context: { audience: 'new_customers', legacyEligible: false },
    });
    assert.equal(imported.status, 200);
    const asset = await imported.json();
    assert.equal(asset.surface, 'email');
    assert.equal(asset.status, 'ready');
    const preview = await request(['api', 'assets', asset.id, 'preview', '1']);
    assert.equal(preview.status, 200);
    assert.ok(preview.headers.get('content-security-policy')?.includes('sandbox'));
    assert.ok(preview.headers.get('content-security-policy')?.includes("script-src 'none'"));
    const analysis = await request(['api', 'analyze'], { assetIds: [asset.id] });
    assert.equal(analysis.status, 202);
    const started = await analysis.json();
    let run = started;
    for (let i = 0; i < 20 && ['queued', 'running'].includes(run.status); i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
      run = await (await request(['api', 'runs', started.id])).json();
    }
    assert.equal(run.contractVersion, 'mogs-lab-v1');
    assert.equal(run.counts.assets, 1);
    assert.equal(run.counts.suggestions, 1);
    assert.equal(run.findings[0].replacement, 'Starter is $40 a month.');
    const report = await (await request(['api', 'runs', run.id, 'export'])).json();
    assert.equal(report.publication, 'none');
    assert.equal(report.sourceManifest.length, 1);
    process.env.MOGS_MULTICHANNEL_ENABLED = '0';
    assert.equal((await request(['api', 'state'])).status, 404);
  } finally {
    await stopLabRuntime();
    await rm(storageRoot, { recursive: true, force: true });
    for (const name of names) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; }
  }
});
