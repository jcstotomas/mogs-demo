# Launch Correction Agent: build spec

Code freeze is 5:00 PM PT. Solo build with parallel coding agents. This file is the contract. Anything not listed here is out of scope. The required demo is a 20-page live web run plus the paired emails; larger corpus and additional surfaces are added only after that path works.

## 1. What it does

When a product fact changes, the agent finds the marketing claims the change makes wrong across a company's website and lifecycle emails. Ad copy and sales decks extend the same path if time permits. It leaves valid exceptions alone, drafts checked fixes, groups them by correction, lets a marketer approve one group at a time, writes approved fixes to the locally served assets, and re-checks them in the browser.

Demo story: one scoped price change at a fictional company. Direct, implied, and derived claims get fixed. Eligible grandfathered, historical, and same-number-different-product claims are preserved. Ambiguous claims go to a person. One approval covers one correction group across every surface represented in that group.

## 2. Locked decisions

| Area | Decision |
|---|---|
| App | Next.js (App Router) + TypeScript, one repo, run locally with `next dev` for the demo |
| Corpus | Fictional company generated today: a website under `/site` plus emails, ads, and decks under `/assets`, all served by the same app. Every editable asset is a plain-block markdown file with stable source IDs, so publishing a fix is a local file write |
| Surfaces | Required: 20-page live web slice plus the paired onboarding and eligible-upgrade emails. Email uses the same crawl, judge, fix, and publish path. Remaining web corpus, other emails, ads, and decks follow only after the core demo works. See section 4a |
| Labels | Jev (typed decisions with probabilities) if it passes the three-case gate at the Step 0 provider deadline; one call per passage. Otherwise use the frontier adapter and report its eval separately |
| Fixes | A frontier model with structured output writes the replacement and a short rationale. Jev returns no text, so rationales cannot come from it |
| Judge fallback | The judge sits behind one interface with a second adapter that uses the frontier model. Switch with `JUDGE_ADAPTER=jev\|frontier`. Fallback confidence is unavailable or adapter-specific, never presented as Jev-equivalent probability |
| Retrieval | No vector store and no embeddings. A generous lexical prefilter passes candidates to the configured judge. Measure prefilter recall on planted claims; a vector store can slot in behind `candidates()` later |
| Storage | SQLite, one file at `data/app.db` |
| Scope | One pricing change handled deeply. Every substantive fix needs human approval. No auto-approve |

## 3. Scenario and facts

Company: **MOGS** (Member of GTM Staff; fictional team scheduling software). The site must say it is a demo.

| Plan | Monthly | Annual (per year) | Effective monthly on annual |
|---|---|---|---|
| Starter | $30, changing to **$40** | $288 | $24 |
| Team | $80 | $768 | $64 |
| Business | $200 | $1,920 | $160 |

**The change:** Starter goes from $30 to $40 a month for customers who do not qualify for the legacy rate, effective today. Confirming it updates the local canonical `/site/pricing` facts from $30 to $40; this is a real local fact change, not a hypothetical comparison.

**Exceptions:** only customers with an active Starter monthly subscription that began before the change keep $30 a month. An existing customer who lapsed and is returning through win-back does not qualify. Annual prices are unchanged. Statements about past prices stay as written. Eligibility is explicit asset context; `existing_customers` by itself is not proof of eligibility.

**Derived facts** are computed in `lib/facts/derive.ts` and never typed by hand. The judge is shown them so it compares values and does no arithmetic.

| Derived fact | Before | After |
|---|---|---|
| Starter annual savings | 20% | 40% |
| Starter cost per day (30-day month) | $1.00 | $1.33 |
| Lowest publicly offered monthly-billed price | $30 | $40 |
| Lowest effective monthly price (annual) | $24 | $24 |
| Team minus Starter, monthly | $50 | $40 |

Numbers were chosen so the savings math is exact. Derived values describe the public new-customer offer, not a legacy subscriber's bill.

## 4. Claim kinds and expected labels

Labels: `contradicting`, `consistent`, `valid_exception`, `unrelated`, `insufficient_context`.

| Kind | Example passage | Expected label | Fix target |
|---|---|---|---|
| direct_price | "Starter is $30 a month." on a new-customer page | contradicting | $40 |
| threshold | "Get started for under $35 a month, billed monthly." | contradicting | reviewer picks wording |
| per_day | "Starter costs about a dollar a day." | contradicting | about $1.33 a day |
| annual_savings | "Save 20% on Starter with annual billing." | contradicting | 40% |
| plan_gap | "Team is only $50 a month more than Starter." | contradicting | $40 |
| grandfathered | "Active pre-change Starter monthly subscribers keep their $30 rate." | valid_exception | none |
| historical | "When we launched in 2023, Starter cost $30 a month." | valid_exception | none |
| annual price | "Starter is $288 a year, or $24 a month billed annually." | consistent | none |
| already updated | "Starter is $40 a month for new customers." | consistent | none |
| still-true superlative | "Starter is our most affordable plan." | consistent | none |
| same number, other thing | "The Locations add-on is $30 a month." / "Cancel within 30 days." | unrelated | none |
| ambiguous | "Plans from $30." without a plan, billing interval, or eligibility qualifier | insufficient_context | escalate |

An unqualified Starter $30 claim on a new-customer page is `contradicting`, even while eligible legacy subscribers pay $30. The same unqualified sentence in an asset explicitly addressed to active pre-change Starter monthly subscribers is `valid_exception`. Do not infer eligibility from the word "existing" alone.

## 4a. Surfaces

Web is the primary surface and is built first. The paired emails are required for the demo. The remaining emails, ads, and decks are optional content collections served by the same app, listed in the same sitemap when enabled, and patched by the same file write. They differ in passages, metadata, and surface checks.

| Surface | Source files | Rendered at | Passages | Frontmatter | Extra check | Owner label |
|---|---|---|---|---|---|---|
| web | `content/site/**/*.md` | `/site/...` | paragraphs, list items, headings | kind, audienceHint | none | Web |
| email | `content/email/*.md`: target 24 emails in 4 journeys (onboarding, trial ending, upgrade nudge, win-back); build the paired onboarding and eligible-upgrade emails first | `/assets/email/[id]` | subject, preheader, body paragraphs | journey, audienceHint, legacyStarterEligible, sendsPerMonth | `tokens_kept` | Lifecycle |
| ads | `content/ads/*.md`: 30 text ads in 5 campaigns | `/assets/ads/[id]` | each headline and each description | campaign, landingUrl, dailySpend | `length_limit` | Paid |
| deck | `content/decks/*.md`: 2 decks of about 15 slides, split by `---` | `/assets/decks/[id]` | slide title, bullets, speaker notes | owner, lastUpdated | none | Sales enablement |

Rules:

- **Audience and legacy eligibility come from the asset.** Read `audienceHint` (new_customers, existing_customers, unspecified) and explicit `legacyStarterEligible` from frontmatter and pass both to the judge in `state.page`. The same sentence gets different labels: "Starter is $30 a month" is contradicting in an onboarding email to new signups and a valid exception in an upgrade email explicitly addressed to active pre-change Starter monthly subscribers. A lapsed win-back recipient has `legacyStarterEligible: false` and gets the new $40 rate. Unspecified eligibility yields `insufficient_context` when it matters.
- **Acquisition web pages identify their audience.** Set `audienceHint: new_customers` in frontmatter and render it in `asset-meta`; the crawler passes it to the judge. Other web pages use an explicit hint or `unspecified` rather than an inferred audience.
- **Ad fixes must fit.** `length_limit` uses the Google responsive search ad limits: 30 characters per headline, 90 per description. A fix that doesn't fit is withheld, never truncated.
- **Email tokens survive.** `tokens_kept` fails if any Liquid tag (`{{ ... }}`, `{% ... %}`) or URL in the original is missing or altered.
- **Groups stay keyed by correction, not by surface.** Each group shows its surface breakdown. One approval covers every eligible patch in that group, across the surfaces represented there. Price, savings, and per-day corrections are separate groups.
- **Volume numbers are scenario data.** `sendsPerMonth` and `dailySpend` are invented. Use them to sort findings, label them as scenario data, and never present them as measured impact.
- **Out of scope:** image creative (Jev reads text only), real PPTX or Google Slides files, and adapters for a real email or ad platform.

Full-corpus targets after the core demo: planted claims per surface are email 12, ads 12, decks 6, spread across the kinds in section 4 and including exception cases.

Build order: the 20-page web slice, the paired emails, then the remaining web corpus and emails, then ads, then decks. Ads, decks, and corpus size can be cut independently; the paired emails remain part of the required demo.

## 5. Repo layout and ownership

```
app/site/[...slug]/        A   fake site pages, sitemap.xml, pricing page (renders from facts)
app/assets/*               A   preview pages for emails, ads, and decks
content/site/**/*.md       A   plain-block page sources (frontmatter: title, kind, slug)
content/email, ads, decks  A   other surfaces, same markdown format (section 4a)
content/claims.yaml        A   claim template library
content/manifest.jsonl     A   one row per planted claim
scripts/generate-site.ts   A
scripts/reset.ts           A
lib/pipeline/*             B   crawl, prefilter, judge, fix, checks, group, publish, verify
app/api/*                  B
app/console/*              C   review UI except eval and baseline
components/*               C
scripts/eval.ts            D
lib/metrics/*              D
app/console/eval, baseline D
lib/types.ts, lib/db.ts    shared, frozen after step 0
lib/facts/*                 shared, frozen after step 0
data/facts.json, fixtures/ shared, frozen after step 0
```

Rule for agents: stay in your directories. Do not edit shared files. If a contract needs to change, stop and ask. Agent A must place stable `sourceId` markers in source blocks and expose the same IDs as `data-source-id` in rendered DOM; Agent B and D must join and locate by these IDs, not by passage text.

## 6. Shared contracts (`lib/types.ts`)

```ts
export type Label = "contradicting" | "consistent" | "valid_exception" | "unrelated" | "insufficient_context";
export type ClaimKind = "direct_price" | "annual_savings" | "threshold" | "per_day" | "plan_gap" | "other_pricing" | "none";
export type PlanId = "starter" | "team" | "business";
export type Surface = "web" | "email" | "ads" | "deck";
export type Audience = "new_customers" | "existing_customers" | "unspecified" | "historical";

export interface FactSheet {
  version: number;                       // +1 on every confirmed change
  company: string;
  effectiveDate: string;                 // ISO date
  plans: Record<PlanId, { monthly: number; annual: number }>;
  change: { plan: PlanId; from: number; to: number; billing: "monthly"; appliesTo: "non_legacy_eligible"; legacyRate: number; legacyCutoff: string } | null;
  exceptions: string[];                  // plain language, shown to the judge
  derived: Record<string, { before: number; after: number }>;  // filled by derive.ts
}

export interface Page {
  url: string; file: string; title: string; kind: string; hash: string; crawledAt: string; // hash = source-file bytes at crawl, exposed in asset-meta
  surface: Surface;
  meta: { audienceHint?: Audience; legacyStarterEligible?: boolean; journey?: string; sendsPerMonth?: number; campaign?: string; landingUrl?: string; dailySpend?: number; owner?: string };
}
export type Role = "body" | "heading" | "subject" | "preheader" | "headline" | "description" | "slide_title" | "notes";
export interface Passage { id: string; sourceId: string; url: string; surface: Surface; role: Role; idx: number; text: string; hash: string; heading: string; before: string; after: string } // id = stable passageId, built from asset ID + sourceId

export interface Judgment {
  passageId: string; factVersion: number;
  relevant: number;                      // 0..1
  kind: ClaimKind;
  audience: Audience;
  billing: "monthly" | "annual" | "unspecified";
  label: Label; confidence: number | null; probabilities: Partial<Record<Label, number>> | null;
  confidenceSource: "jev" | "frontier_adapter" | "unavailable";
  escalatedBy?: "low_confidence" | "cross_check";
  adapter: "jev" | "frontier";
}

export interface Check { name: "span_confined" | "numbers_allowed" | "qualifiers_kept" | "rejudge_consistent" | "source_located" | "source_fresh" | "fact_fresh" | "length_limit" | "tokens_kept"; pass: boolean; detail?: string }
export type PatchStatus = "drafted" | "withheld" | "dropped" | "approved" | "published" | "verified" | "failed_verify" | "stale";

export interface Patch {
  id: string; passageId: string; sourceId: string; url: string; surface: Surface; factVersion: number; pageHash: string;
  original: string; replacement: string; rationale: string;
  checks: Check[]; status: PatchStatus; groupId: string | null;
  editedByHuman: boolean; overridden: boolean; overrideReason?: string; overrideChecks?: Array<"span_confined" | "rejudge_consistent">; outlier: boolean;
}
export interface Group { id: string; factVersion: number; key: string; title: string; patchIds: string[]; bySurface: Record<Surface, number>; status: "open" | "blocked" | "approved" | "published" | "verified" | "failed_verify" }

export interface RunStats {
  pagesIndexed: number; passagesIndexed: number; candidates: number; judged: number;
  byLabel: Record<Label, number>;
  bySurface: Record<Surface, { assets: number; passages: number; contradictions: number; patches: number }>;
  patchesDrafted: number; withheld: number; groups: number;
  reviewActions: number; published: number; verified: number; machineMs: number; humanMs: number;
  firstReviewableGroupMs: number | null;  // from Confirm change to first reviewable group
}

export interface ManifestRow {
  id: string; passageId: string; sourceId: string; url: string; surface: Surface; text: string; kind: string; templateId: string;
  expectedLabel: Label; expectedValue?: string;
  split: "tuning" | "heldout" | "featured"; featured: boolean; author?: "jeremy" | "agent" | "generator";
}
```

Env: `AI_GATEWAY_API_KEY` or `TYPESAFE_API_KEY`, `JUDGE_ADAPTER`, `JUDGE_MODEL`, `FIX_MODEL`, `T_REL=0.2`, `T_LABEL=0.7`. Confidence and probability are different Jev outputs; do not substitute the selected label's probability for confidence. With the frontier fallback, use `null` for unavailable values or an explicitly adapter-specific score. Thresholds and evals are per adapter, never mixed.

## 7. Pipeline (Agent B)

```ts
crawl(baseUrl): Promise<{ pages: Page[]; passages: Passage[] }>   // sitemap.xml, fetch, cheerio on <main>, stable source IDs
prefilter(p: Passage): boolean                                    // generous lexical filter
judge(p: Passage, page: Page, facts: FactSheet): Promise<Judgment> // adapter: jev | frontier
draftFix(p, j, facts): Promise<{ replacement; rationale } | { withhold: true; reason }>
checkFix(original, replacement, p, j, facts): Promise<Check[]>
groupPatches(patches): Group[]
publish(groupId): Promise<void>
verify(urls: string[]): Promise<void>
recheckChanged(): Promise<void>                                   // re-judge only passages whose hash changed
```

**Crawl.** Every editable source block has a stable `sourceId` marker in its plain-block markdown source. Every rendered asset carries its frontmatter and source-file byte hash in `<script type="application/json" id="asset-meta">` and exposes each block's `data-role` and `data-source-id`. The crawler reads surface, metadata, role, source hash, and source ID from those, so one crawler serves all four surfaces. Extract `p`, `li`, `h1` to `h3`, `blockquote`, and marked elements without double-counting nested blocks. Build a stable `Passage.id` (`passageId`) from asset ID plus `sourceId`, never from text; identical email sentences must remain distinct. The publisher locates the exact source block by `sourceId` and checks its expected text.

**Prefilter.** Pass any passage with `$`, `%`, or a pricing word: price, pricing, cost, pay, fee, plan, a plan name, monthly, annual, yearly, billing, billed, subscription, save, savings, discount, cheaper, afford, upgrade, dollar, "a month", "a year", "a day". Bias toward passing too much.

**Judge (Jev).** One call per passage. State is JSON: `{ facts: { before, after, exceptions, derived }, page: { title, url, kind, surface, audienceHint, legacyStarterEligible, journey }, role, passage, before, after }`. Questions:

- `relevant` (noul): the passage makes an in-scope claim about Starter pricing or billing, an exception, a threshold, per-day cost, savings, a comparison, or a superlative. Include unchanged Starter annual claims and already-updated claims so they can be labeled `consistent`. Exclude unrelated prices and generic numbers. Relevance is broader than contradiction.
- `kind` (choice): the ClaimKind values, each with a one-line criterion.
- `audience` (choice): new_customers, existing_customers, unspecified, historical. Instruct it to use `page.audienceHint` when the passage itself doesn't say, and to use `page.legacyStarterEligible` for the legacy-rate exception. Existing-customer audience alone does not qualify.
- `billing` (choice): monthly, annual, unspecified.
- `label` (choice): the five labels, with these criteria:
  - contradicting: false under `facts.after` for the audience and billing it addresses.
  - consistent: an in-scope claim true under `facts.after`, including unchanged Starter annual prices and already-updated monthly claims.
  - valid_exception: states the old value but stays true because the asset explicitly qualifies for the legacy rate or the passage is historical.
  - unrelated: makes no in-scope Starter pricing, billing, comparison, or exception claim; for example, a $30 add-on or a 30-day cancellation window.
  - insufficient_context: the plan, audience, or billing interval cannot be determined.

**Decision rules, in code.**
1. `relevant < T_REL` gives `unrelated` only after unchanged in-scope Starter claims and explicit exception claims have been retained as candidates.
2. With Jev, confidence below the Jev-specific `T_LABEL` gives `insufficient_context` with `escalatedBy: "low_confidence"`. With the frontier fallback, do not apply this threshold to an unavailable or non-comparable score; show the adapter's uncertainty separately.
3. Cross-check: a `contradicting` judgment for `legacyStarterEligible: true` or historical context, or for an unchanged annual direct price, gives `insufficient_context` with `escalatedBy: "cross_check"`. An `existing_customers` hint alone does not trigger this exception. Cut this rule first if short on time.

**Fix (frontier model, structured output).** Inputs: passage, role, surface, neighbors, facts before and after, kind, and the target value from the derived facts. Rules in the prompt: change the smallest span, keep every qualifier, add no new claims, respect the length limit for ad roles, return `withhold` if the sentence cannot be fixed without changing its meaning. A threshold claim with no deterministic safe target (such as "under $35") stays withheld and outside an approvable group until a reviewer supplies and checks wording.

**Checks.** Hard failures set status `withheld` with the failing check named. Soft failures also withhold until the reviewer records a permitted override and reason. Re-run every check after a human edit and again at group preflight where freshness may have changed.
1. `span_confined`: word diff touches at most two short spans.
2. `numbers_allowed`: every number the edit introduces comes from the fact sheet's allowed values for that claim kind.
3. `qualifiers_kept`: original scope words (monthly, annual, billed, new customers, active pre-change subscribers, existing) remain; an edit cannot broaden an exception.
4. `rejudge_consistent`: judging the replacement in context returns `consistent` or `valid_exception`; Jev must also meet its `T_LABEL`. The frontier fallback reports a separate adapter-specific result without pretending it passed Jev confidence.
5. `source_located`: the stable `sourceId` exists exactly once in the source file and its block still equals the expected original text. Identical text elsewhere is allowed.
6. `source_fresh`: the source file still matches the captured `pageHash` before group publish. Compare once per file, before applying any patch.
7. `fact_fresh`: the confirmed fact version still matches the patch and group version.
8. `length_limit` (ads only): headline at most 30 characters, description at most 90.
9. `tokens_kept` (email only): Liquid tags and URLs unchanged.

`source_located`, `source_fresh`, `fact_fresh`, `numbers_allowed`, `qualifiers_kept`, `length_limit`, and `tokens_kept` are hard gates. A reviewer may override only `span_confined` or `rejudge_consistent`, with a recorded reason and check names. An overridden `rejudge_consistent` patch may be published, but it cannot be marked `verified` unless the browser re-fetch and fresh live re-judgment pass. Every human edit reruns all applicable checks, including source, fact, email, and ad checks.

**Grouping.** Key is `${kind}:${targetValue}`, across all surfaces. Title example: "Starter monthly price $30 to $40 (31 passages)". Fill `bySurface` on each group. Only patches with all hard checks passing and soft checks passing or expressly overridden may enter an approvable group. Withheld items, including unresolved threshold wording, remain outside it. Mark a patch as `outlier` when Jev confidence is under 0.85 or the cross-check disagreed; fallback scores must not be compared with the Jev threshold. Outliers sort to the top.

**Publish.** One click approves one correction group across its represented surfaces. Preflight **every** eligible patch in the group before writing: confirmed fact version, one original `pageHash` comparison per source file, unique `sourceId`, exact original block, hard checks, and recorded soft overrides. If any patch fails, block the whole group and mark the stale item; do not publish a subset. Batch all edits to each source file in memory against that file's original hash. Stage all changed files, commit them as one local group operation, and roll back changed files from snapshots on a write failure. Only after every file succeeds mark all group patches `published`. Withheld items are not part of the group.

**Verify.** Re-fetch each locally served URL in the browser path. At the stable `sourceId`, confirm the replacement is present and the original is gone from that block, then re-judge it in the live asset context. `consistent` (or a justified `valid_exception`) gives `verified`; anything else gives `failed_verify`. A group is `verified` only when every published patch passes. Report failed live rechecks plainly, including those published after a permitted semantic override.

**API routes.** `POST /api/facts` (confirm change, update local canonical Starter monthly price, retain explicit legacy rate, recompute derived values, bump version), `POST /api/run`, `GET /api/run/:id`, `GET /api/groups`, `PATCH /api/patches/:id` (edit, drop, or record permitted override and reason), `POST /api/groups/:id/approve` (all-or-nothing publish, then verify), `POST /api/recheck`, `GET /api/export` (optionally `?surface=`). Long jobs run in-process and report progress through the `runs` table. Record `firstReviewableGroupMs` from the Confirm change event, not merely from when judging starts.

Acceptance: within 90 seconds of **Confirm change**, a live run over the scoped 20 web pages and paired emails produces a reviewable correction group. It finds direct and derived claims, preserves the eligible email exception, provides checked fixes, and publishes plus verifies a group with no manual step besides its approval. The larger synthetic eval runs separately before the demo, not inside this 90-second clock.

## 8. Site and corpus (Agent A)

**Website**

- Required first: 20 web pages with the featured direct and derived cases. Full-corpus target if time permits: about 240 pages (landing 20, features 20, help 80, blog 60, changelog 20, comparisons 10, policies 10, customer stories 20). Increase corpus size only after the required run works.
- `/site/pricing` renders from `data/facts.json`. It is the canonical source and is never patched. Before confirmation it shows the $30 public monthly price; **Confirm change** updates the fact file to $40 for customers without legacy eligibility while retaining $30 as an explicit rule for active pre-change Starter monthly subscribers.
- **Filler** is generated per page by the frontier model: 250 to 500 words, plain paragraphs and lists, no tables, no inline formatting, no prices, no percentages, no plan-price statements.
- **Claims** are planted from `content/claims.yaml`, which holds 6 to 10 phrasings per kind from section 4. The planter inserts 0 to 3 claims per page and writes one `ManifestRow` each with `passageId` and `sourceId`. Full-corpus target: about 110 planted claims on web (30 direct, 20 derived, 20 exceptions, 15 consistent, 15 unrelated, 12 ambiguous).

**Other surfaces** (paired emails immediately after the 20-page slice; remaining assets later)

- Emails: first make the paired onboarding and eligible-upgrade messages. Full target is 24 files with subject, preheader, and body. Include Liquid tags such as `{{ first_name }}`. Set `audienceHint` from the journey: onboarding and trial ending are new customers; upgrade nudge and win-back can be existing customers. Set `legacyStarterEligible: true` only for an explicitly active pre-change Starter monthly audience. A lapsed win-back audience is `false` and pays $40.
- Ads: 30 files, each with 3 headlines and 2 descriptions inside the character limits. Plant at least two claims whose corrected text would break the limit, so a withheld patch occurs naturally.
- Decks: 2 files of about 15 slides, with titles, bullets, and speaker notes.
- Full-corpus targets: plant 12 claims in email, 12 in ads, 6 in decks. Required paired case: the identical sentence in an onboarding email and an eligible-upgrade email, with separate stable IDs and opposite labels.
- Each preview page renders the frontmatter into the `asset-meta` script tag and marks editable blocks with `data-role` and `data-source-id`.

**All surfaces**

- **Source format.** Use plain text blocks with stable source IDs in markdown: a marker such as `<!-- source-id: onboarding-01-subject -->` immediately precedes each editable block and is not part of its rendered text. Render the same ID as `data-source-id` in HTML. Subject, preheader, headings, bullets, and slide notes each get their own IDs. Preserve Liquid tags in email blocks. General rich Markdown editing is out of scope.
- **Split by template, not by instance.** Held-out phrasings must never appear in the tuning split. About 40% tuning, 60% held-out, stratified by kind. Freeze held-out templates, rows, and expected labels before tuning; featured passages are a separate split excluded from held-out metrics. Correct a genuine label error only with a logged change, then rerun and disclose the correction.
- **Leak scan.** After generation, regex the filler for `$`, `%`, and "per month". Regenerate any asset with an unplanned pricing mention.
- **Featured.** Target ten passages: six web and two email in the required demo, one ad and one slide only if those surfaces ship. Jeremy reserves a writing block for them. Mark `featured: true`, `split: "featured"`, and the actual `author`. If Jeremy's passages are not ready before tuning, agent-written substitutes are allowed but must be labeled agent-written. Passages chosen after seeing results never enter held-out metrics. The featured-wrong-claim gate applies to every featured claim on a surface actually shown; report the numerator and denominator.
- Commit the generated, frozen corpus, held-out manifest, and initial facts as the seed before rehearsal. `npm run reset` restores `content/` and facts from that seed and deletes the database. Verify restored file hashes after a publish and reset.

Acceptance: the sitemap lists every enabled asset, every manifest row's `sourceId` and `passageId` resolve to one source/rendered block with expected text, and the leak scan is clean. Duplicate passage text in different assets is expected.

## 9. Console UI (Agent C)

Build against `fixtures/*.json` first, then switch to the API.

- `/console`: current facts, the proposed change with a **Confirm change** button, run progress, and the funnel (assets indexed, passages, candidates, contradictions, exceptions preserved, escalations, groups), with a per-surface row. Show a 90-second clock for the required live run; show full synthetic eval as a separate run.
- `/console/review`: list of groups, each with its surface breakdown (for example, "19 web, 6 email, 4 ads, 2 deck" when all surfaces ship). Group detail shows outliers first, then representative passages, with a surface badge and owner label on each patch and a surface filter. Each patch shows a diff, an **editable replacement**, the check results, and a drop button. Ad patches show a character counter. An override UI accepts a reason only for `span_confined` or `rejudge_consistent`; hard failures block approval. **Approve group** preflights and publishes the entire eligible group, then verifies it. Statuses update live with a link to the locally served asset.
- `/console/escalations`: ambiguous and withheld items one at a time. Actions: in scope (draft a fix), leave as is, or write the fix by hand.
- Count every approve, drop, edit, and escalation decision as a review action. Record time from the first group opened to the last approval.

Acceptance: a reviewer can go from confirm to verified without touching a terminal. The UI never labels a failed live recheck as verified.

## 10. Eval, baseline, metrics (Agent D)

`scripts/eval.ts` runs the pipeline on the frozen synthetic corpus and joins results to the manifest by stable `passageId`/`sourceId`, never by passage text. The identical email sentence has two distinct rows and labels. It writes `data/eval/latest.json`, and `/console/eval` renders it. This is a synthetic scenario regression test, not evidence of accuracy on real customer content. Show counts, not only rates, and name the judge adapter used.

- Prefilter recall on planted claims.
- Confusion matrix over the five labels. Precision and recall for `contradicting`.
- False-edit rate: patches proposed on passages whose expected label is consistent, valid_exception, or unrelated. Every shown surface must have **zero** proposed edits to its planted grandfathered, historical, and unrelated protected claims.
- Repair validity: for contradicting rows with an `expectedValue`, the replacement contains it and passes the checks.
- Every metric split by tuning and held-out, by claim kind, and by surface. Derived kinds get their own rows. Featured passages are outside both reported splits.
- Unlabeled findings: contradictions reported in filler, listed separately.
- Fit `T_REL` and, for Jev, `T_LABEL` on tuning, freeze them, then report held-out. Do not fit a Jev confidence threshold to a frontier fallback score or combine the two adapters' evals. If the fallback has no defensible confidence, show it as unavailable.
- Demo gate: find **every** featured wrong claim on the surfaces shown, and at least **80%** of held-out contradicting web claims. Show each numerator and denominator. Present the paired email as a case study, not a two-example percentage. If the gate fails, remove the surface or soften the claim that the agent "finds" or "checks" it; never hide misses or withheld fixes.
- Freeze held-out templates and labels before tuning. Any correction to a genuine expected-label error is logged with reason and timestamp, followed by a full rerun and disclosure.

`/console/baseline`: 30 passages sampled from held-out, stratified, with page context. Jeremy marks "needs change" blind to the agent's answers and under a timer. His labels are the baseline reference; show any disagreement with the generated manifest. Compare the agent on those exact same 30 using Jeremy's labels, with minutes, misses, and false edits. Any projection to the full corpus is labeled as an extrapolation. If the timed blind baseline is not completed, omit the comparison; label featured-passage authorship independently and accurately.

Impact panel: time to a locally published and browser-verified patch set, review actions, patches approved per review action, surfaces covered per approval, and the completed baseline comparison if available. If shown, scenario volumes (sends per month, daily spend behind stale claims) sit in a separate box labeled as scenario data.

## 11. Step 0 and timeline

**Step 0, by 11:50 PT if still possible (Jeremy plus one agent).** If kickoff occurs after 11:50, make the provider decision within 30 minutes of kickoff.
1. Scaffold the app. Add `lib/types.ts`, `lib/db.ts`, `data/facts.json`, `lib/facts/derive.ts`, and one fixture file per type.
2. Get keys working. Smoke-test Jev and the frontier model from a script. Jev must correctly handle direct price, eligible grandfathering, and derived savings, return the expected response fields, and have usable latency.
3. **Jev go or no-go at the Step 0 provider deadline.** A successful connection alone is insufficient. If any of the three cases or response/latency gates fail, set `JUDGE_ADAPTER=frontier`, mark confidence unavailable or adapter-specific, and evaluate it separately.

| Time | Milestone |
|---|---|
| 11:50 to 1:30 | Agents A, B, C, D in parallel against the contracts and fixtures. Agent A builds the 20 web pages and paired emails first; other assets wait |
| 1:30 | Checkpoint 1: 20-page web slice plus paired emails, end to end through publish and verify within the 90-second reviewable-group gate |
| 1:30 to 2:30 | Run the separate synthetic eval, fix the biggest failure class, fit thresholds on tuning. Then expand web and email, ads, and decks in that order |
| 2:30 to 3:15 | Review UI: editable replacement, outliers, escalations, funnel, surface breakdown |
| 3:15 to 3:45 | Jeremy's blind timed 30-passage baseline, impact panel, held-out report from already-frozen templates and labels |
| 3:45 to 4:15 | Slack for whichever surface is unfinished, then stretch items |
| 4:15 to 5:00 | Rehearse three times using `npm run reset`. Record a backup screen capture |

A surface that is not passing its acceptance check by 3:45 is removed from the sitemap and from the pitch. Preserve the paired emails in the required demo; trim optional email volume and web corpus before cutting that pair. Jeremy protects a fixed writing block for featured passages and a separate baseline labeling block.

## 12. Cut order and stretch

**Stretch, in order:** show a reintroduced old claim being caught by `recheckChanged()`; mark pending patches stale when the fact version changes; a read-only run on one real site.

**Cut, in order, if behind:** stretch items, decks, the cross-check rule, ads, optional email volume, corpus size beyond 20 pages, the baseline page (complete and time the blind task elsewhere or omit the comparison), and escalation actions (show the list only). Never replace an incomplete baseline with an unmeasured estimate.

**Never cut:** the 20-page web slice and paired emails, direct and derived and exception cases, one approval per correction group, all-or-nothing publish and browser verify, honest eval counts, the reset script.

## 13. Demo script (about four minutes)

1. The pain in one sentence. Show the locally served MOGS site and the true asset counts per enabled surface. Say it is fictional and seeded.
2. Confirm the scoped change. Show `/site/pricing` now giving $40 to new monthly customers and the $30 active-subscriber exception. Start the 20-web-page plus paired-email run; reach a reviewable group within 90 seconds.
3. Open the direct-price correction group, including the onboarding email. Then show separate derived groups: "Save 20% with annual billing" and "about a dollar a day". Each group takes its own approval.
4. Show what was preserved: the eligible upgrade email, historical statement, and $30 add-on. Show one escalation: "Plans from $30."
5. Point at the direct-price group's web and email surface breakdown. If ads ship, show a headline whose fix fits in 30 characters and one withheld because it does not. Show decks only if their gates pass.
6. Approve the direct-price group once. Open a locally served web page and the onboarding email after both verify. Demonstrate an edit or override only if it passes the hard checks; an unresolved threshold claim stays outside approval until a reviewer supplies safe wording.
7. Show held-out synthetic eval with counts, including misses and withheld fixes. Show the blind baseline comparison only if completed. Show patches per review action.
8. If built: edit a page to bring back the old price, recheck, and show it caught.

## 14. Wording rules

Say "a fictional company we generated today", "web pages and paired emails" (adding ad copy and deck text only when those surfaces pass), "checked" only for fixes whose checks passed, and "published to the locally served asset and re-checked in the browser" only after live verification passes. Say "reruns when we trigger a change or recheck"; do not imply continuous monitoring. Do not say "every page", "guaranteed", "revenue saved", "production website", or "integrates with" any email or ad platform. Call the held-out results a frozen synthetic scenario test, show numerators and denominators, and disclose which featured passages were agent-written.

## 15. References for agents

- Jev quick start: https://docs.typesafe.ai/introduction/quickstart
- Jev HTTP API (`POST https://api.typesafe.ai/v1/systemone`): https://docs.typesafe.ai/api
- Jev through the AI SDK (`@ai-sdk/typesafe-ai`, `experimental_evaluate`, gateway id `typesafe-ai/jev`): https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai
- Jev JS SDK (`@typesafe-ai/sdk`: `choice`, `noul`, `score`, `client.systemOne({ state, questions })`): https://docs.typesafe.ai/sdk/javascript
- Jev confidence semantics: https://docs.typesafe.ai/confidence
- Known failure modes of Jev 1.13: https://docs.typesafe.ai/model-jaggedness/jev-1.13
- Google responsive search ad character limits: https://support.google.com/google-ads/answer/12159014

These references are provider documentation. Confirm the installed package versions, credentials, and live response shape in the step 0 smoke test before any agent builds on them.
