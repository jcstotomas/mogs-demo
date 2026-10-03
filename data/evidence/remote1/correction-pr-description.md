## Summary

```diff
- Starter monthly: $30
+ Starter monthly: $40
```

4 approved complete correction groups combine 5 checked edits with the deterministic `data/facts.json` update in one candidate.

## Evidence

- **Before:** deployed Starter monthly $30, fact version 1; base `e573c2608ce3fa54f51cab67594355448aa1059b`, deployment `dpl_J4vVHRyNZC5QfB9BafiaaeurmzDJ`.
  **After:** checked candidate Starter monthly $40, fact version 2; candidate `9856d289c8bebeeeb802496f9bc1e69cac1849fe`. Public publication follows a separate human GitHub merge.

Run: `07c47d90-b32a-45cf-9b33-97571ca7819c` · attempt: `32907448-eec5-43d9-8db1-20cbb47494cd` · 2 web assets including canonical pricing + 2 email previews.
Judge: frontier/claude-sonnet-5-5 · prompt gate1-v2. Original Confirm: 2026-10-03T21:34:32.675Z. First complete group: 31163 ms; all results ready: 31163 ms.

Facts: `a0512f91ade4e8dfc3e73df89d2661eddcf409dbfb8cecf0f0ac71c987767664` → `d8d3572f382592e750561c2d8665f5673a0e80b630341abec6cf17e8cc41ca1d`. Bundle: `7e8f2b9e0a4ec3a3dbb2e913d2be3ea619cce17912c0e0932b0d92349ab42639`. Mapped tree: `0966d87f1b1159c0c07d45c85c3695d38a26867f6e2a9d6cee251b516482d975`.

### Annual savings to 40%

Approval: human · revision 0 · 2026-10-03T21:43:18.971Z. Excluded members: 0.

| Location | Before | After | Combined checks | Factual rationale |
|---|---|---|---|---|
| content/site/launch.md#annual-savings (web) | Save 20% on Starter with annual billing. | Save 40% on Starter with annual billing. | 7/7 passing (span\_confined, numbers\_allowed, qualifiers\_kept, source\_located, source\_fresh, fact\_fresh, rejudge\_consistent) | The confirmed facts give annual\_savings\_percent after = 40 percent, matching the supplied target (40, percent). Only the number changes. The Starter, annual billing and savings wording are kept, and nothing is added. |

### Starter monthly price to $40

Approval: human · revision 0 · 2026-10-03T21:43:20.850Z. Excluded members: 0.

| Location | Before | After | Combined checks | Factual rationale |
|---|---|---|---|---|
| content/email/onboarding.md#starter-price (email) | Starter is $30 a month. | Starter is $40 a month. | 8/8 passing (span\_confined, numbers\_allowed, qualifiers\_kept, tokens\_kept, source\_located, source\_fresh, fact\_fresh, rejudge\_consistent) | The page is an onboarding email for new customers who are not legacy-eligible, so the current monthly Starter price of $40 applies. Only the dollar amount changed; the 'a month' billing qualifier is kept and nothing is added. |
| content/site/launch.md#starter-price (web) | Starter is $30 a month. | Starter is $40 a month. | 7/7 passing (span\_confined, numbers\_allowed, qualifiers\_kept, source\_located, source\_fresh, fact\_fresh, rejudge\_consistent) | The passage states the old Starter monthly price of $30. The confirmed public price for non-legacy customers is $40 a month, and this page is for new customers, so the legacy $30 rate does not apply. Only the amount changes; the monthly billing qualifier is kept and nothing is added. |

### Daily cost to $1.33

Approval: human · revision 0 · 2026-10-03T21:44:28.005Z. Excluded members: 0.

| Location | Before | After | Combined checks | Factual rationale |
|---|---|---|---|---|
| content/site/launch.md#per-day (web) | Starter costs about a dollar a day. | Starter costs about $1.33 a day. | 7/7 passing (span\_confined, numbers\_allowed, qualifiers\_kept, source\_located, source\_fresh, fact\_fresh, rejudge\_consistent) | The target for this passage is 1.33 usd\_per\_day. The page is for new customers, who are not legacy-eligible, so the new Starter rate applies and 'a dollar a day' is out of date. I changed only that figure and left the rest of the sentence as written. |

### Monthly plan gap to $40

Approval: human · revision 0 · 2026-10-03T21:44:32.939Z. Excluded members: 0.

| Location | Before | After | Combined checks | Factual rationale |
|---|---|---|---|---|
| content/site/launch.md#plan-gap (web) | Team is only $50 a month more than Starter. | Team is only $40 a month more than Starter. | 7/7 passing (span\_confined, numbers\_allowed, qualifiers\_kept, source\_located, source\_fresh, fact\_fresh, rejudge\_consistent) | The Starter monthly price is now $40 for this new-customer audience, so the supplied team\_starter\_gap\_usd target of 40 replaces the outdated $50. Wording and unit are otherwise unchanged. |

### Exclusions and preservation

- web:site/launch.md#threshold: withheld — No deterministic safe target for this claim kind; reviewer context is required..
- Classified exclusions: 10 consistent; 5 valid_exception; 5 unrelated; 3 insufficient_context. Lexically excluded blocks: 10.
- Applicable paired source/context, numeric, qualifier, fact and email-token checks passed for every included edit. Protected blocks remain unchanged; email preview publication does not send messages.
- Unchanged source: content/email/eligible.md · SHA-256 `00f445cba9e475a4769f3d2c0d6e57a881588d35e2df69dd5ffa5b0d2ba2b0d0`.

### Deployment evidence

- **Verified preview:** [matching candidate preview](https://mogs-demo-pw6a4zpzq-jcstotomas-projects.vercel.app/) · deployment `dpl_BaY7EU11Dx7gGH6UHdtyGWZn1jb6` · observed 2026-10-03T21:45:55.326Z; 5 changed blocks passed fresh rendered checks, complete source preservation and canonical pricing.
- Recorded production: deployment `dpl_7beAQpjQcnwkSAzbT9AUJ2W6zQZj`, merged commit `308d64631320acf022ceef9620eb161369305c2f`; build ready, rendered verification passed, observed 2026-10-03T21:58:41.809Z.

## Merge Danger

**Door:** two-way

Publication can be reversed through a separately checked, human-merged seed-restoration PR.

**Blast Radius:** Content

Controlled fictional web pages, canonical pricing and repository-backed email previews.

<!-- mogs-operation:9b1a54b6-2eb5-4af5-9941-e0712ac0ae83;attempt:32907448-eec5-43d9-8db1-20cbb47494cd;bundle:7e8f2b9e0a4ec3a3dbb2e913d2be3ea619cce17912c0e0932b0d92349ab42639 -->
