import { FactSnapshotSchema, type FactSnapshot, type Target, type ClaimKind } from '../types';
export function deriveFacts(facts: Omit<FactSnapshot, 'derived'>): FactSnapshot['derived'] {
  const before = facts.change.fromCents, after = facts.change.toCents;
  const annual = facts.plans.starter.annualCents;
  const delta = (unit: Target['unit'], fn: (monthly: number) => number) => ({ unit, before: fn(before), after: fn(after) });
  return {
    annual_savings_percent: delta('percent', monthly => Math.round(100 * (1 - annual / (monthly * 12)) * 100) / 100),
    per_day_usd: delta('usd_per_day', monthly => Math.round(monthly / 30) / 100),
    lowest_monthly_usd: delta('usd', monthly => Math.min(monthly, facts.plans.team.monthlyCents, facts.plans.business.monthlyCents) / 100),
    lowest_annual_effective_monthly_usd: delta('usd', () => Math.min(...Object.values(facts.plans).map(plan => plan.annualCents / 12)) / 100),
    team_starter_gap_usd: delta('usd', monthly => (facts.plans.team.monthlyCents - monthly) / 100),
  };
}
export function initialFacts(): FactSnapshot {
  const base: Omit<FactSnapshot, 'derived'> = {
    scenarioId: 'mogs-starter-2026-10-03', version: 1, company: 'MOGS', phase: 'initial', effectiveDate: '2026-10-03',
    plans: { starter: { monthlyCents: 3000, annualCents: 28800 }, team: { monthlyCents: 8000, annualCents: 76800 }, business: { monthlyCents: 20000, annualCents: 192000 } },
    change: { id: 'starter-monthly-30-to-40', plan: 'starter', fromCents: 3000, toCents: 4000, billing: 'monthly', appliesTo: 'non_legacy_eligible', legacyRateCents: 3000, legacyCutoff: '2026-10-03T07:00:00.000Z' },
    exceptions: ['Only active Starter monthly subscriptions begun before the cutoff keep $30.', 'Existing customer alone is not eligibility; lapsed win-back customers pay $40.', 'Annual prices and genuinely historical statements are unchanged.'],
  };
  return FactSnapshotSchema.parse({ ...base, derived: deriveFacts(base) });
}
export function confirmedFacts(initial: FactSnapshot): FactSnapshot {
  if (initial.phase === 'confirmed') return initial;
  const next = { ...initial, version: initial.version + 1, phase: 'confirmed' as const, plans: { ...initial.plans, starter: { ...initial.plans.starter, monthlyCents: initial.change.toCents } } };
  return FactSnapshotSchema.parse({ ...next, derived: deriveFacts(next) });
}
export function targetForKind(kind: ClaimKind, facts: FactSnapshot): Target | null {
  const keys = { annual_savings: 'annual_savings_percent', per_day: 'per_day_usd', plan_gap: 'team_starter_gap_usd' } as const;
  if (kind === 'direct_price') return { value: facts.change.toCents / 100, unit: 'usd', scope: 'public' };
  if (kind === 'annual_savings' || kind === 'per_day' || kind === 'plan_gap') { const delta = facts.derived[keys[kind]]; return { value: delta.after, unit: delta.unit, scope: 'public' }; }
  return null;
}
