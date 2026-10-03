# MOGS: Launch Correction Agent build spec

This file defines product behavior and acceptance. [BUILD_PLAN.md](BUILD_PLAN.md) defines implementation order, ownership, and time gates; [AGENTS.md](AGENTS.md) defines the swarm workflow. These documents describe intended work, not completed implementation. Code freeze is **5:00 PM Pacific on the build day**.

## 1. Product and first-build scope

When a product fact changes, the agent finds affected marketing claims, preserves valid exceptions, drafts checked corrections, and asks a person to approve each correction group. An approval publishes that group's eligible changes to locally served Markdown assets and verifies the rendered result.

The required MOGS demo has **20 web pages, including the canonical pricing page, plus two paired emails**. Nineteen web pages and both emails have editable source blocks; canonical pricing renders directly from facts and is never patched. Show direct price, annual savings, per-day cost, plan-gap, grandfathered, historical, already-correct, unrelated, and ambiguous examples. Identical email sentences must receive different decisions when their eligibility context differs.

**Deferred beyond this build:** ads, decks, additional emails, large-corpus generation, the human baseline and comparison claims, override controls, continuous monitoring, reintroduced-claim demos, and real-platform integrations. Passing an early gate does not unlock these surfaces. Keep them out of routes, fixtures, sitemap, and the pitch.

| Area | Decision |
|---|---|
| App | Next.js App Router + TypeScript; local runtime; Node-compatible SQLite |
| Content | Short deterministic Markdown assets under `content/site/` and `content/email/`, served at `/site/...` and `/assets/email/[id]` |
| Judge | Jev if its actual adapter passes the provider gates; frontier fallback must pass the same classification cases |
| Fixes | A frontier model returns structured replacement/rationale or an explicit withholding reason |
| Retrieval | Generous lexical prefilter; no embeddings or vector store |
| State | Live SQLite at `data/app.db`; evaluation uses a separate sandbox and database |
| Approval | Human approval per complete correction group; every applicable check must pass |

## 2. Scenario and computed facts

Company: **MOGS** (Member of GTM Staff; fictional team scheduling software). Every demo entry point identifies the company and content as fictional.

| Plan | Monthly | Annual, per year | Effective monthly on annual |
|---|---|---|---|
| Starter | $30, changing to **$40** | $288 | $24 |
| Team | $80 | $768 | $64 |
| Business | $200 | $1,920 | $160 |

Starter monthly becomes $40 for customers **without legacy eligibility**. Only active Starter monthly subscribers whose subscription began before the recorded cutoff keep $30. Lapsed customers returning through win-back are ineligible. An `existing_customers` audience hint alone never establishes eligibility. Annual prices and historical statements remain unchanged.

Confirming the single seeded change writes the post-change fact snapshot, updates `/site/pricing`, increments the fact version once, records `confirmedAt` once, and starts one live run. A repeated confirmation returns the original result. A different change while this scenario is active returns a conflict until reset. The effective date and cutoff are fixed in the seed; reset must not shift them with the wall clock.

Compute these values in `lib/facts/derive.ts`; prompts and fixtures consume its output:

| Derived key | Before | After |
|---|---|---|
| `annual_savings_percent` | 20% | 40% |
| `per_day_usd` (30-day month) | $1.00 | $1.33 |
| `lowest_monthly_usd` | $30 | $40 |
| `lowest_annual_effective_monthly_usd` | $24 | $24 |
| `team_starter_gap_usd` | $50 | $40 |

Use annual savings = `100 * (1 - annual / (monthly * 12))`; round per-day currency to the nearest cent. Store base money in integer cents; expose explicit units in derived values and fix targets. These derived values describe the public offer; legacy eligibility must be considered separately. Step 0 freezes exact serialization and rounding fixtures.

## 3. Labels and required examples

Labels are `contradicting`, `consistent`, `valid_exception`, `unrelated`, and `insufficient_context`. Claim kinds are `direct_price`, `annual_savings`, `threshold`, `per_day`, `plan_gap`, `other_pricing`, and `none`.

| Example and context | Expected label | Outcome |
|---|---|---|
| “Starter is $30 a month.” on a new-customer page | contradicting | $40 |
| Same sentence in onboarding email | contradicting | $40 |
| Same sentence in email explicitly for active pre-change Starter monthly subscribers | valid_exception | Preserve |
| “Get started for under $35 a month, billed monthly.” | contradicting | Withhold: no predetermined safe wording |
| “Starter costs about a dollar a day.” for new customers | contradicting | About $1.33 a day |
| “Save 20% on Starter with annual billing.” for new customers | contradicting | 40% |
| “Team is only $50 a month more than Starter.” for new customers | contradicting | $40 |
| “When we launched in 2023, Starter cost $30 a month.” | valid_exception | Preserve |
| “Starter is $288 a year, or $24 a month billed annually.” | consistent | Preserve |
| “Starter is $40 a month for new customers.” | consistent | Preserve |
| “Starter is our most affordable plan.” | consistent | Preserve |
| “The Locations add-on is $30 a month.” / “Cancel within 30 days.” | unrelated | Preserve |
| “Plans from $30.” without plan, billing, or eligibility context | insufficient_context | Escalate without a proposed edit |

The judge receives the asset's audience and explicit eligibility, the passage, heading, neighboring blocks, and before/after facts. Use `new_customers`, `existing_customers`, `unspecified`, or `historical` for audience; eligibility is true, false, or explicitly unknown. Explicit passage scope takes precedence over an asset audience hint; metadata fills missing scope. A passage about the public offer can therefore be assessed within an email to legacy subscribers. Directly conflicting eligibility evidence or unknown eligibility when it matters yields `insufficient_context`. Historical context describes a passage's time scope, not subscription eligibility.

## 4. Source format, rendering, and crawling

Step 0 must implement and prove the following grammar in `lib/assets/` before freezing its public interfaces. Lane A then owns its implementation. The same parser and block model serve rendering, crawling fixtures, and publication; publication must not invent a second source parser.

- UTF-8 files use LF line endings, YAML frontmatter, and plain single-line text blocks. Frontmatter includes title, kind, audienceHint, and legacyStarterEligible; emails also include journey. File paths and surface establish asset identity.
- Each editable block has explicit markers, for example:

```markdown
<!-- source-id: starter-price role: body -->
Starter is $30 a month.
<!-- /source-id: starter-price -->
```

- Roles are `body`, `heading`, `list_item`, `subject`, and `preheader`. Headings and list items use role-based HTML rendering; their source text contains no Markdown prefix. The first build excludes rich Markdown, nested blocks, and inline markup.
- IDs match `[a-z][a-z0-9-]*`, are unique within a file, and remain stable across text edits. Reject missing/mismatched markers, duplicate IDs, unsupported roles, and text outside declared blocks. Preserve bytes outside an edited block.
- `assetId` is surface plus the POSIX path relative to `content/`; `passageId` is assetId plus sourceId. Step 0 freezes delimiters/encoding with exact fixture IDs. Never derive an ID from text or join by passage text.
- Each rendered asset exposes metadata and SHA-256 of exact source-file bytes in `<script type="application/json" id="asset-meta">`. Safely encode metadata for HTML. Each source block becomes exactly one element with `data-source-id` and `data-role` inside `<main>`.
- Render source text as text, preserving literal Liquid tags, URLs, and visible punctuation. The crawler selects marked elements once and reconstructs the exact source text with the shared normalization rule. Canonical pricing uses read-only fact-backed blocks and reports `editable: false` with a fact-snapshot hash.
- Step 0's executable fixture includes multiple roles, identical text in different assets, Liquid tags, URLs, and two editable blocks in one file. Prove source → rendered HTML → crawled IDs/text → replacement → rendered text, including exact preservation of untouched bytes.

`app/sitemap.ts` lists the currently built assets: the miniature has its three assets plus canonical pricing; the required Gate 2/release sitemap has exactly 22 assets. The crawler reports web and email counts separately, respects the pinned run scope, and fails the run on missing assets, extraction errors, duplicate IDs, or unresolved manifest IDs. It does not silently shrink the scope.

## 5. Shared data and API contracts

Step 0 turns the requirements below into runtime-validated DTOs, SQLite schema, and matching JSON fixtures. These are requirements for the freeze, not a claim that contracts already exist. Once the executable source fixture and provider smoke pass, commit the baseline before lane work begins. Ownership is defined only in the [build plan](BUILD_PLAN.md#lane-ownership-and-dispatch).

| Record | Required data |
|---|---|
| FactSnapshot / Change | Version, seeded changeId, before/after plan prices, effective date/cutoff, eligibility rule, typed derived keys/units; immutable snapshots |
| Page / Passage | Asset ID, path, URL, surface, editable flag, source hash, metadata; passage ID, sourceId, role, exact text/hash, heading/neighbors and context hash |
| Run | ID, changeId/factVersion, mode, immutable scope/URLs, corpus hash, adapter/connection/model, thresholds/concurrency/timeouts, confirmedAt, status/progress, errors, timestamps |
| Judgment | runId, passageId, factVersion, kind, audience, billing, label, relevance, nullable confidence/probabilities, confidence source, adapter/model, escalation reason |
| Patch | ID, runId, passageId/sourceId, surface, factVersion, kind, typed target value/unit, original/replacement, rationale or withholding reason, current expected file/block/context hashes, original captured hash, checks, revision, status, groupId, editedByHuman |
| Group | ID, runId, factVersion, correction key, member IDs, eligible/excluded counts by surface, membership hash, revision, sealedAt, status, publication ID |
| Publication / ReviewEvent | Idempotency key, request fingerprint, approved group revision/member set, actor, event/action, timestamps, affected files and before/after hashes, journal/recovery status, verification results |
| ManifestRow | passageId/sourceId, source text, surface, kind/templateId, expected label, deterministic repair target/assertions or withholding reason, split/author, corpus/facts scenario IDs |
| EvalReport | Corpus/label/fact hashes, run/model/adapter/config identifiers, fixture approvals, counts/denominators, missing/error rows, repair/protection results, timestamps |

Run states distinguish `collecting`, `classifying`, `drafting`, `ready`, and `failed`. Groups distinguish `collecting`, `sealed`, `blocked`, `publishing`, `published`, `verified`, `failed_publish`, and `failed_verify`. Patch states distinguish drafted, withheld, dropped, stale, published, verified, and failed verification. Freeze exact transition and error fixtures in Step 0.

The shared database stores runs, snapshots, judgments, patches, groups, review events, and publication recovery records. Use run-scoped queries and uniqueness constraints so an older run cannot supply a current group's patches. Permit one live run at a time; evaluation has a different database and content root. Record provider-call failures as failures, never as a semantic label.

| Route | Contract to freeze |
|---|---|
| `GET /api/facts` | Current fact snapshot and current live run ID (or null), for console restoration |
| `POST /api/facts` | `{ changeId, expectedFactVersion, idempotencyKey }`; coordinates confirmation and starts one run; returns `{ changeId, factVersion, confirmedAt, runId }` |
| `GET /api/run/:id` | Run status, full scope, counts/errors, group progress, firstSealedGroupMs and allResultsReadyMs |
| `GET /api/groups?runId=...` | Only that run's groups, revisions, patches, exclusions, and publication/verification status |
| `PATCH /api/patches/:id` | Discriminated edit or drop action with expectedRevision; rerun checks after edits and update group revision/counts |
| `POST /api/groups/:id/approve` | `{ runId, expectedRevision, idempotencyKey }`; returns the original or new publication operation and its status; polling exposes completion |
| `POST /api/groups/:id/open` | `{ runId }`; records the first human opening of that group and returns its original `openedAt`; repeated openings add no event |
| `GET /api/export?runId=...` | Read-only run evidence with real counts and statuses |

Use a common structured error shape containing code, message, and relevant record/revision. Freeze 400 validation, 404 missing, 409 stale/busy/idempotency-conflict, and provider/runtime failure cases. Same key plus same request returns the original result; same key with different payload conflicts. Repeated confirm must not change the clock, facts, or run; repeated approve must not write twice or add another review action. A second approval of an already published group returns its existing publication result. Status polling is read-only.

Gate 1 also exposes `/api/runs/:id`, `/api/runs/:id/groups`, and `/api/runs/:id/export` as aliases with identical response schemas. Checked editing/drop controls remain optional and are not implemented in the miniature console. Frontier prompt revision `gate1-v2` requires a resolved billing period for direct-price classification; unresolved direct-price scope becomes `insufficient_context` with a `scope_conflict` flag. Older fixture and Step 0 evidence retains `step0-v1` provenance.

The coordinator owns run lifecycle and serialized mutations; API handlers delegate to those modules. In-process work records progress durably. On restart, unfinished runs become interrupted failures and unfinished publications enter recovery before new mutations are accepted. Confirm's fact-file/DB transition must also be recoverable, so retry cannot silently apply the price change twice.

## 6. Judge, fixes, and checks

**Prefilter.** Pass `$`, `%`, or pricing language: price, pricing, cost, pay, fee, plan, plan names, monthly, annual, yearly, billing, billed, subscription, save, savings, discount, cheaper, afford, upgrade, dollar, “a month”, “a year”, “a day”. Include unchanged annual prices, already-updated claims, and explicit exceptions. Report filtered-out manifest rows; they remain in end-to-end metric denominators.

**Judge.** One decision call per candidate passage with bounded concurrency. State contains before/after facts and code-derived values, asset metadata, role, passage, heading and neighbors. Request relevance, kind, audience, billing, and the five-way label. Relevant means any in-scope Starter pricing/exception/comparison claim, not only a contradiction. Require typed, in-range responses. Low Jev label confidence may escalate to `insufficient_context`; winning-label probability is not confidence. Frontier confidence is null unless a separately described adapter-specific score is provided. Never apply a Jev threshold to a frontier score. A low relevance result that conflicts with an in-scope label escalates rather than silently discarding that label. Only unambiguous `contradicting` judgments on editable assets may produce automatic proposals.

**Fix.** Use a structured response containing either replacement/rationale or withhold/reason. Supply the explicit target and its unit; the model does not calculate savings. Preserve audience, billing, historical qualifiers, and meaning; add no claims. Threshold examples without a deterministic safe target stay withheld and outside approval. The first build's escalation list is informational; resolving missing context is deferred. A reviewer may edit an existing deterministic correction only if every check then passes.

**All applicable checks block publication in this build.** There are no override fields or bypass controls.

| Check | Passing condition |
|---|---|
| `span_confined` | Word diff changes at most two spans, each at most eight added/deleted tokens; tokenizer and edge cases frozen in fixtures |
| `numbers_allowed` | Introduced numeric values have allowed units/values for this claim's fix target; decimal, currency, percent, and word-number cases are normalized |
| `qualifiers_kept` | Original billing/audience/time qualifiers remain and the edit does not broaden scope |
| `rejudge_consistent` | Replacement in refreshed context is consistent or a justified valid exception; configured adapter's uncertainty rule passes |
| `source_located` | sourceId occurs exactly once and original text/block hash matches |
| `source_fresh` | File equals its expected current revision, with only the controlled update procedure in section 7 allowed to advance it |
| `fact_fresh` | Confirmed fact version matches the run, patch, and group |
| `tokens_kept` | For emails, Liquid tags and URLs remain identical, including occurrences and order |

Rerun all applicable checks after a manual edit and before publication. Invalid edits remain withheld. Checks and a second judgment are evidence about this scenario, not an independent guarantee of correctness; evaluation also checks deterministic expected block outcomes.

## 7. Complete groups, publication, and verification

**Sealing.** A correction key includes factVersion, claim kind, target value/unit, and public/legacy scope; groups are run-bound and span web/email. Price, annual savings, per-day, and plan-gap remain separate corrections. While collecting, UI may show progress but cannot offer approval. Seal a group only after every asset in the immutable run scope has been crawled and classified and every potential member of that correction has a terminal draft/check/withhold outcome. The miniature scope has three assets; the required timing scope has 22. Any unresolved extraction or provider error prevents the run from satisfying the timing gate. A group's checked membership is then immutable: later discoveries require a new run, not silent additions after approval.

Withheld items are visible alongside the correction but outside its eligible set. Dropping or editing an existing member before approval records an event, increments group revision, and reruns readiness checks. The UI refreshes the revised eligible set/count before approval. A sealed group must have at least one eligible patch. Failed checks block affected members; a publication preflight failure blocks the whole approved eligible set rather than silently dropping a patch.

**Timing.** Measure from the persisted Confirm change event. `firstSealedGroupMs` ends only when a complete group is approvable under the preceding rules; target **≤90 seconds** on 20 web pages plus two emails. `allResultsReadyMs` records when every group and escalation has its final result. Display both, with exact asset/candidate counts. Early previews and a three-call smoke test cannot satisfy the 90-second gate. Required derived groups and protected examples must all be ready before declaring the full demo path complete.

**Publication.** Under one mutation lock, verify the submitted run/group revision and idempotency key, then preflight every eligible patch. Compare a source file's expected hash once before batching edits to its blocks. Stage each changed file image, persist a recovery journal with before/after hashes and snapshots, then replace files. After all replacements succeed, commit the publication status and audit events; only then verify. On a write failure, restore original files and mark failure. On process interruption, recover the recorded operation before permitting another write; if recovery cannot establish a known state, block and report it. This is recoverable local group publication; do not claim that multiple filesystem writes and SQLite constitute one atomic filesystem transaction or that intermediate bytes can never be observed.

**Sequential groups on the same file.** After an application-owned publication, examine pending patches in touched files. Advance their expected file hash only when the recorded before/after chain matches, their sourceId/original block is unchanged, metadata is intact, and refreshed context/checks pass. If a neighboring block changed, rerun the context-dependent judgment/checks. Record the revision advance and refresh the pending group revision shown to the reviewer. External edits, missing blocks, changed metadata, or unexplained hashes cause a stale conflict; never accept them by merely replacing the saved hash. This must support price approval followed by savings/per-day approval on the same page.

Draft/check calls may finish after an earlier group publishes. Before persisting those results or sealing their group, compare the captured source/context revisions with current revisions under the same mutation lock. Reconcile only through the recorded application-owned revision chain and rerun affected context checks; unexplained changes become stale. Recheck the revision when accepting an asynchronous revalidation result. A late response must not restore an old expected hash after pending patches have already been updated.

**Verification.** Fetch the served local URL with cache bypass, locate sourceId, require exact replacement text, and judge the freshly extracted context. Browser smoke checks also open the rendered assets. Store source-observation and judgment outcomes separately. Mark a patch verified only when both pass; a group is verified only when every published member passes. Failure stays `failed_verify`, with a link and reason; it does not erase the publication audit. Treat a later edit to already verified copy as a new state requiring another check.

## 8. Frozen corpus and reset

Build short deterministic content whose value is in distinct cases, not filler volume. One editable web page plus the paired emails forms the first integration run; that page contains multiple correction kinds so sequential approvals are exercised. The canonical pricing route also exists, outside this miniature run's three-asset count. Then expand to exactly 19 editable web pages plus pricing and the same two emails.

- Freeze `content/claims.yaml`, `content/manifest.jsonl`, source files, and initial facts before tuning. Maintain separate tuning and held-out templates, about 40/60 by template within each applicable kind. Identical wording cannot cross the split. The paired identical email cases belong together in the featured split.
- Required featured cases cover direct price, annual savings, per-day, plan gap, historical/unrelated preservation, and the email pair. Log actual author; agent-written cases are labeled as such. All featured cases are excluded from held-out rates.
- Ensure both surfaces contain nonzero consistent, valid-exception, unrelated, and ambiguous protection cases, including unchanged annual and already-correct monthly copy. Cases added to the eligible email must state their scope explicitly when they refer to public pricing.
- Every claim has expected label and context; deterministic repairs include normalized value/unit and block assertions. Thresholds have an explicit expected withholding outcome. Seed names and manifest labels never enter judge prompts.
- Scan all unlabelled blocks using the full pricing prefilter vocabulary; remove unintended pricing claims or deliberately label them before freezing. Counts come from the manifest and actual crawl, not target estimates.
- Commit the seed before rehearsal and record its revision/hashes. `npm run reset` requires an idle runtime, restores only the live content/facts from this seed, and safely recreates live runtime state. It preserves evaluation artifacts and evidence exports. Never delete an open SQLite database or reset during publication/recovery. Verify exact seed hashes after publish → reset.

Acceptance: the sitemap has 20 web URLs and two email URLs; all manifest IDs resolve exactly once with expected source/rendered text; paired text is identical with distinct IDs and opposite labels; reset is repeatable.

## 9. Console

Build against the frozen API fixtures first.

- `/console`: seeded change, Confirm button, canonical pricing link, full run scope/progress, both timing metrics, funnel counts, errors, and web/email counts. Prevent duplicate clicks while preserving server-side idempotency.
- `/console/review`: collecting versus sealed groups, correction target, eligible and withheld counts, web/email breakdown, diffs, checks, and publication/verification links. Approve only the displayed sealed group revision. Refresh on conflicts and after another group's publication changes revisions.
- Optional within this scope: checked editing and dropping existing patches. These actions never bypass checks or add unresolved ambiguous items to a sealed group. Cut their controls before any required correctness gate if time runs short.
- Escalations appear in a list with reasons. `/console/eval` displays saved isolated-evaluation results and snapshot identifiers.
- Count actual human approvals, edits, and drops from audit events; retries and polling add none. Show machine timing separately from human review time, measured from first group opened to last approval. Show verified patches per review action and actual surfaces per approval.

Acceptance: confirm → complete group → approval → verified web/email links works without a terminal. Failed publication, incomplete results, and failed verification are visibly distinct.

## 10. Evaluation and release evidence

`scripts/eval.ts` creates an isolated sandbox from the frozen seed, uses an explicit **post-change fact snapshot**, a separate database, and separate served URLs. It must not read mutable live rehearsal content. Reports under `data/eval/<runId>/` and `data/eval/latest.json` survive live reset and record corpus, label, and fact hashes plus adapter/model/connection, thresholds, prompt/config version, and timestamps.

Join every result by passageId/sourceId. Filter misses, missing judgments, and provider errors remain visible in the full manifest denominator. Freeze expected labels and templates before tuning; tune only on the tuning split. Genuine label corrections need a recorded reason, new label hash, and rerun. Changing adapters/models/config requires a separately identified report. Call this a frozen synthetic scenario regression test.

| Metric | Definition |
|---|---|
| Prefilter recall | Passed in-scope planted claims / all in-scope planted claims |
| Detection recall | Correctly identified contradictions / all expected contradictions, including filtered/missing/error rows |
| Detection precision | Correct planted contradictions / planted rows labeled contradicting; list unlabelled findings separately |
| Classification | Five-label matrix plus explicit filtered/missing/error counts; split by template split, kind, and surface |
| Protected proposals | Any proposed edit, including subsequently withheld/dropped drafts, on expected consistent, valid_exception, or unrelated cases |
| Ambiguity safety | Automatic proposals on expected insufficient_context cases; required count zero |
| Checked repair yield | Deterministic eligible contradictions with a correct checked fix / all deterministic eligible contradictions |
| Verified repair yield | Correct published-and-verified repairs / all deterministic eligible contradictions; missed/failed/withheld eligible cases remain in denominator |
| Withholding | Counts and reasons, including thresholds lacking a safe target, displayed separately |

Repair correctness uses expected numeric value and unit plus exact approved fixture/block assertions and preservation checks, not substring presence alone. The sandbox may use recorded scripted approvals to exercise publication; label these as test approvals, exclude them from human review counts, and never let this harness approve live content.

Required release gates:

1. Detect every featured wrong claim and at least 80% of held-out contradicting web claims; show numerator/denominator and all misses. Featured cases never inflate held-out metrics.
2. Zero proposed edits to consistent, valid_exception, and unrelated protection cases, and zero automatic proposals on unresolved ambiguous cases. Report tested counts by class/surface so an empty category cannot pass.
3. Successfully publish and verify named direct-price, annual-savings, per-day, and plan-gap repairs, including a direct group spanning web/onboarding email and sequential groups on the same file. Preserve the eligible email and every protected block exactly.
4. Block the entire eligible group for stale/missing/duplicate source IDs, changed facts, external or unexplained context changes, failed contextual revalidation, broken Liquid tokens/URLs, or any failed check. Controlled application-owned changes follow section 7. Exercise duplicate confirm/approve, write failure/recovery, and reset restoration.
5. Pass the actual 22-asset timing gate and three full reset-to-verified rehearsals. Report all-results timing and provider errors honestly.

No human baseline is included. A future human accuracy comparison requires independently adjudicated answers and equivalent tasks. This build reports measured completion time, review actions, and verified corrections. A missed required gate means the target was not met; describe the narrower proven behavior without hiding the miss.

## 11. Provider gates and configuration

**Stage 1, during Step 0:** freeze the exact connection and production serialization/question schema; then test direct price, identical eligible-grandfathered copy, and derived annual savings for every candidate judge. Validate typed response fields, labels, uncertainty semantics, returned model identity, and latency. Run one frontier structured fix through local checks. A passing fix call does not qualify that model as the fallback judge. Record status and redacted results; absent credentials mean the provider gate is untested, not passed.

Direct TypeSafe, the dedicated AI SDK provider, and Gateway are different integration choices with different environment variables and response mappings. Select one Jev connection at kickoff based on configured access, document it in `.env.example`, and validate that exact path. Likewise record the exact frontier provider/model. Do not implement three Jev transports. Keep actual credentials out of Git.

**Stage 2, after the miniature path works:** measure a representative concurrent candidate workload with real judge, frontier fix, and rejudge work, including timeouts/retries. Configure bounded concurrency and a total deadline; record candidate counts, per-stage latency, errors, and elapsed time. The actual 22-asset run establishes the timing gate in section 7. If Jev fails either stage, select frontier only after its equivalent gates pass; rerun evaluation with that adapter. If neither passes, report the blocker rather than substituting fixture output as a live run.

Freeze model versions where available; always log returned model IDs. Example configuration fields are `JUDGE_ADAPTER`, the selected connection's credential variable, `JUDGE_MODEL`, `FIX_MODEL`, `T_REL`, `T_LABEL`, concurrency, and request timeout. Thresholds are per adapter; starting values are tuning inputs, not accuracy claims. The build plan sets the Stage 1 decision deadline and dispatch gates.

## 12. Demo and wording

1. Show the fictional MOGS site and exact 20-web/two-email scope.
2. Confirm Starter's public monthly change; show $40 canonical pricing and the explicit $30 legacy rule.
3. Show complete groups, both timing metrics, and direct versus derived corrections.
4. Show preserved eligible email, historical and unrelated copy, plus an ambiguous escalation.
5. Approve the web/email direct-price group once; open both verified assets. Approve a derived group on a page already changed by the first group to demonstrate sequential publication.
6. Show the frozen synthetic evaluation, protected-case counts, verified repair outcomes, misses/withholding, and review actions.

Say “fictional company,” “locally served assets,” “one approval per correction group,” and “published locally and checked in the rendered page” only when supported by the recorded result. Rejudgment is a model check. Browser observation supports the local publication claim. Neither establishes production integration, real-customer accuracy, continuous monitoring, or revenue impact. The original roughly four-minute demo length is a rehearsal target; report measured run times.

## 13. Provider references

- TypeSafe API: https://docs.typesafe.ai/api
- TypeSafe JavaScript SDK: https://docs.typesafe.ai/sdk/javascript
- AI SDK TypeSafe provider/Gateway integration: https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai
- TypeSafe confidence semantics: https://docs.typesafe.ai/confidence
- Model identifiers: https://docs.typesafe.ai/models
- Documented Jev 1.13 limitations: https://docs.typesafe.ai/model-jaggedness/jev-1.13

Read the documentation for the chosen integration and installed versions during Step 0. These references do not replace actual provider smoke or workload evidence.
