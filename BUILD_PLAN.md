# MOGS Launch Correction Agent — build plan

**Authority:** [SPEC.md](SPEC.md) defines product behavior, data contracts, and acceptance rules. This plan defines sequence, path ownership, and build gates. The revised documents incorporate the accepted fresh review and supersede the original pasted draft. Code freeze is **5:00 PM Pacific** on the build day; feature work stops at **4:15 PM**.

## Required build and evidence

Build a local fictional MOGS (Member of GTM Staff) demo over exactly **20 web pages, including the canonical pricing page, plus two paired emails**. Confirming the change raises Starter monthly from $30 to $40 for customers without legacy eligibility. The canonical pricing page is fact-driven and never receives a correction patch; the other 19 web pages are editable. One approval per correction group publishes its checked patches across web and email, then verifies the served result.

The required examples cover direct price, annual savings, per-day cost, plan gap, eligible grandfathering, historical prices, already-correct claims, unrelated numbers, and ambiguous claims. Every applicable check is blocking. Failed checks withhold patches; unresolved ambiguity and threshold wording remain visible in a list. Checked manual editing/drop controls are optional polish. If implemented, edits rerun all checks and group exclusions are audited. There is no override path in this build.

Ads, decks, additional emails, large-corpus generation, human baseline comparisons, override UI, real-site runs, and change-monitoring features are deferred. Passing a gate does not unlock that scope. Use short deterministic content around the planted claims; corpus word count is not a goal.

The dependency chain is **executable shared contracts → source/render/crawl → classification and checked fixes → sealed groups → serialized publication and recovery → served verification → evaluation and rehearsal**. A build passing typecheck is one piece of evidence, not a completed demo.

## Step 0 — prove and freeze the shared contracts

The coordinator completes and commits this baseline before dispatching lanes. Shared ownership is defined in the table below. Record actual results; the planning documents themselves are not proof that a provider or gate passed.

1. Scaffold one Next.js App Router + TypeScript app in the existing repository. Add `dev`, `build`, `typecheck`, `test`, `eval`, and `reset` scripts, SQLite storage, and `.env.example`. Keep real provider keys outside Git.
2. Implement the exact source grammar, parser, renderer, source-ID algorithm, and block replacement helper specified by `SPEC.md`. Prove an executable fixture round trip: source bytes → rendered `data-source-id`/`data-role` blocks and asset metadata → crawled passages → one checked replacement → rendered result. Include duplicate text with different IDs, an email Liquid tag and URL, and multiple blocks in one file. Freeze grammar and API signatures from this example; hand the implementation to A after the baseline.
3. Freeze facts and code-derived values, explicit legacy eligibility, canonical pricing behavior, and the initial/post-change fact versions. `existing_customers` alone cannot grant the legacy rate. Confirm coordinates the fact update and creation/start of one run and returns its original timestamp and IDs. One live confirmed change/run is allowed until reset. Confirm retries return that operation instead of creating another fact version or resetting the timer.
4. Freeze SQLite schemas, shared types, and request/response/error fixtures for facts, runs, judgments, patches, checks, groups, approvals, and evaluation. Include run scope and ownership, correction kind/target value, complete group membership, withholding reasons, source/context revisions, provider configuration, and publication state. Approval retries return the existing operation; they must not write twice.
5. Freeze run completion and group sealing. The full scoped run must finish classification, and a group's drafting/checking must finish, before that group's membership is sealed and approval enabled. No patches may be added after sealing; record permitted exclusions and revision changes explicitly. Surface terminal failures and withheld items. Measure `firstSealedGroupMs` and `allResultsReadyMs` from the original Confirm event.
6. Freeze serialized publication, durable recovery, source freshness, and verification contracts. Stage multiple changes to a file together. Revalidate pending patches and their relevant context after application-owned writes so separate groups can update the same file sequentially. External edits invalidate affected work; do not silently accept a new baseline. A failed preflight writes nothing. Recovery and consistency guarantees must match `SPEC.md`; do not claim a filesystem and database transaction is intrinsically atomic.
7. Freeze the seed layout, fixture labels, pinned post-change facts, and isolated evaluation configuration; A later freezes the complete corpus and labels before Gate 2. Evaluation uses separate working content/database state and writes reports that survive demo reset. Seed and report provenance identify corpus/labels, facts, adapter/model, thresholds, and run ID.
8. Run provider stage 1 below, typecheck the scaffold and fixtures, and run the executable source round trip. Step 0 is complete only when the selected judge passes all three classification cases, the frontier structured fix passes, the round trip passes, and typecheck passes. Commit the completed baseline with its result record before dispatch. If blocked, a partial progress commit may preserve the work, but it does not authorize lane dispatch or claim Step 0 completion.

Shared contracts are then frozen. Propose a change with its affected lanes; the coordinator updates types, fixtures, and callers together before dependent work proceeds.

### Provider stage 1 — adapter correctness

Start the decision window at the next actual implementation kickoff and decide within **30 minutes**. Test each candidate judge, including a frontier fallback under consideration, on the same three classification cases: stale direct price, explicitly eligible grandfathering, and derived annual savings. Check expected labels, response fields, errors, and measured latency. Also run one frontier structured fix through schema validation and the applicable checks.

Choose one exact integration path and its configuration: package/API, endpoint, model ID, environment key names, and response mapping. Jev confidence, label probabilities, and frontier uncertainty remain distinct. Select an adapter only after its gate passes. An unavailable key or unsuccessful call is a recorded blocker; an untested fallback is not a passing result. Stage 1 does not establish the full-run latency claim.

## Lane ownership and dispatch

This table is the authoritative ownership map. Prefer separate worktrees from the committed Step 0 baseline. In a shared checkout, edit only owned paths. Package or shared contract changes go through the coordinator.

| Lane | Owns | First deliverable | Handoff evidence |
|---|---|---|---|
| **Coordinator — shared state and publication** | `lib/types.ts`, `lib/db.ts`, `lib/facts/**`, `lib/runs/**`, `lib/publication/**`, `data/facts.json`, `fixtures/**`, package/config files, integration and release gates | Step 0 contracts, run lifecycle, idempotent confirm/approve, serialized publish/recovery/verify | Sequential groups on one file work; stale/external changes block; failures recover; API fixtures and runtime states agree. |
| **A — assets and crawl** | `app/site/**`, `app/assets/**`, `app/sitemap.ts`, `content/**`, `lib/assets/**`, `lib/crawl/**`, `scripts/generate-site.ts`, `scripts/reset.ts` | One editable web page plus the paired emails, using the Step 0 parser, renderer, and crawler | IDs resolve exactly once; tokens/URLs survive; expand to exactly 20 web + 2 emails; freeze labels/templates and seed; reset restores exact hashes while preserving evaluation reports. |
| **B — classification and fixes** | `lib/pipeline/**`, `app/api/**` | Classification → fix → checks → correction grouping against the miniature fixture | Required/protected cases produce expected results; withholding is explicit; API handlers delegate run lifecycle and publication to coordinator modules. |
| **C — review console** | `app/console/**` except `eval/**`; `components/**` | Fixture-backed confirm → progress → sealed group review → approve → verified links | Complete groups alone are approvable; show protected/ambiguous/withheld/failed results and actual counts/times; any optional edit/drop controls enforce checks and revision rules. |
| **D — evaluation** | `scripts/eval.ts`, `lib/metrics/**`, `app/console/eval/**` | ID-based isolated evaluation with reproducible provenance | Reports detection, protected-case proposals, withheld fixes, and verified repairs separately; evaluation cannot mutate rehearsal state or lose reports to reset. |

The current runtime has **three worker slots plus the coordinator**. Dispatch A, B, and C first. D replaces A after A hands off the required corpus, parser/crawl, and reset evidence; A can then be resumed if an asset defect blocks integration. The coordinator prepares evaluation contracts and fixtures during Step 0 so D can start immediately at handoff.

**Integration seams:** A owns source interpretation and served extraction; B consumes its frozen passages. B owns model/check results and grouping inputs; the coordinator owns run completion, sealed membership, approval, and publication. C consumes API fixtures and responses, never inferred DB state. D joins by stable passage/source IDs and consumes recorded run results. A freezes template splits before any tuning. Jeremy-authored examples require Jeremy's actual text; agent-authored substitutes are labeled accurately, and examples chosen after observing results are excluded from held-out metrics.

## Ordered integration gates

### Gate 1 — miniature complete loop

Before expanding the corpus, pass the live loop on **one editable web page plus the paired emails**. The fact-driven pricing route is also available for confirmation but is outside this miniature three-asset run scope.

- The web page contains multiple correction kinds so two separate groups will later touch the same file. The paired email sentence is wrong for onboarding and valid only for explicitly eligible active pre-change Starter monthly subscribers.
- Confirm → crawl → real judge → checked fixes → sealed group → approval → local publish → served verification works. Then approve a second correction group on that same web file; unchanged valid work must remain publishable after revalidation.
- A protected email remains untouched, Liquid tags and URLs are preserved, and an ambiguous or failed-check patch stays withheld. Repeating confirm/approve requests does not duplicate changes.
- Record the run ID, provider/model, labels, group membership, published/verified counts, and timing. This miniature proves integration; it does not satisfy the 22-asset timing gate.

### Gate 2 — required corpus and provider stage 2

- Serve exactly **20 web pages including pricing, plus two emails**; every expected asset is in the sitemap and every manifest ID resolves once. Freeze the initial corpus, facts, templates, labels, and their hashes in Git before rehearsal reset.
- Run the actual 22-asset workload with the intended concurrency, including classification, fixes, checks, and rejudging. From Confirm to the **first complete, sealed reviewable group must be ≤90 seconds** (`firstSealedGroupMs`). Record `allResultsReadyMs` separately, including failures and withheld items; incomplete group membership cannot be approved.
- Require all featured wrong examples to be detected. Publish and verify named direct-price, annual-savings, per-day, and plan-gap repairs; direct-price approval includes its eligible web and onboarding-email patches. Preserve the paired legacy email and every protected case.
- Record real counts and latency by stage. Revisit adapter/concurrency or shorten nonessential prose if timing fails, then rerun the same required scope. Preserve the actual failing result; stage 1 passing is not a substitute.
- Publish changes, reset, and compare exact source/fact seed hashes. Evaluation reports must survive the reset.

### Gate 3 — isolated evaluation and failure handling

- Evaluate a fresh copy of the pristine seed against pinned post-change facts in separate content/database state. Record corpus/label hashes, facts version, adapter/model, thresholds, and run ID. Freeze held-out templates before tuning; tune only on the tuning split. Log genuine label corrections and fully rerun their affected evaluation.
- Require **100% detection of featured wrong claims** and **≥80% recall on held-out contradicting web claims**, with numerators and denominators. Require **zero proposed edits** to expected `consistent`, `valid_exception`, `unrelated`, and unresolved `insufficient_context` claims. Report the paired email result as a case study, not broad email accuracy.
- Show detection, withheld fixes, and successful verified repairs separately. Include per-kind and per-surface denominators, misses, failed checks, and unlabeled findings. Passing recall alone cannot replace the required verified repair examples. Scripted approvals for isolated publication tests are test-only; the live demo requires the reviewer to approve.
- Test missing/duplicate source IDs, external edits, changed relevant context, stale fact versions, broken email tags/URLs, repeated approve requests, and same-file sequential groups. Include a draft/check response that arrives after another group publishes; it must reconcile revisions before being accepted or sealed. A failed preflight blocks the whole group. Exercise an interrupted publication/recovery path and report exactly which guarantees it demonstrates.
- Browser re-fetch plus rejudging determines `verified` versus `failed_verify` for every published patch. A served replacement proves local publication; model rejudging is not independent proof of factual correctness.

### Gate 4 — three rehearsals and capture

Run the complete reset → Confirm → review → approve → served verification path three times using the frozen 22-asset scope. Show the required corrections, preserved cases, ambiguity/withholding, and isolated evaluation report. Record run IDs, counts, provider, timing, and failures for each rehearsal. Capture a backup recording using truthful local/synthetic wording.

## Time and cuts

The provider decision has a 30-minute window from actual kickoff. The ordered gates above govern progress. At **4:15 PM**, stop feature work and reserve the remaining time for rehearsal, failure fixes, and backup capture. At **5:00 PM**, freeze code.

If time slips, cut visual polish, extra filtering/export controls, and optional checked editing/drop controls. Keep list visibility for unresolved items, the required corpus, derived claims, exception handling, sealed group approval, idempotency, publication recovery, served verification, isolated evaluation, and reset. Deferred surfaces remain deferred. If any required gate fails, report the narrower demonstrated result and the missed gate explicitly; do not claim the required demo is complete.

## Start and handoff instructions

1. **Coordinator:** complete Step 0, commit the baseline, and report files, checks, source-round-trip evidence, provider results, and blockers before dispatch.
2. **A:** build the miniature source/render/crawl path and pair first; expand only after Gate 1. Hand off the exact 20 + 2 corpus, manifest, parser/crawl, and repeatable reset.
3. **B:** implement judge/fix/check/group against frozen contracts and the miniature fixture; keep API orchestration thin and connect coordinator lifecycle/publication functions.
4. **C:** build the reviewer flow against fixtures, then connect real responses. Show complete membership, explicit withholding, checks, actual counts, and verified links.
5. **D, after A handoff:** implement isolated evaluation, protect all noncontradicting/ambiguous cases, and report verified repairs separately from detection.
6. **Coordinator after integration:** run typecheck, the relevant contract/failure tests, and build; perform a focused browser check of the changed path. Before a full rehearsal, reset and record the exact corpus/facts/provider configuration. Broaden testing only for a remaining risk or a required gate.

When the scaffold and routes exist, run `npm run dev` and inspect `/site/pricing` and `/sitemap.xml` in the local browser before crawling. Run `npm run eval` only against the frozen isolated evaluation setup. Use `npm run reset` to prepare each timed demo run.

## Demo wording

Use **“fictional company,” “locally served asset,” “published locally and re-checked in the browser,” “one approval per complete correction group,”** and **“synthetic held-out test.”** Name actual asset counts and the tested adapter. Present measured completion/review time and verified corrections; omit human-baseline speed or accuracy comparisons. Local verification does not establish a production integration or customer impact.
