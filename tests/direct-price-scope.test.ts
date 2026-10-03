import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDirectPriceScope } from '../lib/pipeline';
import { JudgmentSchema, type Judgment } from '../lib/types';

const decision = JudgmentSchema.parse({
  runId: 'scope-regression', passageId: 'web:site/arbitrary.md#offer', factVersion: 2,
  relevant: 1, kind: 'direct_price', audience: 'unspecified', billing: 'monthly', label: 'contradicting',
  confidence: null, probabilities: null, confidenceSource: 'unavailable', adapter: 'frontier',
  model: 'recorded-test-model', escalatedBy: null,
});

test('direct-price decisions require source-supported Starter and billing scope before drafting', () => {
  const unknownPlan = normalizeDirectPriceScope(decision, { text: 'Our entry offer is $30 monthly.', heading: 'MOGS offer context — fictional company' });
  assert.equal(unknownPlan.label, 'insufficient_context'); assert.equal(unknownPlan.escalatedBy, 'scope_conflict');
  assert.equal(unknownPlan.billing, 'monthly'); assert.equal(unknownPlan.passageId, decision.passageId);

  const unknownBilling = normalizeDirectPriceScope(decision, { text: 'New Starter accounts cost $30.', heading: 'MOGS offer context — fictional company' });
  assert.equal(unknownBilling.label, 'insufficient_context'); assert.equal(unknownBilling.billing, 'unspecified');
  assert.equal(unknownBilling.escalatedBy, 'scope_conflict');

  const resolved = [
    { text: 'Starter is $30 a month.', heading: 'MOGS plans' },
    { text: 'New accounts cost $30.', heading: 'Starter monthly subscriptions' },
    { text: 'New subscriptions cost $30 each month.', heading: 'Starter subscriptions' },
    { text: 'Starter is $30 monthly.', heading: 'Annual Starter billing' },
    { text: 'Monthly subscriptions cost $30 for Starter and $80 for Team.', heading: 'MOGS plans' },
    { text: 'New Starter subscriptions are $30 monthly or $288 when billed annually.', heading: 'MOGS billing choices' },
  ];
  for (const passage of resolved) assert.deepEqual(normalizeDirectPriceScope(decision, passage), decision, passage.text);

  const unresolved = [
    { text: 'Our entry offer costs $30.', heading: 'MOGS plans' },
    { text: 'Team costs $30 monthly.', heading: 'Starter monthly subscriptions' },
    { text: 'New subscriptions cost $30.', heading: 'Starter monthly and annual subscriptions' },
    { text: 'Starter is $30 annually.', heading: 'Starter monthly subscriptions' },
  ];
  for (const passage of unresolved) {
    const result = normalizeDirectPriceScope(decision, passage);
    assert.equal(result.label, 'insufficient_context', passage.text); assert.equal(result.escalatedBy, 'scope_conflict');
  }

  const unrelated: Judgment = { ...decision, label: 'unrelated' };
  assert.deepEqual(normalizeDirectPriceScope(unrelated, { text: 'A setup service has a $30 fee.', heading: 'MOGS offers' }), unrelated);
  const derived: Judgment = { ...decision, kind: 'annual_savings' };
  assert.deepEqual(normalizeDirectPriceScope(derived, { text: 'Annual billing saves 20%.', heading: 'MOGS offers' }), derived);
});
