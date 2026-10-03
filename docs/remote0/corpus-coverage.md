# Remote 0 corpus and evaluation coverage proposal

**Current dispatch note:** The [revised build plan](../../BUILD_PLAN.md) supersedes the historical A/D ownership and combined Remote 0 dispatch restrictions below. One builder A now owns corpus and evaluation: isolated miniature/coverage/evaluation preparation starts after Remote 0A; active 22-asset content, sitemap and seed expansion waits for Remote 1. Shared coverage contracts remain coordinator-owned. The original proposal, fixture counts and failed/unpassed evidence below are preserved; they do not claim implementation of the expanded corpus.

Status: design only. This document does not expand the corpus, freeze executable v2 contracts, or pass a remote gate. A may implement the inventory only after Remote 0's executable baseline and the Remote 1 miniature PR/preview/merge/public-verification path pass. The coordinator assigned this document as the only writable path for this support task.

## Existing evidence and seed boundary

The current pristine seed is `content/seed.json`, scope `miniature-gate-1`, with source files `site/launch.md`, `email/onboarding.md`, and `email/eligible.md`. Its corpus hash is `d06e2ce4f49190e3468f37991cb05f269c116c43857bea0600574f038c75b14c`; manifest hash is `a522b51fb93940d3c943c16b9aaf9524afb43f8b8c09d04675fcd997da530508`. The current manifest contains 33 editable blocks, all featured: six contradictions, seven consistent, five valid exceptions, twelve unrelated, and three ambiguous. Five contradictions have deterministic repairs; the sixth is the withheld threshold.

The live `site/launch.md`, onboarding email and `data/facts.json` already differ from pristine seed after local Gate 1. Expansion must start from the committed seed images and seed facts in an isolated checkout, preserving historical local evidence. Do not promote the already-corrected local files to the new old-price seed.

IDs retain the frozen grammar: `assetId = surface + ':' + content-relative POSIX Markdown path`; `passageId = assetId + '#' + sourceId`. Every new editable claim is authored by `agent`. No claim below has been tested against a provider, and no held-out outcome has influenced its selection.

## Exact proposed 22-asset inventory

Rows 3–12 contain two held-out deterministic representatives each. Rows 13–18 contain two tuning deterministic cases each. The passage tables below pin their assignments. Page metadata defaults to `audienceHint: new_customers`, `legacyStarterEligible: false`; any different context is listed explicitly. Neutral heading blocks remain protected and accurately labelled. Each source text stays a plain single-line marked block.

| # | Public path | Asset ID / source | Coverage |
|---|---|---|---|
| 1 | `/site/pricing` | `web:site/pricing.md`; no editable file | Fact-driven canonical output; old $30 until publication, then $40. No repair representative. |
| 2 | `/site/launch` | `web:site/launch.md` | Retain pristine 13-block featured miniature, including four repair kinds, threshold, preservation and ambiguity. |
| 3 | `/site/starter-offer` | `web:site/starter-offer.md` | Direct H1; savings H1. |
| 4 | `/site/starter-renewal` | `web:site/starter-renewal.md` | Direct H2; per-day H1. |
| 5 | `/site/starter-cost` | `web:site/starter-cost.md` | Direct H3; gap H1. |
| 6 | `/site/monthly-plans` | `web:site/monthly-plans.md` | Direct H4; savings H2. |
| 7 | `/site/billing-choice` | `web:site/billing-choice.md` | Direct H5; per-day H2. |
| 8 | `/site/annual-comparison` | `web:site/annual-comparison.md` | Savings H3; gap H2. |
| 9 | `/site/annual-help` | `web:site/annual-help.md` | Savings H4; per-day H3. |
| 10 | `/site/annual-faq` | `web:site/annual-faq.md` | Savings H5; gap H3. |
| 11 | `/site/daily-help` | `web:site/daily-help.md` | Per-day H4; gap H4. |
| 12 | `/site/plan-comparison` | `web:site/plan-comparison.md` | Per-day H5; gap H5. |
| 13 | `/site/starter-basics` | `web:site/starter-basics.md` | Direct T1; savings T1. |
| 14 | `/site/monthly-checkout` | `web:site/monthly-checkout.md` | Direct T2; per-day T1. |
| 15 | `/site/monthly-help` | `web:site/monthly-help.md` | Direct T3; gap T1. |
| 16 | `/site/annual-overview` | `web:site/annual-overview.md` | Savings T2; per-day T2, with separate explicit scope headings. |
| 17 | `/site/annual-calculator` | `web:site/annual-calculator.md` | Savings T3; gap T2; public statements explicitly scoped. |
| 18 | `/site/daily-planner` | `web:site/daily-planner.md` | Per-day T3; gap T3. |
| 19 | `/site/account-rules` | `web:site/account-rules.md` | Protected historical/legacy/annual/add-on; unknown existing-customer eligibility; tuning threshold. Metadata `unspecified`, eligibility `null`. |
| 20 | `/site/offer-context` | `web:site/offer-context.md` | Unknown plan and billing; correct public price; unrelated fee; held-out threshold. Metadata `unspecified`, eligibility `null`. |
| 21 | `/assets/email/onboarding` | `email:email/onboarding.md` | Retain pristine paired onboarding case and its protected/ambiguous blocks. |
| 22 | `/assets/email/eligible` | `email:email/eligible.md` | Retain pristine eligible counterpart. No eligible contradiction; whole file stays byte-identical. |

This is 20 web assets, of which 19 are editable, plus two editable email templates. All 22 assets are crawled for the required remote workload. Canonical pricing participates in source/deployment observation and deterministic fact update, not automatic content repair accuracy.

## Deterministic targets and frozen replacement rule

All representative and tuning repair rows below have `expectedLabel: contradicting`, target scope `public`, and desired scenario `mogs-starter-2026-10-03`. The targets come from code-derived desired facts, never from model arithmetic:

| Kind | Typed target | Exact replacement assertion |
|---|---|---|
| `direct_price` | `{value: 40, unit: usd, scope: public}` | Replace the one stale $30 or `thirty dollars` amount with $40 or `forty dollars`, as specified; preserve every other byte. |
| `annual_savings` | `{value: 40, unit: percent, scope: public}` | Replace the one stale 20% or `twenty percent` amount with 40% or `forty percent`; preserve every other byte. |
| `per_day` | `{value: 1.33, unit: usd_per_day, scope: public}` | Replace the one stale $1/$1.00/`one dollar` amount with `$1.33`; preserve the explicit per-day unit and all other bytes. |
| `plan_gap` | `{value: 40, unit: usd, scope: public}` | Replace the one stale $50 or `fifty dollars` comparison amount with $40 or `forty dollars`; preserve every other byte. |

Exact expected replacement strings must be expanded into the manifest at seed generation; the evaluator must not infer assertions from whatever the model returns. Candidate/preview/public evaluation checks target units, exact block outcome, unchanged qualifiers and neighboring protected blocks, with separate provenance for each environment. Final fact version is the frozen desired snapshot identity of the fresh v2 attempt; do not assume every future attempt uses v1 version 2.

## Held-out independent representative set

The family ID is the canonical `templateId`, not a page name or a text hash. Freeze exactly the following 20 representative passage IDs before tuning. These are five distinct structural/context families per kind; the structure column states the distinction to review before accepting the freeze. Every member or copy of one family inherits its split. Case, punctuation, plan-name, amount, or synonym changes never create another independent family.

### Direct price — target $40 monthly

| Family / distinction | Frozen representative passageId | Pristine source text | Replacement |
|---|---|---|---|
| `direct-h1-tariff-fragment` — labelled tariff fragment | `web:site/starter-offer.md#direct-h1` | Starter · monthly billing · $30 for a new account. | Only `$30` → `$40`. |
| `direct-h2-recurring-event` — amount bound to renewal event | `web:site/starter-renewal.md#direct-h2` | A new Starter subscription renews each month for $30. | Only `$30` → `$40`. |
| `direct-h3-amount-first-obligation` — currency amount precedes its recurring-charge referent | `web:site/starter-cost.md#direct-h3` | Thirty dollars is the recurring charge on a new Starter account with monthly billing. | Only `Thirty dollars` → `Forty dollars`. |
| `direct-h4-multiplan-binding` — correct price must bind to the right plan | `web:site/monthly-plans.md#direct-h4` | Monthly subscriptions for new customers cost $30 for Starter and $80 for Team. | Only `$30` → `$40`; retain `$80`. |
| `direct-h5-billing-branch` — monthly and unchanged annual alternatives | `web:site/billing-choice.md#direct-h5` | If a new customer selects monthly Starter billing, the charge is $30; annual Starter billing is $288. | Only `$30` → `$40`; retain `$288`. |

### Annual savings — target 40 percent

| Family / distinction | Frozen representative passageId | Pristine source text | Replacement |
|---|---|---|---|
| `savings-h1-percent-first-badge` — percentage-first offer with explicit reference | `web:site/starter-offer.md#savings-h1` | 20% annual savings for new Starter customers, measured against twelve monthly payments. | Only `20%` → `40%`. |
| `savings-h2-year-total-reduction` — twelve-month spending comparison | `web:site/monthly-plans.md#savings-h2` | A new customer's yearly Starter bill falls by 20% when paid annually instead of month by month. | Only `20%` → `40%`. |
| `savings-h3-conditional-choice` — conditional annual choice | `web:site/annual-comparison.md#savings-h3` | If a new Starter customer chooses annual billing instead of twelve monthly payments, the saving is 20%. | Only `20%` → `40%`. |
| `savings-h4-billing-option-binding` — percentage belongs to annual, not monthly option | `web:site/annual-help.md#savings-h4` | For new Starter accounts, monthly billing has no annual-payment discount; the annual option reduces the twelve-month cost by 20%. | Only `20%` → `40%`. |
| `savings-h5-question-answer` — question identifies comparison; short answer supplies percentage | `web:site/annual-faq.md#savings-h5` | How much does a new Starter customer save by choosing yearly billing instead of twelve monthly payments? 20%. | Only `20%` → `40%`. |

### Per-day cost — target $1.33 per day, 30-day month

| Family / distinction | Frozen representative passageId | Pristine source text | Replacement |
|---|---|---|---|
| `daily-h1-labelled-equivalent` — labelled daily equivalent | `web:site/starter-renewal.md#daily-h1` | Daily equivalent for Starter monthly billing (new customers; 30-day month): $1.00 per day. | Only `$1.00` → `$1.33`. |
| `daily-h2-conditional-allocation` — monthly total allocated over fixed days | `web:site/billing-choice.md#daily-h2` | If you spread new-customer Starter monthly billing over 30 days, budget $1 per day. | Only `$1` → `$1.33`. |
| `daily-h3-calendar-budget` — daily budgeting instruction with fixed-month qualification | `web:site/annual-help.md#daily-h3` | Set aside $1 per day for a new Starter monthly subscription; this daily equivalent assumes a 30-day month. | Only `$1` → `$1.33`. |
| `daily-h4-question-answer` — question carries period/context | `web:site/daily-help.md#daily-h4` | On a 30-day month, what daily amount represents a new Starter monthly subscription? $1 per day. | Only `$1` → `$1.33`. |
| `daily-h5-billing-option-binding` — daily monthly rate contrasted with correct annual effective rate | `web:site/plan-comparison.md#daily-h5` | For new customers, Starter monthly billing equals $1 per day on a 30-day month; annual billing remains $24 effective per month. | Only `$1` → `$1.33`; retain `$24`. |

### Plan gap — target $40 monthly difference

| Family / distinction | Frozen representative passageId | Pristine source text | Replacement |
|---|---|---|---|
| `gap-h1-subtraction-label` — labelled ordered subtraction | `web:site/starter-cost.md#gap-h1` | Monthly price difference for new subscriptions: Team minus Starter equals $50. | Only `$50` → `$40`. |
| `gap-h2-upgrade-increment` — increment bound to upgrade invoice | `web:site/annual-comparison.md#gap-h2` | Moving a new customer from monthly Starter to monthly Team adds $50 to each monthly bill. | Only `$50` → `$40`. |
| `gap-h3-spelled-premium` — spelled currency premium with comparator | `web:site/annual-faq.md#gap-h3` | New monthly Team subscribers pay fifty dollars extra compared with Starter. | Only `fifty dollars` → `forty dollars`. |
| `gap-h4-reversed-question` — lower-price direction reverses comparison | `web:site/daily-help.md#gap-h4` | For new monthly subscriptions, how much less is Starter than Team? $50. | Only `$50` → `$40`. |
| `gap-h5-anaphoric-direction` — second clause resolves the comparator from the first | `web:site/plan-comparison.md#gap-h5` | Of the new-customer monthly prices, Team is higher; the difference from Starter is $50. | Only `$50` → `$40`. |

These distinctions are a proposed family taxonomy, not a claim of statistical independence or broad task generalization. In the pre-provider design review, merge any pair that amounts to a superficial paraphrase and add a genuinely different structure/context before seed freeze if fewer than five families remain. Do not rename, swap or remove a representative after seeing held-out results. All misses stay in the denominator.

## Tuning family assignments

The tuning set has three families per kind, giving 12 tuning versus 20 held-out deterministic families: 37.5/62.5, close to the specified 40/60. Featured miniature families remain separate. Tuning cases exercise context inheritance and explicit nonlegacy scope without moving showcased or observed examples into held-out gates.

| Kind / family | PassageId | Pristine text and required context | Expected replacement |
|---|---|---|---|
| direct / `direct-t1-first-charge` | `web:site/starter-basics.md#direct-t1` | A first-time Starter monthly checkout lists $30 due today. | `$30` → `$40`. |
| direct / `direct-t2-lapsed-return` | `web:site/monthly-checkout.md#direct-t2` | Returning after a lapse? Restart Starter on monthly billing at $30. | `$30` → `$40`. |
| direct / `direct-t3-eligibility-exclusion` | `web:site/monthly-help.md#direct-t3` | Without grandfathering, a monthly Starter subscription costs $30. | `$30` → `$40`. |
| savings / `savings-t1-lapsed-return` | `web:site/starter-basics.md#savings-t1` | For a lapsed customer restarting Starter, annual billing saves twenty percent compared with twelve monthly bills. | `twenty percent` → `forty percent`. |
| savings / `savings-t2-heading-inheritance` | `web:site/annual-overview.md#savings-t2` | Heading: `New Starter subscriptions: annual billing versus monthly billing`. Claim: `The annual discount is 20%.` | `20%` → `40%`; heading untouched. |
| savings / `savings-t3-explicit-public-in-legacy-context` | `web:site/annual-calculator.md#savings-t3` | For new subscriptions, Starter annual billing saves 20% relative to monthly payments; eligible legacy monthly rates are unchanged. Page audience may be existing/eligible; explicit public clause governs this claim. | `20%` → `40%`; retain legacy clause. |
| per-day / `daily-t1-lapsed-return` | `web:site/monthly-checkout.md#daily-t1` | For a lapsed customer restarting Starter monthly, allow $1 per day on a 30-day month. | `$1` → `$1.33`. |
| per-day / `daily-t2-heading-inheritance` | `web:site/annual-overview.md#daily-t2` | Separate heading: `New Starter monthly subscriptions: 30-day equivalent`. Claim: `Allow $1 per day.` | `$1` → `$1.33`; heading untouched. |
| per-day / `daily-t3-explicit-ineligibility` | `web:site/daily-planner.md#daily-t3` | For an ineligible returning Starter monthly customer, the daily equivalent is one dollar per day on a 30-day month. | `one dollar` → `$1.33`. |
| gap / `gap-t1-heading-inheritance` | `web:site/monthly-help.md#gap-t1` | Heading: `New subscriptions: monthly Team compared with monthly Starter`. Claim: `The monthly premium is $50.` | `$50` → `$40`; heading untouched. |
| gap / `gap-t2-lapsed-return` | `web:site/annual-calculator.md#gap-t2` | When restarting after a lapse, choosing monthly Team instead of monthly Starter adds a $50 monthly charge. | `$50` → `$40`. |
| gap / `gap-t3-explicit-ineligibility` | `web:site/daily-planner.md#gap-t3` | For customers without legacy eligibility, the monthly upgrade charge from Starter to Team is $50. | `$50` → `$40`. |

For the mixed-audience tuning web page, explicit body scope must govern both comparison claims, and unrelated template framing stays neutral. Fully specify metadata, ordering, heading, and immediate neighbors in the generated seed; they are part of a case, not editable tuning knobs for held-out passages. If a tuning structure clusters with an existing featured or held-out family during design review, place every member in one split and fill the vacated tuning/held-out slot before freezing.

## Featured, protection, ambiguity and withholding

Retain all 33 pristine miniature blocks in the featured split and preserve their current IDs. The featured wrong set has six detections: four deterministic web corrections, one onboarding direct correction, and the contradictory web threshold. The paired `starter-price` sentence remains exactly `Starter is $30 a month.` in both emails; its family stays featured, with distinct passage IDs and opposite outcomes. The eligible email has no eligible contradiction, so preserve the entire source image, frontmatter, Liquid tags and URLs.

Additional coverage below supplies different contexts in the two protection pages. These rows have null repair target/replacement except the two explicitly withheld thresholds. Their family IDs, source order, heading/neighbor context, expected label and split must be recorded before any run. Existing identical wording or copy variants inherit the original featured family, rather than entering another split.

| PassageId / split | Pristine text and context | Expected label / outcome |
|---|---|---|
| `web:site/account-rules.md#legacy-active` / heldout protection | Active Starter monthly subscribers whose subscription began before 2026-10-03 keep $30 a month. | `valid_exception`; exact preservation. |
| `web:site/account-rules.md#historical-release` / heldout protection | In our 2023 release, the monthly Starter list price was $30. | `valid_exception`; exact preservation. |
| `web:site/account-rules.md#annual-current` / heldout protection | A new Starter annual subscription totals $288, equivalent to $24 per month billed annually. | `consistent`; exact preservation. |
| `web:site/account-rules.md#unrelated-addon` / heldout protection | A separate Locations add-on carries a $30 monthly fee. | `unrelated`; exact preservation. |
| `web:site/account-rules.md#unknown-eligibility` / heldout ambiguity | Existing customers pay $30 a month for Starter. Metadata eligibility is `null`; no neighboring block establishes this statement's eligibility. | `insufficient_context`; no automatic proposal. |
| `web:site/account-rules.md#threshold-t1` / tuning | New monthly Starter accounts cost less than $35 a month. | `contradicting`, kind `threshold`; withhold `No deterministic safe target for threshold wording.` |
| `web:site/offer-context.md#unknown-plan` / heldout ambiguity | Our entry offer is $30 monthly. Metadata/heading/neighbors do not identify a plan. | `insufficient_context`; no automatic proposal. |
| `web:site/offer-context.md#unknown-billing` / heldout ambiguity | New Starter accounts cost $30. Metadata/heading/neighbors do not establish billing period. | `insufficient_context`; no automatic proposal. |
| `web:site/offer-context.md#already-current` / heldout protection | A first-time Starter subscription costs $40 each month. | `consistent`; exact preservation. |
| `web:site/offer-context.md#unrelated-service` / heldout protection | Our separate setup service has a $30 one-time fee. | `unrelated`; exact preservation. |
| `web:site/offer-context.md#threshold-h1` / heldout detection only | For new Starter subscriptions billed monthly, pay under $35 a month. | `contradicting`, kind `threshold`; same explicit withholding reason; excluded from deterministic repair denominators. |

Critical ordering rule: insert neutral nonpricing separator blocks where a preceding comparison or following correct claim would accidentally supply missing plan, billing or eligibility to an ambiguity case. In particular, `#unknown-eligibility` cannot have `#legacy-active` as its heading or immediate neighbor. Every separator is itself declared, labelled, counted and hashed. Reusing generic neutral separators gives workload rows, not independent accuracy evidence. If a passage's actual frozen context resolves the supposedly unknown field, correct the label before testing instead of forcing an ambiguous outcome.

For both emails, the pristine seed already supplies nonzero consistent, valid-exception, unrelated and ambiguous rows. A must check the eligible preheader's exact five-way label in the pre-test rubric review: it describes recipient scope without asserting a price, so `valid_exception` versus `unrelated` needs an explicit rubric decision. Preserve the original label/evidence as v1 history; any v2 label correction receives a reason and new label hash before evaluation, not a favorable post-run relabel.

## Separate mixed-scope fixture

Reserve the isolated test-only identity `email:email/mixed-scope.md`; it is absent from the required sitemap, deployed demo inventory and 22-asset denominators. Its eventual fixture belongs in an isolated fixture source tree, not live `content/email/` where the catalog would add a third email.

Metadata: `audienceHint: existing_customers`, `legacyStarterEligible: true`, `journey: mixed_scope_test`.

| Source ID | Exact source text | Expected desired-state outcome |
|---|---|---|
| `email-subject` | `Your MOGS account, {{ first_name }}` | Protected; retain literal tag. |
| `legacy-price` | `Your active pre-change Starter monthly subscription remains $30 a month.` | `valid_exception`; byte-identical. |
| `public-price` | `For new customers without legacy eligibility, Starter is $30 a month.` | `contradicting`, direct target $40; change only `$30` → `$40`. |
| `public-savings` | `For new customers, Starter annual billing saves 20% compared with twelve monthly payments.` | `contradicting`, savings target40%; change only20%→40%. |
| `annual-price` | `Starter annual billing remains $288 a year.` | `consistent`; byte-identical. |
| `account-link` | `Hi {{ first_name }}, visit https://mogs.example/account?ref=mixed&step=1.` | Protected; retain tag/URL order and exact text. |

This fixture proves that recipient metadata does not shield explicitly public claims. Require byte-identical protected block bodies, untouched source bytes outside the two approved replacements, and exact tokens/URLs; whole-email identity is intentionally not the success condition here. The showcased eligible counterpart continues to require whole-file identity. Test results must identify this separate fixture and cannot add email accuracy claims to the featured pair.

## Denominators, manifests and freeze contract

Freeze a typed coverage registry together with source/manifest/facts hashes. The current v1 manifest has `templateId` and `split`, but no explicit representative registry, independent-family validation or immutable full inventory. Remote 0 should freeze that cross-lane contract centrally; A and D must not infer representatives from whichever rows happened to return successfully.

A proposed registry records: corpus/scenario/version and seed commit; all22 assets including editable/read-only status; canonical familyId/templateId with kind and one split; all member passageIds; exactly one held-out representative passageId per deterministic family; expected before/desired fact identity; representative target/replacement assertions; source, manifest and registry hashes. Repeated historic/annual/add-on phrases currently have asset-specific template IDs; normalize them to shared semantic families in the new registry while preserving original v1 records.

| Report / gate | Frozen denominator | Required result / interpretation |
|---|---|---|
| Independent held-out direct | 5 `direct-h*` representatives | At least4 detected,4 correct checked repairs,4 preview-verified and4 production-verified; report each numerator separately. |
| Independent held-out savings | 5 `savings-h*` representatives | Same4/5 thresholds. |
| Independent held-out per-day | 5 `daily-h*` representatives | Same4/5 thresholds. |
| Independent held-out gap | 5 `gap-h*` representatives | Same4/5 thresholds. |
| Independent aggregate | 20 frozen representatives | At least16/20 detected plus each kind's4/5 gate; a16/20 aggregate can fail if one kind is3/5. |
| Full held-out contradicting web rows | 20 deterministic representatives + held-out threshold; copies only if separately frozen | At least80% detected; with proposed21 unique rows this needs17/21. Report duplicate-heavy row rates as workload evidence. Threshold detected/withheld does not count as a repair failure. |
| Featured wrong | 6 retained miniature contradiction IDs | 6/6 detection. Named deterministic repairs, spanning web/onboarding group and canonical verification must also pass. |
| Tuning | 12 deterministic tuning cases + tuning threshold | Configuration selection only; cannot satisfy held-out or featured gates. |
| Protection / ambiguity | Every frozen row with expected consistent, valid_exception, unrelated or insufficient_context, by surface/class | Zero automatic proposals, including drafts later withheld/dropped; exact protected-block preservation. Report nonzero denominators. |
| Workload | Exactly22 assets, all crawl/manifest blocks and candidates; every provider stage/error recorded | First complete group≤90s and all results≤180s; no independent accuracy inflation from repeated families. |
| Canonical fact output | Fact-backed pricing blocks, desired fact image and matching deployment | Verify old public facts before submission and desired facts in candidate/preview/production; no editable repair representative. |
| Mixed-scope | Separate isolated fixture's frozen blocks | Context/preservation regression only; outside required22 scope and email pair metrics. |

A filtered, missing, provider-error, failed-check, stale, or withheld deterministic representative remains in every relevant full independent denominator as unsuccessful. Preview and production verification are separately scored; neither inherits a passing status from the other. Production scoring reads immutable observations from a named complete22-asset run with matching seed/manifest/desired facts/provider configuration. Local isolated successes cannot stand in for deployed evidence.

Before neutral framing/separators/context headings, the proposed workload has37 deterministic eligible contradiction rows (20 held-out +12 tuning +4 featured web +1 featured onboarding),3 contradictory thresholds, and32 new deterministic passages across16 pages. These are design counts, not runtime candidate counts. Original33 blocks plus32 new deterministic rows plus11 protection/threshold rows total76 claim/framing blocks before new page headings/separators; final hashes, role counts, total blocks and vocabulary-prefilter candidates must come from the generated source and exact crawl. No content or runtime counts are frozen by this document.

## Feasibility and design risks

1. **Timing grows with candidate count, not22 URLs alone.** The proposal requires37 deterministic fixes plus contextual rejudging, protection classification, final combined-tree checks and later deployed verification. Most of those stages are provider calls. Short pages help crawl/token cost; they do not eliminate per-passage latency. Freeze concurrency/deadline/usage configuration centrally, measure both analysis targets on the actual frozen22 scope, retain missed results, and keep submission/deployment/human waiting separately timed.
2. **Unit normalization is narrower than the promised source variation.** Current `numbers_allowed` recognizes `usd_per_day` only when `a/per/each day` follows a currency amount. The proposed per-day originals and replacements retain an explicit amount-adjacent `per day` so they are executable against that interface. Forms such as `daily equivalent: $1.33`, cents, `$1.33/day` or an inverted sentence need coordinator-reviewed normalization fixtures before use. Existing v1 qualifier matching also uses a finite phrase list; candidate semantics still require contextual checks and fixture outcomes.
3. **Context can invalidate supposedly independent or ambiguous cases.** Headings/neighbor blocks are judge inputs. Never let a price fragment borrow a plan/billing from an unintended neighbor, or let an ambiguity case borrow a legacy rule. Freeze source ordering and hashes along with representatives. Review structural taxonomy before testing; five superficially different sentences are not five families.
4. **Observed featured copy must not become held-out evidence.** All current seed examples stay featured. The old manifest's shared historical/annual/add-on wording requires consistent family clustering. Future200-asset copies increase workload counts only; they do not enlarge the independent20-representative set.
5. **A whole protected email can conflict with a legitimate public correction.** The showcased eligible file deliberately has none. Keep mixed-scope testing isolated and check protected blocks rather than whole-file identity there. Do not change the two-email inventory to make this test convenient.
6. **V1 schema cannot express every v2 freeze requirement yet.** The coordinator must define the coverage registry, attempt-scoped desired-fact identity, source/deployment provenance, and preview/public outcomes before A/D dispatch. This document does not bypass that Remote0 blocker.
7. **Coverage is a synthetic regression guarantee.** Agent-authored families and five representatives per kind are small controlled tests. Passing4/5 is useful release evidence for this scenario, not a confidence interval, independent model correctness proof, production customer accuracy, or an email-sending integration.

Completion of this support task means this proposal exists and its inventory/representative counts are checked. It does not start A–D, mutate content/facts/state, call providers, approve corrections, create a PR, reset, or deploy.

## Narrow Remote 0 executable fixture support

The coordinator separately authorized `lib/metrics/coverage-contract.ts`, `fixtures/remote/coverage-miniature.json`, and `tests/remote-coverage.test.ts` as shared contract support while A–D remain paused. The fixture maps the existing33 pristine cases into17 semantic families, all featured, with three editable assets and zero held-out representatives. Its registry hash is `ab51894c7ca90d69c6a943851de107380932f0651dd3e9206920c09d7dae06de`; it is explicitly `evidenceKind: fixture`, with no source commit claim. Every independent per-kind gate reports `not_eligible`,0/0 and null pass status. It is not an implementation of the proposed22 inventory or20 representatives.

`freezeCoverageRegistry` validates family/member/split/author/source identities, target units and pinned targets, exact-text copy clustering, and the immutable registry hash. `assertCoverageResolution` requires every case to resolve exactly once with exact source text and optional full asset/hash equality. `scoreCoverage` keeps independent representative and full-row workload denominators separate; it reports protection/ambiguity counts by class/surface and missing/error observations instead of treating absent evidence as a clean pass. Preview and production scores stay separate.

Eight provider-free contract tests verify the pristine miniature mapping, tamper/source failures, invalid representatives, featured/tuning exclusion, same-family copy handling, the4/5 threshold with full denominators, independent environment results, and protection/ambiguity failure visibility. Fake identities in test code exercise counting rules only; they do not create live content, source claims, independent test families, or model performance evidence. Full package/type/build verification and contract integration belong to the coordinator.
