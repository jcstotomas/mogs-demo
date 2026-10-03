import { hashRecord } from '../hash';
import { parseSource, renderSource } from '../assets/source';
import { FactSnapshotSchema, type FactSnapshot } from '../types';

/** Render the canonical public price from an explicit, immutable fact snapshot. */
export function renderCanonicalPricingFromFacts(snapshot: FactSnapshot): string {
  const facts = FactSnapshotSchema.parse(snapshot);
  const money = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const block = (id: string, role: 'heading' | 'body', text: string) => `<!-- source-id: ${id} role: ${role} -->\n${text}\n<!-- /source-id: ${id} -->`;
  const source = '---\ntitle: MOGS canonical pricing\nkind: pricing\naudienceHint: new_customers\nlegacyStarterEligible: false\n---\n\n' + [
    block('pricing-title', 'heading', 'MOGS pricing — fictional company'),
    block('starter-monthly', 'body', `Starter is ${money(facts.plans.starter.monthlyCents)} a month for customers without legacy eligibility.`),
    block('starter-annual', 'body', `Starter is ${money(facts.plans.starter.annualCents)} a year, or ${money(Math.round(facts.plans.starter.annualCents / 12))} a month billed annually.`),
    block('legacy-rule', 'body', `Active Starter monthly subscribers whose subscription began before ${facts.change.legacyCutoff} keep ${money(facts.change.legacyRateCents)} a month.`),
    block('team-monthly', 'body', `Team is ${money(facts.plans.team.monthlyCents)} a month.`),
    block('business-monthly', 'body', `Business is ${money(facts.plans.business.monthlyCents)} a month.`),
    block('fact-version', 'body', `Fact snapshot ${facts.version}; effective date ${facts.effectiveDate}. This page renders directly from facts.`),
  ].join('\n\n') + '\n';
  const html = renderSource(parseSource(source, 'site/pricing.md', 'web'));
  const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1];
  if (!body) throw new Error('Canonical pricing renderer produced no body.');
  return body.replace(/(<script type="application\/json" id="asset-meta">)([\s\S]*?)(<\/script>)/, (_, opening: string, json: string, closing: string) => {
    const metadata = JSON.parse(json);
    return opening + JSON.stringify({ ...metadata, editable: false, file: null, sourceHash: hashRecord(facts) }).replace(/</g, '\\u003c') + closing;
  });
}
