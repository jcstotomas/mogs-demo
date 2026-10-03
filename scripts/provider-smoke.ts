import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildFixtures } from '../lib/fixtures';
import { loadLocalEnv, providerEnvironment } from '../lib/providers/env';
import { judgeWithJev } from '../lib/providers/jev';
import { fixWithFrontier, judgeWithFrontier } from '../lib/providers/frontier';
import { targetForKind } from '../lib/facts/derive';
import { parseSource, replaceSourceBlocks, renderSource, extractRenderedAsset } from '../lib/assets/source';
import { verificationPass } from '../lib/publication/contracts';
import type { Adapter, Judgment } from '../lib/types';
loadLocalEnv();
const fixtures = buildFixtures(), env = providerEnvironment();
const cases = [
  { name: 'direct_price', asset: fixtures.assets[0], sourceId: 'starter-price', expected: 'contradicting' },
  { name: 'eligible_grandfathering', asset: fixtures.assets[2], sourceId: 'starter-price', expected: 'valid_exception' },
  { name: 'derived_savings', asset: fixtures.assets[0], sourceId: 'starter-savings', expected: 'contradicting' },
];
type CaseResult = { name: string; expected: string; pass: boolean; elapsedMs: number; judgment?: Judgment; failure?: string };
async function runCases(adapter: Adapter): Promise<CaseResult[]> {
  const judge = adapter === 'jev' ? judgeWithJev : judgeWithFrontier;
  return Promise.all(cases.map(async item => {
    const started = performance.now();
    try { const p = item.asset.passages.find(p => p.sourceId === item.sourceId)!; const judgment = await judge('smoke-run', p, item.asset.page, fixtures.facts, fixtures.after); return { name: item.name, expected: item.expected, pass: judgment.label === item.expected, elapsedMs: Math.round(performance.now() - started), judgment }; }
    catch (error) { return { name: item.name, expected: item.expected, pass: false, elapsedMs: Math.round(performance.now() - started), failure: safeFailure(error) }; }
  }));
}
function safeFailure(error: unknown): string {
  let message = error instanceof Error ? error.message : 'Provider failure.';
  for (const key of [process.env.TYPESAFE_API_KEY, process.env.ANTHROPIC_API_KEY]) if (key) message = message.replaceAll(key, '[redacted]');
  return message.slice(0, 1500);
}
const startedAt = new Date().toISOString();
const jev = await runCases('jev');
let selected: Adapter | null = jev.every(c => c.pass) ? 'jev' : null;
let frontier: CaseResult[] | null = null;
if (!selected) { frontier = await runCases('frontier'); if (frontier.every(c => c.pass)) selected = 'frontier'; }
const fixStarted = performance.now();
let fixResult: Record<string, unknown>;
try {
  const sample = fixtures.assets[0], passage = sample.passages.find(p => p.sourceId === 'starter-price')!;
  const { fix, model } = await fixWithFrontier(passage, sample.page, fixtures.facts, fixtures.after, targetForKind('direct_price', fixtures.after)!);
  if (fix.action !== 'replace' || fix.replacement !== 'Starter is $40 a month.') throw new Error('Structured fix did not produce the deterministic expected replacement.');
  const source = replaceSourceBlocks(sample.asset, [{ sourceId: passage.sourceId, original: passage.text, replacement: fix.replacement }], sample.page.sourceHash);
  const live = extractRenderedAsset(renderSource(parseSource(source, sample.asset.file, sample.asset.surface)), sample.page.url);
  const replacement = live.passages.find(p => p.sourceId === passage.sourceId)!;
  const judge = selected === 'jev' ? judgeWithJev : judgeWithFrontier;
  const judgment = await judge('smoke-run', replacement, live.page, fixtures.facts, fixtures.after);
  const checks = { exact_target: fix.replacement === 'Starter is $40 a month.', span_confined: passage.text.split(' ').filter((word, i) => word !== fix.replacement!.split(' ')[i]).length === 1, qualifiers_kept: fix.replacement.includes('Starter') && fix.replacement.includes('a month'), source_roundtrip: replacement.text === fix.replacement, fact_fresh: judgment.factVersion === fixtures.after.version, rejudge_consistent: verificationPass(true, judgment, env.T_LABEL, { runId: 'smoke-run', passageId: replacement.id, factVersion: fixtures.after.version, adapter: selected ?? 'frontier', model: selected === 'jev' ? env.JEV_MODEL : env.FRONTIER_MODEL }) };
  fixResult = { pass: Object.values(checks).every(Boolean), model, fix, checks, judgment, elapsedMs: Math.round(performance.now() - fixStarted) };
} catch (error) { fixResult = { pass: false, failure: safeFailure(error), elapsedMs: Math.round(performance.now() - fixStarted) }; }
const report = { stage: 1, startedAt, completedAt: new Date().toISOString(), connections: { jev: 'typesafe_http', frontier: 'anthropic_direct' }, models: { jev: env.JEV_MODEL, frontier: env.FRONTIER_MODEL, fix: env.FIX_MODEL }, jev, frontier, fix: fixResult, selectedAdapter: selected, gatePassed: selected !== null && fixResult.pass === true, workloadGate: 'not_run_step0' };
mkdirSync('data', { recursive: true });
writeFileSync('data/provider-smoke.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.gatePassed) process.exitCode = 1;
