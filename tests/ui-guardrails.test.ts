import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditCss, auditStyles } from '../scripts/check-ui';

const rules = (source: string, file = 'components/example.module.css') => auditCss(file, source).map(issue => issue.rule);
const pointerMotion = (source: string) => `@media (prefers-reduced-motion: no-preference) { @media (hover: hover) and (pointer: fine) { ${source} } }`;

test('allows shared typography, static layout, skip links, and gated pointer feedback', () => {
  const css = `:root { --font-ui: system-ui, sans-serif; --duration-press: 140ms; font-family: var(--font-ui); }
    body { width: 100%; min-height: 100vh; font-family: inherit; }
    .skipLink { transform: translateY(-200%); }
    .skipLink:focus-visible { transform: translateY(0); }
    /* .fake:hover { transition: all 800ms ease-in; } */
    ${pointerMotion(`.button { transition: transform var(--duration-press) cubic-bezier(.23, 1, .32, 1); }
      .button:hover { background: #eee; }
      .button:not(:disabled):not(:focus-visible):active { transform: scale(.97); }`)}
    .status { transition: opacity 150ms ease-out; }`;
  assert.deepEqual(auditCss('app/globals.css', css), []);
});

test('rejects explicit and implicit transition all, layout motion, slow duration, and ease-in', () => {
  for (const value of ['all 200ms', '200ms ease-out', 'opacity 100ms, 200ms ease-out', '/* comment */ all 100ms', 'initial']) {
    assert.ok(rules(`.x { transition: ${value}; }`).includes('explicit-transition'), value);
  }
  assert.ok(rules('.x { transition-duration: 120ms; }').includes('explicit-transition'));
  for (const property of ['height', 'max-width', 'padding', 'margin-left', 'gap', 'grid-template-rows']) {
    assert.ok(rules(`.x { transition: ${property} 140ms; }`).includes('compositor-transition'), property);
  }
  assert.ok(rules('.x { transition: opacity .4s ease-in; }').includes('short-duration'));
  assert.ok(rules('.x { transition: opacity .4s ease-in; }').includes('responsive-easing'));
  assert.ok(!rules('.x { transition: opacity 300ms ease-in-out; }').includes('responsive-easing'));
});

test('resolves declared timing tokens and reports unknown tokens instead of silently passing', () => {
  assert.ok(rules(':root { --slow: 450ms; --alias: var(--slow); } .x { transition: opacity var(--alias); }').includes('short-duration'));
  assert.ok(rules('.x { transition: opacity var(--unknown); }').includes('known-motion-value'));
  assert.ok(rules('.x { transition: opacity var(--missing, 450ms); }').includes('short-duration'));
  assert.deepEqual(rules('.x { transition: opacity var(--missing, 150ms) ease-out; }'), []);
  assert.deepEqual(rules(':root { --fast: 140ms; } .x { transition: opacity var(--fast), color var(--fast); }'), []);
  assert.ok(rules(':root { --one: var(--two); --two: var(--one); } .x { transition: opacity var(--one); }').includes('known-motion-value'));
  assert.ok(rules('.x { transition: opacity calc(200ms + 200ms); }').includes('known-motion-value'));
});

test('requires real conjunctive media gates for hover and movement', () => {
  assert.ok(rules('.x:hover { color: red; }').includes('touch-hover'));
  assert.ok(rules('@media (hover: hover), (pointer: fine) { .x:hover { color: red; } }').includes('touch-hover'));
  assert.ok(rules('@media not (hover: hover) and (pointer: fine) { .x:hover { color: red; } }').includes('touch-hover'));
  assert.ok(rules('.x { transition: transform 140ms; }').includes('reduced-motion'));
  assert.ok(rules('.x { animation: appear 180ms; }').includes('reduced-motion'));
  assert.ok(rules('.x { animation: appear 180ms ease none; }').includes('reduced-motion'));
  assert.deepEqual(rules('.x { animation: none 0s ease 0s 1 normal none running; }'), []);
  assert.deepEqual(rules('.x { animation-name: none; }'), []);
  assert.ok(rules('.x { animation-name: none, appear; }').includes('reduced-motion'));
  assert.ok(rules('.x { animation-name: reverse; }').includes('reduced-motion'));
  assert.deepEqual(rules(pointerMotion('.x:hover { color: red; } .x { transition: transform 140ms; }')), []);
});

test('conservative same-rule checks describe their cascade and nesting limitations', () => {
  const cascaded = auditCss('components/example.css', '.x { transition-property: opacity; } .x:focus { transition-duration: 100ms; }');
  assert.match(cascaded.find(issue => issue.rule === 'explicit-transition')!.message, /same rule.*does not resolve declarations from the cascade/);
  const nested = auditCss('components/example.css', pointerMotion('.x:not(:disabled):not(:focus-visible) { &:active { transform: scale(.97); } }'));
  assert.match(nested.find(issue => issue.rule === 'pointer-press')!.message, /explicit press selectors.*nested parent selectors/);
});

test('press motion excludes keyboard and disabled states; no scale-zero entries', () => {
  assert.ok(rules(pointerMotion('.x:active { transform: scale(.97); }')).includes('pointer-press'));
  assert.ok(rules(pointerMotion('.x:not(:disabled):active { transform: scale(.97); }')).includes('pointer-press'));
  assert.ok(rules(pointerMotion('.x:not(:disabled):not(:focus-visible):active, .y:active { transform: scale(.97); }')).includes('pointer-press'));
  const press = '.x:not(:disabled):not(:focus-visible):active { transform: scale(.97); }';
  for (const media of ['', ' and (hover: hover)', ' and (pointer: fine)']) {
    assert.ok(rules(`@media (prefers-reduced-motion: no-preference)${media} { ${press} }`).includes('pointer-press-media'));
  }
  assert.deepEqual(rules(pointerMotion(press)), []);
  for (const declaration of ['transform: scale(0)', 'transform: scale(0.0, 1)', 'scale: 0']) {
    assert.ok(rules(`.x { ${declaration}; }`).includes('visible-scale'), declaration);
  }
});

test('enforces literal minimum type size and keeps focus outlines', () => {
  for (const size of ['11px', '11.9px', '.7rem', '0.749rem']) {
    assert.ok(rules(`.x { font-size: ${size}; }`).includes('readable-type'), size);
  }
  for (const size of ['12px', '.75rem', '1rem']) assert.deepEqual(rules(`.x { font-size: ${size}; }`), []);
  assert.deepEqual(rules(':root { --small-size: 10px; } .x { font-size: var(--small-size); }'), []); // Literal-only rule; computed size needs browser review.
  for (const declaration of ['outline: none', 'outline: 0', 'outline: 0px solid red', 'outline-style: none']) {
    assert.ok(rules(`.x:focus-visible { ${declaration}; box-shadow: 0 0 0 2px blue; }`).includes('visible-focus'), declaration);
  }
  assert.deepEqual(rules('.x:focus-visible { outline: 2px solid blue; outline-offset: 0; }'), []);
});

test('prohibits decorative treatments and typography drift with actionable locations', () => {
  const issues = auditCss('components/test.css', '.x {\n  font-family: monospace;\n  background: linear-gradient(red, blue);\n  backdrop-filter: blur(10px);\n  text-shadow: 0 0 5px red;\n}');
  assert.equal(issues.filter(issue => issue.rule === 'restrained-decoration').length, 3);
  assert.deepEqual(issues[0], { file: 'components/test.css', line: 2, column: 3, rule: 'one-font', message: 'Use font-family: var(--font-ui) or inherit; define the font only in app/globals.css.' });
  assert.ok(rules(':root { --font-ui: monospace; }').includes('one-font'));
  assert.ok(rules('.x { font: 14px serif; }').includes('one-font'));
  assert.deepEqual(rules('.x { text-shadow: none; backdrop-filter: none; font-family: var(--font-ui); }'), []);
});

test('CLI scans nested CSS and shared tokens, excludes app/api, and fails malformed/empty input', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mogs-ui-'));
  const runCli = () => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-ui.ts', directory], { cwd: process.cwd(), encoding: 'utf8' });
  try {
    assert.equal(runCli().status, 1);
    mkdirSync(join(directory, 'app', 'api'), { recursive: true });
    mkdirSync(join(directory, 'components', 'review'), { recursive: true });
    writeFileSync(join(directory, 'app', 'globals.css'), ':root { --font-ui: system-ui; --fast: 140ms; font-family: var(--font-ui); }');
    writeFileSync(join(directory, 'app', 'api', 'ignored.css'), 'this is not valid CSS');
    writeFileSync(join(directory, 'components', 'review', 'item.css'), '.item { transition: opacity var(--fast); }');
    assert.deepEqual(auditStyles(directory).files, ['app/globals.css', 'components/review/item.css']);
    assert.equal(runCli().status, 0);
    writeFileSync(join(directory, 'components', 'review', 'item.css'), '.item { transition:');
    const malformed = runCli();
    assert.equal(malformed.status, 1);
    assert.match(malformed.stderr, /components\/review\/item.css:1:\d+ \[valid-css\]/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
