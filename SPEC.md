# MOGS: deployed launch correction demo — v2 spec

This file defines the approved direction: a deployed fictional MOGS site, checked corrections submitted as a real GitHub pull request, and verification after deployment. [BUILD_PLAN.md](BUILD_PLAN.md) defines implementation order and ownership; [AGENTS.md](AGENTS.md) defines the swarm workflow. This v2 revision describes the complete acceptance target. [Remote 0](docs/REMOTE_0.md) records the committed local foundation and public seed deployment. Under the build plan's split, Remote 0A unlocks fixture-backed builders; Remote 0B live enforcement remains mandatory before real correction/restoration submission and publication. The local v1 foundation and miniature evidence remain recorded in [docs/STEP_0.md](docs/STEP_0.md) and [docs/GATE_1.md](docs/GATE_1.md). Existing unversioned runtime contracts remain v1 until callers explicitly migrate to the versioned v2 services; passing the local fixture gate does not imply HTTP/console integration. The original build-day freeze was 5:00 PM Pacific; no revised delivery deadline has been set.

## 1. Product and first-build scope

Show the live site and email templates with old information. A reviewer confirms the desired product change; the agent crawls the deployed assets, finds affected claims, preserves valid exceptions, and drafts checked corrections. A person approves each complete correction group for inclusion in one launch pull request. The tool submits the combined change, verifies its deployed preview, and checks the public result after a human merges it. Confirmation, group approval, and PR submission leave the public site unchanged.

The required deployed demo has **20 web pages, including canonical pricing, plus two paired email templates**. Nineteen web pages and both emails have editable source blocks. Canonical pricing renders from the fact file in its deployed commit; it receives no model-generated patch. The PR includes a deterministic update of that fact file. Show direct price, annual savings, per-day cost, plan-gap, grandfathered, historical, already-correct, unrelated, and ambiguous examples. Identical email sentences must receive different decisions when their eligibility context differs. Email assets are browser-rendered, repository-backed templates; publication updates templates, never sends messages.

The intended repository is `jcstotomas/mogs-demo`, under the owner selected by the user. Repository creation, access, default branch, hosting provider, and public/preview origins must be established and recorded before the remote contract gate passes. Repository visibility is a separate setup choice; a public demo site does not require public source.

**Subsequent scale milestone:** a separately frozen 200-asset workload, comprising 180 web pages including pricing and 20 email templates. It follows the complete 22-asset remote flow and has separate counts, timing, and evaluation. It is not a prerequisite for the first deployed demo or evidence that the required workload passed. Vary content and template families before increasing volume; duplicates measure throughput, not independent accuracy.

**Deferred:** arbitrary customer websites/CMSs, ad platforms, decks, email sending, feature-entitlement scenarios, automatic merge, override controls, and continuous monitoring. A general-purpose-agent comparison is optional follow-up evidence; no superiority claim precedes a fair measured comparison. The deployed integration is one controlled source repository and hosting pipeline.

| Area | Decision |
|---|---|
| App | Existing Next.js review console and durable Node/SQLite worker run locally for the first remote demo; only content is publicly deployed |
| Content | Repository-backed Markdown under `content/site/` and `content/email/`; public `/site/...` and `/assets/email/[id]` routes expose the deployed revision |
| Judge | Jev if its actual adapter passes the provider gates; frontier fallback must pass the same classification cases |
| Fixes | A frontier model returns structured replacement/rationale or an explicit withholding reason |
| Retrieval | Generous lexical prefilter; no embeddings or vector store |
| State | Durable worker SQLite and submission journal; isolated evaluation has separate source, database, URLs, and remote test targets |
| Approval | Human approval per complete correction group authorizes inclusion; one submitted candidate and one PR per run; GitHub merge is the separate publication decision |
| Delivery | Pin repository/base commit and deployed source; check the combined candidate tree, PR preview, then production independently |

**Public build target.** The coordinator bootstraps a separate content-only Next.js target at `apps/public/` during Remote 0, using the shared source parser and renderer. Its public routes are mapped `/site/...`, `/assets/email/...`, and `/sitemap.xml`; `/` may redirect to canonical pricing. `/console/**` and `/api/**` return 404, and the deployed artifact excludes the coordinator, credentials, SQLite, journals, and labels. Prove local artifact/route isolation with the miniature for Remote 0A; verify actual hosting isolation in Remote 0B. Lane A owns corpus/evaluation preparation and the target's asset/render/crawl work after bootstrap handoff. Expand the active inventory only after Remote 1's miniature passes; deployment configuration remains coordinator-owned.

## 2. Scenario and computed facts

Company: **MOGS** (Member of GTM Staff; fictional team scheduling software). Every demo entry point identifies the company and content as fictional.

| Plan | Monthly | Annual, per year | Effective monthly on annual |
|---|---|---|---|
| Starter | $30, changing to **$40** | $288 | $24 |
| Team | $80 | $768 | $64 |
| Business | $200 | $1,920 | $160 |

Starter monthly becomes $40 for customers **without legacy eligibility**. Only active Starter monthly subscribers whose subscription began before the recorded cutoff keep $30. Lapsed customers returning through win-back are ineligible. An `existing_customers` audience hint alone never establishes eligibility. Annual prices and historical statements remain unchanged.

Confirming the seeded change stores an immutable desired fact snapshot, increments its version once, records `confirmedAt` once, and starts one run against the pinned deployed source. It does not change the published fact file or `/site/pricing`. Before, desired, and observed deployed fact versions are distinct. The PR includes the canonical fact-file update alongside approved content changes; its preview renders $40 while production still renders $30. A repeated confirmation returns the original result. One active launch is allowed at a time. A different launch requires the current one to be completed or explicitly abandoned and a new deployed baseline captured. The seeded dates stay fixed across rehearsals.

**Published artifact and bootstrap.** The published fact-file path is `data/facts.json` in the controlled source repository. In an isolated source checkout, assemble the pristine miniature from committed `content/seed.json` source images and `data/seed/facts.json` at the same recorded seed revision. Verify every source/fact hash before the first $30 deployment; copying the already-repaired local content with old facts is not a valid baseline. The confirmed local v1 working tree remains historical demo state. Public rendering reads only the fact artifact in its deployed commit. Confirm stores before/desired snapshots in local SQLite; only candidate construction writes desired facts into the isolated candidate's `data/facts.json`. Record the seed and bootstrap commits and actual deployed source/fact hashes before analysis.

Compute these values in `lib/facts/derive.ts`; prompts and fixtures consume its output:

| Derived key | Before | After |
|---|---|---|
| `annual_savings_percent` | 20% | 40% |
| `per_day_usd` (30-day month) | $1.00 | $1.33 |
| `lowest_monthly_usd` | $30 | $40 |
| `lowest_annual_effective_monthly_usd` | $24 | $24 |
| `team_starter_gap_usd` | $50 | $40 |

Use annual savings = `100 * (1 - annual / (monthly * 12))`; round per-day currency to the nearest cent. Store base money in integer cents; expose explicit units in derived values and fix targets. These derived values describe the public offer; legacy eligibility must be considered separately. Preserve the Step 0 serialization and rounding fixtures when separating desired and deployed facts.

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

Preserve the executable Step 0 grammar in `lib/assets/`, owned by the corpus/evaluation builder A after the Remote 0A contract handoff. The same parser and block model serve rendering, crawling, candidate construction and verification. Source mapping must not invent a second parser.

- UTF-8 files use LF line endings, YAML frontmatter, and plain single-line text blocks. Frontmatter includes title, kind, audienceHint, and legacyStarterEligible; emails also include journey. File paths and surface establish asset identity.
- Each editable block has explicit markers, for example:

```markdown
<!-- source-id: starter-price role: body -->
Starter is $30 a month.
<!-- /source-id: starter-price -->
```

- Roles are `body`, `heading`, `list_item`, `subject`, and `preheader`. Headings and list items use role-based HTML rendering; their source text contains no Markdown prefix. The first build excludes rich Markdown, nested blocks, and inline markup.
- IDs match `[a-z][a-z0-9-]*`, are unique within a file, and remain stable across text edits. Reject missing/mismatched markers, duplicate IDs, unsupported roles, and text outside declared blocks. Preserve bytes outside an edited block.
- `assetId` is surface plus the POSIX path relative to `content/`; `passageId` is assetId plus sourceId. Keep Step 0's frozen delimiters/encoding and exact fixture IDs. Never derive an ID from text or join by passage text.
- Each rendered asset exposes metadata and SHA-256 of exact source-file bytes in `<script type="application/json" id="asset-meta">`. Safely encode metadata for HTML. Each source block becomes exactly one element with `data-source-id` and `data-role` inside `<main>`.
- Render source text as text, preserving literal Liquid tags, URLs, and visible punctuation. The crawler selects marked elements once and reconstructs the exact source text with the shared normalization rule. Canonical pricing uses read-only fact-backed blocks and reports `editable: false` with a fact-snapshot hash.
- Step 0's executable fixture includes multiple roles, identical text in different assets, Liquid tags, URLs, and two editable blocks in one file. Prove source → rendered HTML → crawled IDs/text → replacement → rendered text, including exact preservation of untouched bytes.

`app/sitemap.ts` lists the currently built assets: the miniature has three editable assets plus canonical pricing; the required remote workload has exactly 22 assets including pricing. A versioned inventory binds each URL to repository, path, sourceId, source hash, and deployed commit. The crawler accepts configured public HTTPS origins and the explicit local test origin; redirects and scope changes require validation. It reports web/email counts separately and fails the run on missing assets, source/deployment mismatch, extraction errors, duplicate IDs, or unresolved manifest IDs. Canonical pricing participates in scope validation as fact-backed content and is excluded from model patching. General HTML ingestion is outside this grammar.

## 5. Shared data and API contracts

The v1 Step 0 established the records below. The coordinator freezes committed local types, database migration, API fixtures and tests in Remote 0A before fixture-backed builders resume. Builders wire versioned callers against that baseline while the coordinator completes Remote 0B's live enforcement. Shared changes require synchronized types/fixtures/callers. Section 7 defines the unchanged submission/deployment requirements. A documentation update alone does not freeze executable v2 contracts. Ownership is defined in the [build plan](BUILD_PLAN.md).

| Record | Required data |
|---|---|
| LaunchAttempt | ID/contract version, configured target, captured baseline/deployment identity, run ID, active/terminal state, recovery operation and closure reason/timestamp |
| FactSnapshot / Change | Attempt-scoped phase/version identity, immutable before/desired snapshots, observed deployed fact version, seeded changeId, prices, dates, eligibility and typed derived values |
| Page / Passage | Asset ID, path, URL, surface, editable flag, source hash, metadata; passage ID, sourceId, role, exact text/hash, heading/neighbors and context hash |
| Run | ID, launchAttemptId, changeId/desiredFactVersion, mode, immutable scope/URLs, corpus hash, source repository/base ref/base SHA/deployed SHA, inventory hash, adapter/config, confirmedAt, progress, errors and timings |
| Judgment | runId, passageId, factVersion, kind, audience, billing, label, relevance, nullable confidence/probabilities, confidence source, adapter/model, escalation reason |
| Patch | ID, runId, passageId/sourceId, surface, factVersion, kind, typed target value/unit, original/replacement, rationale or withholding reason, current expected file/block/context hashes, original captured hash, checks, revision, status, groupId, editedByHuman |
| Group | ID, runId, factVersion, correction key, member IDs, eligible/excluded counts by surface, membership hash, revision, sealedAt, status, publication ID |
| Publication / ReviewEvent | Idempotency key, request fingerprint, approved group revision/member set, actor, event/action, timestamps, affected files and before/after hashes, journal/recovery status, verification results |
| Submission | Run and bundle IDs, all approved group revisions/member hashes, desired facts hash, base SHA, final tree/file hashes, candidate commit, branch, PR number/URL, request fingerprint, journal state and failure |
| DeploymentObservation | Submission ID, preview/production environment, provider/deployment ID and URL, candidate/merge/deployed commit identities, readiness, observed source/fact hashes, block observations, rejudgments and failures |
| ManifestRow | passageId/sourceId, source text, surface, kind/templateId, expected label, deterministic repair target/assertions or withholding reason, split/author, corpus/facts scenario IDs |
| EvalReport | Corpus/label/fact hashes, run/model/adapter/config identifiers, fixture approvals, counts/denominators, missing/error rows, repair/protection results, timestamps |

Run analysis states remain `collecting`, `classifying`, `drafting`, `ready`, and `failed`. V2 distinguishes group approval for submission from publication. Submission distinguishes preparing, submitted, blocked, failed, and closed; preview, merge, production deployment, and verification have separate records. `preview_verified` never implies production `verified`. Freeze exact enums, transition/error fixtures, and migrations in Remote 0A; preserve historical v1 records and their local meaning.

The shared database stores analysis, group approvals, submissions, deployment observations, and recovery records. Use run-scoped queries and uniqueness constraints so an older run cannot supply a current group's patches. Permit one active launch at a time; evaluation has a separate database and source root. Record provider-call failures as failures, never as a semantic label.

**V1 migration and launch identity.** Preserve historical v1 payloads, approval/publication records and idempotency responses unchanged. Replace the v1 global live-run/live-change uniqueness rules with one active v2 launch attempt for the configured target. Give each attempt a durable `launchAttemptId` and captured baseline-deployment identity; scope fact identity by attempt plus phase/version so repeated $30→$40 rehearsals do not collide on versions 1/2 or the seeded change ID. V1 completed records occupy no v2 active slot. Fresh rehearsals use new attempt IDs and request keys; an old key still returns its historical operation or conflicts, never starts a new attempt. Verification completes an attempt; abandonment and post-merge failure reconciliation follow section 7. Freeze migration, concurrent-confirm and repeated-rehearsal fixtures in Remote 0A.

| Route | Contract to freeze |
|---|---|
| `GET /api/facts` | Desired and observed deployed snapshots plus current run ID, without changing either |
| `POST /api/facts` | Versioned v2 request pins launch attempt, captured baseline and expected fact version with an idempotency key; confirms desired facts and returns the original attempt/run/version/timestamp on retry |
| `GET /api/run/:id` | Run status, full scope, counts/errors, group progress, firstSealedGroupMs and allResultsReadyMs |
| `GET /api/groups?runId=...` | Only that run's groups, revisions, patches, exclusions, and publication/verification status |
| `PATCH /api/patches/:id` | Discriminated edit or drop action with expectedRevision; rerun checks after edits and update group revision/counts |
| `POST /api/groups/:id/approve` | Versioned v2 request with run/group revision and idempotency key; records approval for the exact checked members, with no content write |
| `POST /api/runs/:id/submit` | V2 contract must pin base SHA, all approved group revisions and bundle hash, with an idempotency key; returns the original or new submission/PR operation |
| `POST /api/runs/:id/abandon` | Expected attempt/submission revision and idempotency key; retires merge readiness, closes an unmerged PR if present, preserves audit and releases the active slot only after reconciliation |
| `POST /api/runs/:id/reconcile` | Expected attempt revision and idempotency key; observes a merged failure's actual deployment/facts, preserves failure and closes the attempt as reconciled failure without changing public content |
| `POST /api/v2/restorations` | Fresh restoration attempt/key, pinned baseline and frozen seed revision; shares target reservation with correction attempts and records a separate restoration action |
| `POST /api/groups/:id/open` | `{ runId }`; records the first human opening of that group and returns its original `openedAt`; repeated openings add no event |
| `GET /api/export?runId=...` | Read-only run evidence with real counts and statuses |

Use the common structured validation/missing/stale/busy/idempotency/provider error shapes. Same key and same request returns the original operation; a different payload conflicts. Repeated confirm preserves its timestamp, desired facts and run; repeated approval adds no event; repeated submission must not create another branch, commit or PR. Approval of an already submitted group returns its recorded result. Polling reads provider state and records observations without merging or writing content. V1 local approval semantics must remain explicitly versioned so a v2 console cannot accidentally call the local publisher.

Abandon/reconcile retries recover their original operation and add no duplicate reviewer action. Unknown remote state keeps the active slot locked. `GET /api/run/:id` and export include attempt, submission and recovery status so the console can restore an interrupted operation.

The recorded v1 Gate 1 exposes `/api/runs/:id`, `/api/runs/:id/groups`, and `/api/runs/:id/export` aliases. Preserve explicit contract-version boundaries when extending these handlers. Checked editing/drop controls remain optional. Frontier prompt revision `gate1-v2` requires a resolved billing period for direct-price classification; unresolved scope becomes `insufficient_context` with a `scope_conflict` flag. This prompt name is independent of the deployed v2 contract version. Older evidence retains its original provenance.

The coordinator owns run lifecycle, serialized mutations, Git submission and deployment observation; API handlers delegate. Work records progress durably. Restart reconciles unfinished submissions with remote branch/commit/PR identities before another mutation. Confirmation is now a desired-state database operation, not a write to the public fact file. The first remote demo runs its worker and review console locally with durable SQLite and a dedicated Git checkout. Deploy only content publicly. Hosting the worker later requires a compatible persistent single-writer runtime and authenticated review; the existing locks and local files do not support independent ephemeral serverless workers.

**Executable version boundary.** V2 DTOs live in `lib/runs/remote-types.ts` and use the explicit `/api/v2` namespace for the routes in the table above. Existing unversioned routes remain v1 until callers migrate; a v2 body must be rejected by their strict v1 validation. V2 state uses `data/remote/app.db`, with an online SQLite backup imported as immutable v1 history and idempotency tombstones. The original v1 database remains usable by the completed local demo. V2 active-attempt constraints apply to correction and restoration operations together. This separation is required because the v1 runtime rejects later database schema versions and reinstalls its global indexes on open.

Each candidate commit includes its unique `Launch-Attempt` identity in its commit message. Reject reuse of a candidate SHA by another attempt: commit statuses are SHA-bound, so an abandoned PR must never become eligible because a later attempt produced the same content. Approvals bind a hash of checked patch revisions, replacements and check results in addition to group revision/membership.

Inventory paths are repository-relative (`content/site/launch.md`); parser `Page.file` remains content-relative (`site/launch.md`). Store both the normalized `factsHash` (`hashRecord(snapshot)`) and exact deployed JSON `factsFileHash` (SHA-256 of bytes). Candidate before-file hashes use the latter. Full mapped-tree verification includes unchanged protected assets, including for an authorized merge/squash SHA difference. Capture lexical prefilter exclusions by passage ID; their union with judgments must resolve the entire scope before sealing, without hiding filtered claims from evaluation denominators.

## 6. Judge, fixes, and checks

**Prefilter.** Pass `$`, `%`, or pricing language: price, pricing, cost, pay, fee, plan, plan names, monthly, annual, yearly, billing, billed, subscription, save, savings, discount, cheaper, afford, upgrade, dollar, “a month”, “a year”, “a day”. Include unchanged annual prices, already-updated claims, and explicit exceptions. Report filtered-out manifest rows; they remain in end-to-end metric denominators.

**Judge.** One decision call per candidate passage with bounded concurrency. State contains before/after facts and code-derived values, asset metadata, role, passage, heading and neighbors. Request relevance, kind, audience, billing, and the five-way label. Relevant means any in-scope Starter pricing/exception/comparison claim, not only a contradiction. Require typed, in-range responses. Low Jev label confidence may escalate to `insufficient_context`; winning-label probability is not confidence. Frontier confidence is null unless a separately described adapter-specific score is provided. Never apply a Jev threshold to a frontier score. A low relevance result that conflicts with an in-scope label escalates rather than silently discarding that label. Only unambiguous `contradicting` judgments on editable assets may produce automatic proposals.

**Fix.** Use a structured response containing either replacement/rationale or withhold/reason. Supply the explicit target and its unit; the model does not calculate savings. Preserve audience, billing, historical qualifiers, and meaning; add no claims. Threshold examples without a deterministic safe target stay withheld and outside approval. The first build's escalation list is informational; resolving missing context is deferred. A reviewer may edit an existing deterministic correction only if every check then passes.

**All applicable checks block submission and readiness for merge.** Required GitHub checks must enforce candidate and preview success for the current PR head on the configured target branch. Verify that repository settings enforce this before claiming merge blocking. Out-of-process or bypassed merges remain explicitly unapproved and cannot inherit the candidate's verification. The tool exposes no override or bypass controls.

**GitHub enforcement.** Use two required commit-status contexts: `mogs/candidate` for the complete approved candidate checks, and `mogs/preview` for the matching deployed preview checks. The local coordinator posts them through the GitHub commit-status API for the exact candidate/current PR-head SHA and records the authenticated producer identity, evidence hash and status URL. Remote 0B verifies credential permissions, trusted producer/source binding and actual target-branch rules: both contexts required, strict up-to-date checks, restrictions applied to administrators, and no bypass or automatic merge. Keep merge queue disabled for this immutable-candidate demo. A pending, failed, stale or abandoned operation never receives success; a changed head cannot reuse an older SHA's statuses. Prove pending/failure/mismatched-head rejection and passing-current-head eligibility. Unavailable required enforcement blocks Remote 0B and all real correction/restoration submission and publication; it does not block fixture-backed development after Remote 0A. Coordinator-controlled disposable enforcement probes supply gate evidence only. See [GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) and [commit statuses](https://docs.github.com/en/rest/commits/statuses).

| Check | Passing condition |
|---|---|
| `span_confined` | Word diff changes at most two spans, each at most eight added/deleted tokens; tokenizer and edge cases frozen in fixtures |
| `numbers_allowed` | Introduced numeric values have allowed units/values for this claim's fix target; decimal, currency, percent, and word-number cases are normalized |
| `qualifiers_kept` | Original billing/audience/time qualifiers remain and the edit does not broaden scope |
| `rejudge_consistent` | Replacement in refreshed context is consistent or a justified valid exception; configured adapter's uncertainty rule passes |
| `source_located` | sourceId occurs exactly once in the pinned base and original text/block hash matches; the candidate contains that same stable ID exactly once |
| `source_fresh` | Source matches the pinned base/deployment; final staged bytes match the approved bundle and recorded base-to-candidate chain |
| `fact_fresh` | Immutable desired facts match run, patches, groups and candidate fact artifact; observed deployed facts match the recorded baseline or verified merged deployment |
| `tokens_kept` | For emails, Liquid tags and URLs remain identical, including occurrences and order |

Rerun all applicable checks after a manual edit and for the combined candidate before submission, using paired base and candidate inputs. Source location/original-text checks inspect the pinned base; freshness checks inspect the current allowed base/deployment and the recorded base-to-candidate diff. Span, value, qualifier and token checks compare original to final replacement; rejudgment and canonical-fact checks inspect final candidate context. During preview/public verification use committed replacement text, stable IDs and deployment revision, not the pre-edit original-text requirement. Invalid edits remain withheld. Checks and a second judgment are evidence about this scenario, not an independent guarantee of correctness; evaluation also checks deterministic expected block outcomes.

## 7. Complete groups, PR submission, and deployed verification

**Sealing.** A correction key includes factVersion, claim kind, target value/unit, and public/legacy scope; groups are run-bound and span web/email. Price, annual savings, per-day, and plan-gap remain separate corrections. While collecting, UI may show progress but cannot offer approval. Seal a group only after every asset in the immutable run scope has been crawled and classified and every potential member of that correction has a terminal draft/check/withhold outcome. The miniature scope has three assets; the required timing scope has 22. Any unresolved extraction or provider error prevents the run from satisfying the timing gate. A group's checked membership is then immutable: later discoveries require a new run, not silent additions after approval.

Withheld items are visible alongside the correction but outside its eligible set. Dropping or editing an existing member before approval records an event, increments group revision, and reruns readiness checks. The UI refreshes the revised eligible set/count before approval. A sealed group must have at least one eligible patch. Failed checks block affected members; a submission preflight failure blocks the whole approved bundle rather than silently dropping a patch.

**Timing.** Measure from the original persisted Confirm event. For the exact 20-web/two-email workload, require **`firstSealedGroupMs` ≤90,000** and **`allResultsReadyMs` ≤180,000**. The first ends only when a complete group is approvable; the second ends when every required group and escalation has its final result. Both gates require complete scope and no unresolved extraction/provider errors. A first-group pass alone cannot pass the workload; timeout or missing results remain failed/missed outcomes, and late responses cannot reopen an expired run. These are acceptance targets, not measured remote capability. Separately record submission processing, PR creation, preview build/verification, human review/merge wait, production deployment and live verification. Record both processing intervals and wall-clock timestamps. Early previews, the miniature, and historical local timing cannot satisfy a remote or 200-asset gate. Freeze a separate budget before the scale workload; do not extrapolate a passing time.

**Source binding.** Resolve the configured repository and base branch to an immutable commit. At Confirm, require exact equality between the base-branch head and observed production deployment commit; a branch ahead of production waits for a matching verified deployment. Match each crawled asset's exact source/fact hash to that commit. The source map binds origin/URL, repository path, sourceId, and metadata. Recheck base head and production identity before submission and merge readiness. A mismatch blocks the operation; capture a new baseline in a new attempt instead of silently preferring a working checkout or current branch. Only mapped content and `data/facts.json` may change in a launch PR. Runtime credentials, databases, journals, evaluation labels and diagnostic source are excluded from published content.

**Approval and bundle.** Approving a complete group authorizes its exact checked revision/member set for submission and records one human action. Wait for all results and approval of every group with eligible changes before creating the launch bundle. Include withheld and unresolved results in the review summary without silently adding edits for them. Bundle all approved groups plus the deterministic before→desired fact-file update into one candidate tree based on the pinned commit. Compare each source file once, combine its block edits, then rerun all applicable paired base/candidate checks and final-context judgments as defined in section 6. Validate canonical pricing from the desired facts. A failed preflight or combined check blocks the whole submission. Before submission, checked edits/drops within captured membership invalidate affected approvals and require refreshed checks and renewed review. Changed source, scope or desired facts require abandonment and a new attempt with a fresh baseline.

**One PR per run.** Persist a submission operation before network writes. Use a run-specific `codex/launch-...` branch and record its exact base, tree and head commit, bundle hash, desired facts, and all approvals. Submission creates a real pull request targeting the configured branch, with grouped diffs, checks, exclusions, factual rationale and a preview link when available. A PR records proposed source changes; it does not update the public site. A repeated request recovers the original branch/commit/PR. Record remote lookup by operation identity/head branch so a lost push or PR response can be reconciled. Never force-push over unrecognized remote work. The first build allows one immutable submitted candidate per run: changed base/source/PR head makes it stale and blocks readiness. Replacing it requires explicit abandonment and a new run/PR with fresh source, checks and human approvals. Preserve the old PR and operation in the audit; the tool does not append or rebase submitted candidates.

**Abandonment and terminal failures.** Before submission, a reviewer may abandon an attempt without a remote content write. After submission, journal abandonment, post terminal `failure` for both required status contexts on the submitted head and any changed current head, close the unmerged PR, and verify status/branch/PR identity before marking the attempt abandoned and releasing its active slot. Preserve the branch, PR record, approvals and failure evidence; retries resume the same operation. A reopened abandoned PR remains blocked by those statuses and produces an explicit stale observation; the old attempt can never issue success again. If a merge raced abandonment, observe it as a merge and reconcile its actual deployment; closing an attempt never rolls back the site. A merged deployment/verification failure remains explicit and blocks a new attempt until verification succeeds or the reviewer uses Reconcile deployed state to capture actual public facts/revision and close it as a reconciled failure. A subsequent seeded $30→$40 rehearsal requires an explicitly restored and verified $30 baseline. Freeze interrupted abandonment, close-response loss, reopened-PR and merge-race fixtures in Remote 0A; real remote outcomes remain separately required evidence.

**Preview.** The hosting pipeline builds the candidate commit and exposes an isolated HTTPS preview containing the final combined source and desired facts. Record build state, deployment identity and source revision. Fetch the preview's rendered assets, require exact replacements and preserved blocks, and rejudge fresh context. Verify email Liquid tags and URLs and canonical pricing. `preview_verified` is separate from production verification. A local render or GitHub PR link alone cannot pass this gate.

**Merge and production.** A person reviews and merges through GitHub. The agent's submission action does not merge or enable automatic merge. Before accepting a merge as the approved change, compare its resulting content/fact hashes to the approved candidate; account for merge/squash SHA differences through recorded tree/path identity. A changed candidate or conflicting base invalidates prior readiness. Observe the hosting provider's production deployment for the actual merged commit, then fetch the configured public URLs with cache bypass. Require matching deployment revision, exact replacement text at each sourceId, unchanged protected blocks, correct canonical facts, and passing fresh contextual judgment. Store deployment readiness, source observations and judgments separately. Mark production `verified` only when all required observations pass. A stale deployment, failed build or failed live check remains explicit and cannot be erased by a successful preview.

**Recovery and concurrent changes.** Serialize candidate construction/submission with a durable journal. On restart, reconcile remote state rather than blindly retrying writes or merging. Unknown state blocks further mutations. In-flight model results must still match the pinned source/context/desired facts before acceptance; source changes invalidate affected work. A failed provider/deployment operation is a failed operation, not a semantic label. Keep the v1 local publication/recovery and same-file sequential tests as regression evidence; they do not prove Git submission recovery. V2 exercises multiple groups on one file within a single checked commit and separately tests remote retry, stale base and lost-response recovery.

GitHub integration references: [pull requests](https://docs.github.com/en/rest/pulls/pulls) and [deployment statuses](https://docs.github.com/en/rest/deployments/statuses). The coordinator must also verify the selected hosting provider's actual preview/deployment behavior; a status API reference is not deployment evidence.

## 8. Frozen corpus and reset

Build varied, deterministic content around distinct cases. One editable web page plus the paired emails forms the first remote integration run; multiple correction kinds on that web page exercise combined-tree checking. Canonical pricing also exists, outside this miniature three-asset analysis scope, and its deterministic fact update participates in the candidate. Then expand to 19 editable web pages plus pricing and the same two emails. Broader product pages, help articles and historical posts remain web assets under the same supported grammar. The subsequent 200-asset benchmark has its own inventory and never replaces the required 22-asset run implicitly.

- Freeze `content/claims.yaml`, `content/manifest.jsonl`, source files, and initial facts before tuning. Maintain separate tuning and held-out templates, about 40/60 by template within each applicable kind. Identical wording cannot cross the split. The paired identical email cases belong together in the featured split.
- For each of `direct_price`, `annual_savings`, `per_day`, and `plan_gap`, include at least **five independent held-out editable-web template families with deterministic eligible contradictions**. Freeze one representative contradiction passageId per family before tuning; these cases form the independent per-kind gate denominator. Canonical pricing stays in scope and canonical verification but supplies no repair representative. Copies and superficial amount/name variants belong to one family and contribute workload counts only. Report all manifest rows separately, including filtered/missing/error rows; featured cases never enter held-out gates.
- Required featured cases cover direct price, annual savings, per-day, plan gap, historical/unrelated preservation, and the email pair. Log actual author; agent-written cases are labeled as such. All featured cases are excluded from held-out rates.
- Ensure both surfaces contain nonzero consistent, valid-exception, unrelated, and ambiguous protection cases, including unchanged annual and already-correct monthly copy. Cases added to the eligible email must state their scope explicitly when they refer to public pricing.
- Preserve every expected protected block exactly, including legacy-eligible $30 claims. Whole-email preservation applies when the frozen eligible-email fixture has no eligible contradiction. The showcased paired legacy email is such a fixture. In a separately identified mixed-scope fixture, an explicitly stale public-price block may be corrected while legacy/protected blocks remain byte-identical; audience hints never shield an explicitly public claim.
- Every claim has expected label and context; deterministic repairs include normalized value/unit and block assertions. Thresholds have an explicit expected withholding outcome. Seed names and manifest labels never enter judge prompts.
- Scan all unlabelled blocks using the full pricing prefilter vocabulary; remove unintended pricing claims or deliberately label them before freezing. Counts come from the manifest and actual crawl, not target estimates.
- Commit the seed before rehearsal and record its revision/hashes. Local `reset` requires an idle runtime and restores only local fixture content/facts/state, preserving evaluation and submission/deployment evidence. It never rewrites remote branches, merges PRs, or restores a public site implicitly. Prepare each remote rehearsal through the explicit restoration PR below, then verify public seed hashes before timing. Preserve earlier PRs and evidence; use unique run branches. Never delete an open SQLite database or reset during submission/recovery.

**Protected seed restoration.** Once branch protection is active, restore the remote demo using a separately journaled restoration PR with a unique operation ID, pinned current base and frozen seed revision. Its only changes restore mapped source files and `data/facts.json`. The same trusted producer posts `mogs/candidate` after exact seed/preservation checks and `mogs/preview` after the matching preview exposes those source hashes and $30 canonical facts. A human merges under the same required-status, strict-base and no-bypass rules. Verify the resulting production commit, full seed inventory and hashes before starting a fresh launch attempt. Record restoration PR/deployment identifiers separately from correction runs and metrics; restoration contributes no repair success. Interrupted/stale restoration uses the same reconciliation and revocation rules and cannot race an active launch.

Acceptance: the sitemap has 20 web URLs and two email URLs; all manifest IDs resolve exactly once with expected source/rendered text; paired text is identical with distinct IDs and opposite labels; reset is repeatable.

## 9. Console

Build against the frozen API fixtures first.

- `/console`: live site/email links, deployed versus desired facts, Confirm action, exact scope/progress, both analysis timings, submission/deployment timings, real counts and errors. Prevent duplicate clicks while retaining server-side idempotency. The public site stays unchanged while the desired change is analyzed.
- `/console/review`: complete correction groups, current/proposed text, checks, exclusions and protected cases. Approve only the displayed group revision for PR inclusion. Show a run-level Submit change action only when the complete bundle is ready. Display the actual PR URL, preview URL/status, merge, production deployment and live verification as distinct steps. Before submission, refresh checked edit/drop revisions and require renewed affected approvals. After submission, a changed base/source/head requires Abandon and start a new run; show the preserved old PR and reconciled new baseline. A merged failure exposes Reconcile deployed state and its actual observations. These recovery actions are required; they never merge or restore public content.
- Optional within this scope: checked editing and dropping existing patches. These actions never bypass checks or add unresolved ambiguous items to a sealed group. Cut their controls before any required correctness gate if time runs short.
- Escalations appear in a list with reasons. `/console/eval` displays saved isolated-evaluation results and snapshot identifiers.
- Count human group approvals, edits/drops, submission, abandonment/reconciliation and GitHub review/merge actions separately; test approvals, retries and polling add none. Show observed review time separately from processing/deployment waits. Keep unknown GitHub review duration unavailable rather than estimating it. Report corrected surfaces and verified patches against the explicitly named action denominator.

Acceptance: live before → confirm → complete groups → approval → real PR → verified preview → human merge → verified public after can be followed through the console, GitHub and browser without terminal work during the demonstration. Failed submission, incomplete results, failed preview and failed production verification remain distinct. Hosting email previews proves template publication only.

## 10. Evaluation and release evidence

`scripts/eval.ts` must create an isolated sandbox from the frozen seed, use an explicit **desired post-change fact snapshot**, a separate database, and separate served URLs. Remote test publication uses a dedicated test branch/repository/deployment target and never merges the live demo branch. It must not read mutable rehearsal content. Reports under `data/eval/<runId>/` and `data/eval/latest.json` survive reset and record corpus/label/fact hashes, source/candidate/deployment identities where applicable, adapter/model/config, timings, and the tested publication mode (`local`, `preview`, or `production`). Local fixture verification cannot populate production-verified metrics.

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
| Verified repair yield | Correct repairs observed in the report's named local/preview/production environment / all deterministic eligible contradictions; missed/failed/withheld eligible cases remain in denominator; report environments separately |
| Withholding | Counts and reasons, including thresholds lacking a safe target, displayed separately |

Repair correctness uses expected numeric value and unit plus exact approved fixture/block assertions and preservation checks, not substring presence alone. The sandbox may use recorded scripted approvals to exercise publication; label these as test approvals, exclude them from human review counts, and never let this harness approve live content.

For each required deterministic kind, the frozen independent held-out set must achieve **≥80% detection recall, ≥80% correct checked repair yield, and ≥80% verified repair yield**. Use that same full set as the denominator for all three; filtering, missing judgments, errors and withheld deterministic repairs count as unsuccessful outcomes. With five cases, each threshold requires four successes. Score preview and production separately: isolated remote evaluation supplies preview evidence; a production report joins the same frozen seed/manifest to immutable evidence from a named complete 22-asset demo run with matching corpus/facts/provider configuration. It reads saved observations, never mutable rehearsal content, and performs no live approval or merge. Neither environment inherits the other's verification. A local tuning report cannot satisfy these remote gates. No separate production evaluation deployment is required; additional test deployments remain isolated if used. These thresholds describe synthetic regression coverage, not customer accuracy.

Required release gates:

1. Detect every featured wrong claim and at least 80% of all held-out contradicting web claims; also pass the per-kind detection/checked/preview-verified/production-verified thresholds above. Show independent template and full-row numerators/denominators and all misses. Featured cases are excluded; duplicated-template row rates are workload summaries and cannot substitute for independent per-kind gates.
2. Zero proposed edits to consistent, valid_exception, and unrelated protection cases, and zero automatic proposals on unresolved ambiguous cases. Report tested counts by class/surface so an empty category cannot pass.
3. Submit a real PR with named direct-price, annual-savings, per-day, and plan-gap repairs, including a group spanning web/onboarding email and multiple groups combined on one page. Verify the deployed preview and, after human merge, the public deployment. Preserve every protected block and the showcased eligible email exactly under section 8's fixture rule.
4. Block the whole submission for stale/missing/duplicate source IDs, changed facts, changed base/deployed revision, unexplained context changes, broken Liquid tags/URLs or any failed check. Exercise duplicate confirm/approve/submit/abandon/reconcile, a lost PR/close response, changed PR head, failed preview/deployment, interrupted submission/abandonment recovery, merge races and explicit rehearsal seed restoration with fresh attempt identity. Prove current-head merge enforcement; retain earlier local write-recovery tests separately.
5. Pass both specified 22-asset analysis timing targets and three complete remote rehearsals from a verified old deployment through human review, PR, preview, merge, new deployment and rendered verification. Report both analysis results, human/deployment waiting and provider errors. A 200-asset benchmark and any baseline comparison use separately frozen scope and reports.

No human baseline is included. An optional general-purpose-agent comparison follows the remote flow, using the same source access, facts, model/budget, hidden labels, submission task, and opportunity to retain state. Record setup and repeat-run costs, misses, harmful proposals, verified outcomes, and observed review effort. A future human accuracy comparison requires independently adjudicated answers and equivalent tasks. A missed required gate means the target was not met; describe the narrower proven behavior without hiding the miss.

## 11. Provider gates and configuration

**Stage 1, during Step 0:** freeze the exact connection and production serialization/question schema; then test direct price, identical eligible-grandfathered copy, and derived annual savings for every candidate judge. Validate typed response fields, labels, uncertainty semantics, returned model identity, and latency. Run one frontier structured fix through local checks. A passing fix call does not qualify that model as the fallback judge. Record status and redacted results; absent credentials mean the provider gate is untested, not passed.

Direct TypeSafe, the dedicated AI SDK provider, and Gateway are different integration choices with different environment variables and response mappings. Select one Jev connection at kickoff based on configured access, document it in `.env.example`, and validate that exact path. Likewise record the exact frontier provider/model. Do not implement three Jev transports. Keep actual credentials out of Git.

**Stage 2, after the miniature path works:** measure a representative concurrent candidate workload with real judge, frontier fix, and rejudge work, including timeouts/retries. Configure bounded concurrency and a total deadline; record candidate counts, per-stage latency, errors, and elapsed time. The actual 22-asset run establishes the timing gate in section 7. If Jev fails either stage, select frontier only after its equivalent gates pass; rerun evaluation with that adapter. If neither passes, report the blocker rather than substituting fixture output as a live run.

Freeze model versions where available; always log returned model IDs. Example configuration fields are `JUDGE_ADAPTER`, the selected connection's credential variable, `JUDGE_MODEL`, `FIX_MODEL`, `T_REL`, `T_LABEL`, concurrency, request timeout, and the full-run deadline. Thresholds are per adapter; starting values are tuning inputs, not accuracy claims. The build plan sets dispatch gates; its original Stage 1 deadline is historical and no new delivery deadline is implied.

## 12. Demo and wording

1. Open the public fictional MOGS site, canonical pricing and paired email templates with the old content; show exact scope and deployed revision.
2. Confirm the desired Starter $30→$40 change and explicit legacy exception. Show that production still has its old content.
3. Run the existing crawl → classify → draft → check → group pipeline across the full scope. Show complete groups, real counts and both analysis timings.
4. Inspect web/email and derived corrections, preserved legacy/historical/unrelated copy, and unresolved/withheld claims. Approve the complete groups.
5. Submit one real pull request. Open its exact source diff and verified deployed preview, including canonical pricing and multiple corrections on one page.
6. Have the reviewer merge; observe the matching production deployment and open the verified public web/email results. Show any failed live check plainly.
7. Show saved synthetic evaluation, protection/repair denominators, misses, withholding and actual human actions. Additional scale or baseline evidence is clearly identified separately.

Say “fictional company,” “controlled deployed site,” “repository-backed email templates,” “real pull request,” and “checked in the deployed page” only when the recorded result supports each phrase. Local v1 results remain local results. Rejudgment is a model check; browser observation establishes the observed rendered output. A controlled GitHub/hosting integration does not establish arbitrary CMS support, real-customer accuracy, email delivery, continuous monitoring or revenue impact. The roughly four-minute presentation is a rehearsal target; deployment waits and recorded segments must be disclosed and timings remain measured.

## 13. Provider references

- TypeSafe API: https://docs.typesafe.ai/api
- TypeSafe JavaScript SDK: https://docs.typesafe.ai/sdk/javascript
- AI SDK TypeSafe provider/Gateway integration: https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai
- TypeSafe confidence semantics: https://docs.typesafe.ai/confidence
- Model identifiers: https://docs.typesafe.ai/models
- Documented Jev 1.13 limitations: https://docs.typesafe.ai/model-jaggedness/jev-1.13

Read the documentation for the chosen integration and installed versions during Step 0. These references do not replace actual provider smoke or workload evidence.
