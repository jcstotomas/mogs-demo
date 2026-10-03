import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractAsset } from '../src/extract.ts';
import { analyzeAsset } from '../src/analyze.ts';
import { ContextSchema, DEFAULT_FACTS, hash, hashRecord, limits } from '../src/contracts.ts';

const context = ContextSchema.parse({});
async function withAsset<T>(bytes: string | Buffer, mime: string, execute: (input: {file: string; filename: string; mime: string; context: typeof context; outputDir: string}) => Promise<T>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mogs-extract-test-'));
  const file = path.join(directory, 'asset');
  try {
    await writeFile(file, bytes);
    return await execute({file, filename: 'source', mime, context, outputDir: path.join(directory, 'previews')});
  } finally { await rm(directory, {recursive: true, force: true}); }
}

test('HTML parser preserves repeated locations, inline copy, tokens, and original bytes', async () => {
  const html = '<html><body><h1>MOGS Starter</h1><p>Starter is <b>$30</b> a month.</p><p>Starter is <b>$30</b> a month.</p><p>Hi {{ customer.name }}, see https://example.test/offer?a=1&amp;b=2</p></body></html>';
  await withAsset(html, 'text/html', async input => {
    const result = await extractAsset(input);
    assert.equal(result.status, 'complete');
    assert.equal(result.units.length, 4);
    const repeats = result.units.filter(unit => unit.text === 'Starter is $30 a month.');
    assert.equal(repeats.length, 2);
    assert.notEqual(repeats[0].id, repeats[1].id);
    assert.notDeepEqual(repeats[0].locator, repeats[1].locator);
    assert.equal(result.units[3].text, 'Hi {{ customer.name }}, see https://example.test/offer?a=1&b=2');
    assert.ok(result.units.every(unit => !unit.uncertain));
    const preview = await readFile(result.previews[0].file, 'utf8');
    for (const unit of result.units) assert.ok(preview.includes(`data-unit-id="${unit.id}"`));
    assert.equal(hash(await readFile(input.file)), hash(html));
  });
});

test('source attributes and active markup never enter inert preview', async () => {
  const html = '<head><base href="https://bad.example"><meta http-equiv="refresh" content="0;url=https://bad.example"><style>@import url(https://bad.example);body{background:url(https://bad.example)}</style></head><body onload="evil()"><script>fetch("https://bad.example")</script><form action="https://bad.example"><p style="background:url(https://bad.example)">Starter is $30 a month.</p><input value="bad"></form><a href="javascript:evil()" onclick="evil()">Offer</a><img src="https://bad.example/pixel" onerror="evil()"><iframe src="https://bad.example"></iframe><svg><script>evil()</script></svg></body>';
  await withAsset(html, 'text/html', async input => {
    const result = await extractAsset(input);
    const preview = await readFile(result.previews[0].file, 'utf8');
    assert.equal(result.status, 'partial');
    assert.ok(result.units.some(unit => unit.text === 'Starter is $30 a month.'));
    assert.doesNotMatch(preview, /bad\.example|evil\(|<script|<form|<iframe|<svg|<base|onclick=|onload=|src=/i);
    assert.match(preview, /default-src 'none'/);
  });
});

test('metadata variants are separate source units and are escaped in the preview', async () => {
  await withAsset('<p>Hello</p>', 'text/html', async input => {
    const result = await extractAsset({...input, context: ContextSchema.parse({subject: '<script>alert(1)</script> Starter is $30 a month.', preheader: 'Starter offer', plainText: 'Hi {{ name }}\n\nStarter is $30 a month.'})});
    assert.deepEqual(result.units.slice(0, 4).map(unit => unit.role), ['subject', 'preheader', 'plain_text', 'plain_text']);
    assert.equal(result.units[0].locator.kind, 'html');
    const preview = await readFile(result.previews[0].file, 'utf8');
    assert.match(preview, /&lt;script&gt;/);
    assert.doesNotMatch(preview, /<script>/);
  });
});

test('unresolved branches in HTML or plain text withhold all variants', async () => {
  for (const inMetadata of [false, true]) {
    await withAsset(inMetadata ? '<p>Starter is $30 a month.</p>' : '<p>{% if legacy %}Starter is $30 a month.{% endif %}</p>', 'text/html', async input => {
      const result = await extractAsset({...input, context: ContextSchema.parse({plainText: inMetadata ? '{% if legacy %}Starter is $30 a month.{% endif %}' : ''})});
      assert.equal(result.status, 'partial');
      assert.ok(result.units.every(unit => unit.uncertain));
      assert.match(result.warnings.join(' '), /conditional/);
    });
  }
});

test('nearest containing section supplies context without adjacent section scope', async () => {
  await withAsset('<section><h2>Active legacy subscribers</h2><p>Starter is $30 a month.</p></section><section><h2>New customers</h2><p>Starter is $30 a month.</p></section>', 'text/html', async input => {
    const result = await extractAsset(input);
    const repeats = result.units.filter(unit => unit.text === 'Starter is $30 a month.');
    assert.match(repeats[0].context, /legacy/);
    assert.doesNotMatch(repeats[0].context, /New customers/);
    assert.match(repeats[1].context, /New customers/);
    assert.doesNotMatch(repeats[1].context, /legacy/);
  });
});

test('empty visual email remains partial and metadata is not silently lost', async () => {
  await withAsset('<img src="https://example.test/pricing.png">', 'text/html', async input => {
    const result = await extractAsset(input);
    assert.equal(result.status, 'partial');
    assert.equal(result.units.length, 0);
    assert.ok(result.warnings.length >= 2);
  });
});

test('mismatched media types and invalid UTF-8 fail explicitly', async () => {
  await withAsset('<p>Starter</p>', 'application/pdf', input => assert.rejects(extractAsset(input), /Media type/));
  await withAsset(Buffer.from([60, 112, 62, 255, 60, 47, 112, 62]), 'text/html', input => assert.rejects(extractAsset(input), /UTF-8/));
  await withAsset('%PDF-1.7\nnot a PDF', 'application/pdf', input => assert.rejects(extractAsset(input), /Extraction failed/));
});

test('file and unit bounds are enforced', async () => {
  await withAsset(Buffer.alloc(limits.fileBytes + 1, 32), 'text/html', input => assert.rejects(extractAsset(input), /size limit/));
  await withAsset(Array.from({length: limits.units + 1}, (_, n) => `<p>Claim ${n}</p>`).join(''), 'text/html', input => assert.rejects(extractAsset(input), /unit limit/));
});

test('line breaks and text runs around nested blocks remain distinct and located', async () => {
  await withAsset('<div>Opening<p>Starter is<br><strong>$30</strong> a month.</p>Closing</div>', 'text/html', async input => {
    const result = await extractAsset(input);
    assert.deepEqual(result.units.map(unit => unit.text), ['Opening', 'Starter is $30 a month.', 'Closing']);
    assert.notDeepEqual(result.units[0].locator, result.units[2].locator);
  });
});

async function extractFixture(filename: string, mime: string, execute: (result: Awaited<ReturnType<typeof extractAsset>>) => void | Promise<void>) {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'mogs-fixture-extract-'));
  try {
    const file = path.resolve('fixtures', filename);
    const fixtureContext = ContextSchema.parse(JSON.parse(await readFile(`${file}.context.json`, 'utf8')));
    const before = hash(await readFile(file));
    const result = await extractAsset({file, filename, mime, context: fixtureContext, outputDir});
    await execute(result);
    assert.equal(hash(await readFile(file)), before);
  } finally { await rm(outputDir, {recursive: true, force: true}); }
}

function checkBoxes(result: Awaited<ReturnType<typeof extractAsset>>) {
  for (const unit of result.units) {
    if (unit.locator.kind === 'html') continue;
    const locator = unit.locator;
    const preview = result.previews.find(preview => preview.page === locator.page)!;
    const [x, y, width, height] = locator.bbox;
    assert.ok(x >= 0 && y >= 0 && width >= 0 && height >= 0);
    assert.ok(x + width <= preview.width + 0.02 && y + height <= preview.height + 0.02);
  }
}

test('real PDF parser renders imported bytes and retains duplicate page occurrences', async () => {
  await extractFixture('deck-new.pdf', 'application/pdf', async result => {
    assert.equal(result.surface, 'deck');
    assert.equal(result.pages, 2);
    assert.equal(result.previews.length, 2);
    assert.equal(result.status, 'complete');
    const repeated = result.units.filter(unit => unit.text === 'Starter is $30 a month.');
    assert.equal(repeated.length, 2);
    assert.notDeepEqual(repeated[0].locator, repeated[1].locator);
    assert.notEqual(repeated[0].id, repeated[1].id);
    checkBoxes(result);
    for (const preview of result.previews) {
      assert.equal((await readFile(preview.file)).subarray(1, 4).toString(), 'PNG');
      assert.ok(preview.width > 1000 && preview.height > 500);
    }
  });
});

test('real PNG OCR locates pricing with confidence in original preview dimensions', async () => {
  await extractFixture('creative-new.png', 'image/png', result => {
    assert.equal(result.surface, 'creative');
    assert.equal(result.status, 'partial');
    assert.equal(result.previews[0].width, 1900);
    assert.equal(result.previews[0].height, 1120);
    const price = result.units.find(unit => unit.text === 'Starter is $30 a month.');
    assert.ok(price);
    assert.ok(price.confidence !== null && price.confidence > 0.8 && price.confidence <= 1);
    assert.equal(price.uncertain, false);
    checkBoxes(result);
  });
});

test('real JPEG OCR retains the visible audience heading in whole-image context', async () => {
  await extractFixture('creative-savings.jpg', 'image/jpeg', result => {
    assert.ok(result.units.some(unit => unit.text === 'Save 20% on Starter with annual billing.'));
    const price = result.units.find(unit => unit.text.startsWith('Starter is $288 a year'))!;
    assert.match(price.context, /New customer plan comparison/);
    checkBoxes(result);
  });
});


test('blank and blurred real images report zero reliable units and partial coverage', async () => {
  for (const filename of ['blank.png', 'blurry.png']) {
    const bytes = await readFile(path.resolve('fixtures/faults', filename));
    await withAsset(bytes, 'image/png', async input => {
      const result = await extractAsset(input);
      assert.equal(result.status, 'partial');
      assert.equal(result.units.length, 0);
      assert.match(result.warnings.join(' '), /No reliable text/);
    });
  }
});

test('encrypted PDFs and excessive declared image dimensions fail before extraction', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'mogs-limits-test-'));
  const bundled = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
  const python = process.env.MOGS_LAB_PYTHON || (existsSync(bundled) ? bundled : 'python3');
  try {
    const encrypted = path.join(outputDir, 'encrypted.pdf');
    await promisify(execFile)(python, ['-c', "from pypdf import PdfReader,PdfWriter; import sys; w=PdfWriter(); w.append(PdfReader(sys.argv[1])); w.encrypt('fixture-password'); w.write(sys.argv[2])", path.resolve('fixtures/deck-new.pdf'), encrypted]);
    await assert.rejects(extractAsset({file: encrypted, filename: 'encrypted.pdf', mime: 'application/pdf', context, outputDir: path.join(outputDir, 'encrypted-preview')}), /Encrypted PDFs/);
    const oversized = path.join(outputDir, 'oversized.png');
    await promisify(execFile)(python, ['-c', "import struct,zlib,sys; data=bytearray(open(sys.argv[1],'rb').read()); data[16:24]=struct.pack('>II',10000000,10); data[29:33]=struct.pack('>I',zlib.crc32(data[12:29])); open(sys.argv[2],'wb').write(data)", path.resolve('fixtures/faults/blank.png'), oversized]);
    await assert.rejects(extractAsset({file: oversized, filename: 'oversized.png', mime: 'image/png', context, outputDir: path.join(outputDir, 'oversized-preview')}), /pixel|decompression bomb/i);
  } finally { await rm(outputDir, {recursive: true, force: true}); }
});


test('legacy heading remains a separate context line and blocks conflicting audience corrections', async () => {
  await withAsset('<section><h2>For legacy-eligible subscribers only.</h2><p>Starter is $30 a month.</p></section>', 'text/html', async input => {
    const result = await extractAsset(input);
    const price = result.units.find(unit => unit.text === 'Starter is $30 a month.')!;
    assert.equal(price.context, 'For legacy-eligible subscribers only.\nStarter is $30 a month.');
    for (const legacyEligible of [false, null, true]) {
      const scope = ContextSchema.parse({audience: legacyEligible === false ? 'new_customers' : 'existing_customers', legacyEligible});
      const findings = analyzeAsset({id:'scope-test',revision:'scope-revision',sourceHash:hash(await readFile(input.file)),contextHash:hashRecord(scope),filename:'scope.html',mime:'text/html',surface:'email',context:scope,createdAt:'2026-10-03',status:'ready',extraction:result,error:null,original:input.file,active:true},DEFAULT_FACTS);
      const finding = findings.find(finding => finding.unitId === price.id)!;
      assert.equal(finding.replacement, null);
      assert.equal(finding.label, legacyEligible === false ? 'insufficient_context' : 'valid_exception');
    }
  });
});

test('designed email formatting survives while source text, unit IDs and locations stay exact', async () => {
  const html = '<html><body style="margin:0;padding:0;background-color:#f5f1e7;color:#163c30;font-family:Arial, sans-serif"><table width="100%" style="width:100%;max-width:640px;margin:0 auto;border-collapse:collapse"><tr><td style="padding:32px 24px;border-bottom:1px solid #163c30"><h1 style="font-family:Georgia, serif;font-size:48px;line-height:1.1;font-weight:400">Room for good work.</h1><p style="font-size:18px;line-height:1.5">Starter is <strong style="font-weight:700">$30</strong> a month.</p><a href="https://example.test" style="display:inline-block;background-color:#163c30;color:#ffffff;padding:16px 24px;border-radius:4px;text-decoration:none">Explore Starter</a></td></tr></table></body></html>';
  await withAsset(html, 'text/html', async input => {
    const result = await extractAsset({...input, context: ContextSchema.parse({subject: 'A little room for good work', preheader: 'Build a calmer week'})});
    assert.equal(result.status, 'complete');
    assert.equal(result.extractor, 'cheerio-inert-html-v4');
    const price = result.units.find(unit => unit.text === 'Starter is $30 a month.')!;
    assert.equal(price.locator.kind, 'html');
    assert.match(price.locator.kind === 'html' ? price.locator.path : '', /td:nth-of-type\(1\) > p:nth-of-type\(1\)::text-run\(1\)$/);
    const preview = await readFile(result.previews[0].file, 'utf8');
    assert.match(preview, /class="email-content" style="margin:0;padding:0;background-color:#f5f1e7;color:#163c30;font-family:Arial, sans-serif"/);
    assert.match(preview, /max-width:640px;margin:0 auto;border-collapse:collapse/);
    assert.match(preview, /font-family:Georgia, serif;font-size:48px;line-height:1.1;font-weight:400/);
    assert.match(preview, /display:inline-block;background-color:#163c30;color:#ffffff;padding:16px 24px;border-radius:4px;text-decoration:none/);
    assert.ok(preview.indexOf('Room for good work.') < preview.indexOf('<h2>Email metadata</h2>'));
    assert.doesNotMatch(preview, /href=|https:\/\/example.test/);
    assert.equal(hash(await readFile(input.file)), hash(html));
    const unstyled = html.replace(/ style="[^"]*"/g, '');
    await withAsset(unstyled, 'text/html', async plainInput => {
      const plain = await extractAsset({...plainInput, context: ContextSchema.parse({subject: 'A little room for good work', preheader: 'Build a calmer week'})});
      assert.deepEqual(result.units, plain.units);
    });
  });
});

test('formatting allowlist rejects CSS requests, escapes, active attributes and hidden overlays', async () => {
  const html = '<body style="background:#f5f1e7;background-image:url(https://tracking.invalid);color:#163c30;position:fixed;opacity:0"><p id="mogs-selected-unit" class="metadata" data-unit-id="forged" onclick="steal()" style="font-family:Georgia, serif;font-size:24px;display:none;visibility:hidden;position:absolute;z-index:999;opacity:0;filter:blur(4px);transform:translateX(-9999px);overflow:hidden;max-height:0;clip-path:inset(100%);background:url(https://tracking.invalid);color:expression(steal());behavior:url(https://tracking.invalid);-moz-binding:url(https://tracking.invalid);content:attr(secret);padding:var(--secret);margin:-20px;border:1px solid #123456;\\63 olor:red;color:transparent">Starter is $30 a month.</p><p style="background-color:#abcdef;@import:url(https://tracking.invalid);background-image:image-set(url(https://tracking.invalid));width:calc(100% - 10px);color:/*x*/red">Annual stays the same.</p></body>';
  await withAsset(html, 'text/html', async input => {
    const result = await extractAsset(input);
    const preview = await readFile(result.previews[0].file, 'utf8');
    assert.match(preview, /font-family:Georgia, serif;font-size:24px;border:1px solid #123456/);
    assert.match(preview, /background-color:#abcdef/);
    assert.doesNotMatch(preview, /tracking\.invalid|steal\(|display:none|visibility:hidden|position:|opacity:|z-index:|filter:|(?:;|")transform:|overflow:hidden|max-height:|clip-path:|background-image|behavior:|-moz-binding|expression\(|content:attr|var\(|calc\(|@import|color:transparent|forged|id="mogs-selected-unit"|onclick=/);
    assert.ok(result.units.some(unit => unit.text === 'Starter is $30 a month.'));
  });
});

test('only bounded raster data images are retained and image text remains partial coverage', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cZAAAAABJRU5ErkJggg==';
  const valid = `data:image/png;base64,${png}`;
  const oversized = Buffer.from(png, 'base64');
  oversized.writeUInt32BE(100000, 16);
  const fake = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>steal()</script></svg>').toString('base64');
  const sources = [valid, `data:image/png;base64,${oversized.toString('base64')}`, `data:image/png;base64,${fake}`, `data:image/svg+xml;base64,${fake}`, `data:image/jpeg;base64,${png}`, 'https://tracking.invalid/pixel.png', 'data:image/png;base64,notvalid', `data:image/png;base64,${Buffer.from(png, 'base64').subarray(0, 30).toString('base64')}`];
  await withAsset(`<p>Starter is $30 a month.</p>${sources.map(src => `<img src="${src}" alt="&quot; onerror=&quot;steal()" width="100" style="display:block;width:100%;max-width:640px" onload="steal()" srcset="https://tracking.invalid/pixel.png 2x">`).join('')}`, 'text/html', async input => {
    const result = await extractAsset(input);
    assert.equal(result.status, 'partial');
    assert.match(result.warnings.join(' '), /8 visual or embedded region\(s\) have no reliable text extraction/);
    const preview = await readFile(result.previews[0].file, 'utf8');
    assert.equal((preview.match(/<img /g) || []).length, 1);
    assert.ok(preview.includes(`src="${valid}"`));
    assert.match(preview, /img-src data:/);
    assert.match(preview, /alt="&quot; onerror=&quot;steal\(\)"/);
    assert.doesNotMatch(preview, /onload=|srcset=|https:\/\/tracking.invalid|<svg|src="data:image\/(?:svg|jpeg)/);
    assert.equal((preview.match(/External or unsupported image omitted/g) || []).length, 7);
  });
});
