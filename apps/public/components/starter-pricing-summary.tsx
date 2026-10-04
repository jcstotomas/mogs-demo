import facts from '../../../data/facts.json';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const cutoff = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC',
}).format(new Date(facts.change.legacyCutoff));

export default function StarterPricingSummary() {
  const { monthlyCents, annualCents } = facts.plans.starter;
  return <section className="starter-summary" aria-labelledby="starter-summary-title">
    <h2 id="starter-summary-title">Starter pricing</h2>
    <dl className="starter-summary-rates">
      <div>
        <dt>Monthly</dt>
        <dd>{money.format(monthlyCents / 100)}<span> / month</span>
          <p>For customers without legacy eligibility.</p>
        </dd>
      </div>
      <div>
        <dt>Annual</dt>
        <dd>{money.format(annualCents / 100)}<span> / year</span>
          <p>Billed annually.</p>
        </dd>
      </div>
      <div>
        <dt>Eligible legacy monthly</dt>
        <dd>{money.format(facts.change.legacyRateCents / 100)}<span> / month</span>
          <p>Only active Starter monthly subscriptions begun before {cutoff} UTC qualify.</p>
        </dd>
      </div>
    </dl>
    <p className="starter-summary-note">Existing customer status alone does not qualify. Lapsed customers returning through win-back pay {money.format(monthlyCents / 100)} a month.</p>
  </section>;
}
