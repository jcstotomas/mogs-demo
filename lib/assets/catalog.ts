import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { FactSnapshotSchema, type Surface } from '../types';
import { hashRecord } from '../hash';
import { decodeSource, parseSource, renderSource, type SourceAsset } from './source';

export const CONTENT_ROOT = path.join(process.cwd(), 'content');
export interface AssetEntry { file: string; surface: Surface; pathname: string }
export async function listAssetEntries(): Promise<AssetEntry[]> {
  const entries: AssetEntry[] = [];
  async function visit(directory: string, surface: Surface): Promise<void> {
    for (const entry of await readdir(path.join(CONTENT_ROOT, directory), { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const file = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file, surface);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        const stem = file.slice(0, -3);
        const pathname = surface === 'web' ? '/' + stem : '/assets/' + stem;
        if (pathname === '/site/pricing') throw new Error('Canonical pricing must not have editable source.');
        entries.push({ file, surface, pathname });
      }
    }
  }
  await Promise.all([visit('site', 'web'), visit('email', 'email')]);
  return entries.sort((a, b) => a.pathname.localeCompare(b.pathname));
}
export async function readSourceAsset(file: string, surface: Surface): Promise<SourceAsset> {
  const source = decodeSource(await readFile(path.join(CONTENT_ROOT, file)));
  return parseSource(source, file, surface);
}
export function renderedBody(asset: SourceAsset): string {
  const html = renderSource(asset), match = /<body>([\s\S]*)<\/body>/.exec(html);
  if (!match) throw new Error('Shared renderer did not produce an asset body.');
  return match[1];
}
export async function renderCanonicalPricing(): Promise<string> {
  const facts = FactSnapshotSchema.parse(JSON.parse(await readFile(path.join(process.cwd(), 'data/facts.json'), 'utf8')));
  const money = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const block = (id: string, role: 'heading' | 'body', text: string) => `<!-- source-id: ${id} role: ${role} -->\n${text}\n<!-- /source-id: ${id} -->`;
  const source = '---\ntitle: MOGS canonical pricing\nkind: pricing\naudienceHint: new_customers\nlegacyStarterEligible: false\n---\n\n' + [
    block('pricing-title', 'heading', 'MOGS pricing — fictional company'),
    block('starter-monthly', 'body', `Starter is ${money(facts.plans.starter.monthlyCents)} a month for customers without legacy eligibility.`),
    block('starter-annual', 'body', `Starter is ${money(facts.plans.starter.annualCents)} a year, or $24 a month billed annually.`),
    block('legacy-rule', 'body', `Active Starter monthly subscribers whose subscription began before ${facts.change.legacyCutoff} keep ${money(facts.change.legacyRateCents)} a month.`),
    block('team-monthly', 'body', `Team is ${money(facts.plans.team.monthlyCents)} a month.`),
    block('business-monthly', 'body', `Business is ${money(facts.plans.business.monthlyCents)} a month.`),
    block('fact-version', 'body', `Fact snapshot ${facts.version}; effective date ${facts.effectiveDate}. This page renders directly from facts.`),
  ].join('\n\n') + '\n';
  const asset = parseSource(source, 'site/pricing.md', 'web');
  return renderedBody(asset).replace(/(<script type="application\/json" id="asset-meta">)([\s\S]*?)(<\/script>)/, (_, opening: string, json: string, closing: string) => {
    const metadata = JSON.parse(json);
    return opening + JSON.stringify({ ...metadata, editable: false, file: null, sourceHash: hashRecord(facts) }).replace(/</g, '\\u003c') + closing;
  });
}
