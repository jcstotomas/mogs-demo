# Gate 1 handoff

## Demonstrated

The miniature app serves one editable web page, two paired emails, and a read-only fact-driven pricing page. Its 33 editable blocks resolve by stable asset/source IDs. The four-url sitemap excludes pricing from the three-asset correction scope.

Real provider run `89c94f8e-0d11-40b6-8db3-09f686c097ff` used Anthropic directly, `claude-sonnet-5-5`, frontier prompt `gate1-v2`, concurrency 4, and 20-second call timeouts. It judged 24 candidates, detected all six planted wrong claims, drafted five checked fixes, withheld the threshold claim, and retained three insufficient-context offers. The direct group had one web and one onboarding-email member; the eligible legacy email received no patch.

First sealed group: **26,890 ms**. All results ready: **26,902 ms**. Recorded processing/publication work: **55,734 ms**. These timings describe the miniature, not the required 22-asset workload.

Four **test** approvals in isolated `/private/tmp/mogs-gate1-v2` published and freshly fetched/rejudged all five repairs. Direct price was followed by annual savings, per-day cost, and plan gap on the same web file. Pending group revisions advanced to 1, 2, and 3 after recorded file changes and context checks. Duplicate confirm and approval requests returned the original operation. Human review action count remained zero.

All protected block text and the eligible email's exact source hash remained unchanged. A browser opened the served repaired web asset and observed $40 monthly, 40% savings, about $1.33/day, and a $40 Team gap; the ambiguous and withheld copy remained visible. The console, pricing, and email routes loaded without a browser error overlay. Lane C additionally tested restoration, lost-response retry, refreshed revisions, and mobile layout against explicit fixture responses.

Full evidence: `data/evidence/gate1-89c94f8e-0d11-40b6-8db3-09f686c097ff.json`.

## Preserved failure and coordinated changes

Initial run `0e0710f5-ad96-4002-886a-14cb2a91a521` used `step0-v1` and failed before publication: two ambiguous offers received proposed edits. Its evidence remains in `data/evidence/`. The corpus and labels were kept unchanged. The coordinator sharpened the scope rule and recorded prompt revision `gate1-v2`; direct-price judgments with unresolved billing now require context. No synthetic confidence was added.

Other coordinated extensions are the GET facts and group-open schemas/fixtures, typed response aliases, run-scoped DB queries, nested transaction support, and an optional content-root argument for pipeline checks. Existing Step 0 fixtures retain their original prompt version.

## Runtime guarantees checked

- Confirmation journals recover the fact-file/DB transition without a second version or timestamp.
- Scheduled/running process leases keep a second worker from interrupting an active run; abandoned owners become explicit failures on restart.
- Every DB handle closes after its operation. Reader leases and the mutation lock prevent reset from deleting an open database.
- Publication preflights the entire eligible set, stages before/after images durably in SQLite, batches blocks per file, and records writes before served verification.
- External edits and edits arriving during asynchronous rechecks block publication. Application revision chains must preserve original blocks and metadata before pending work is revalidated.
- Injected second-file write failure and restart after a partial write restore recorded before images. Unknown recovery state blocks further writes.

Checks passed: typecheck, production build, typed fixture checks, and 20 meaningful contract/runtime tests. Reset restored exact live seed source/fact hashes and preserved both evidence exports. Multi-file filesystem writes and SQLite are recoverable operations; they do not form an intrinsically atomic filesystem transaction.

## Human handoff and next gate

Live run `ff57ceec-5f59-49e0-9a26-d9911b2fdd57` is prepared in the console with four sealed groups and five eligible patches. First sealed group: 27,011 ms; all results ready: 27,026 ms. It has **zero publications and zero review actions**. The HTTP Confirm path, background processing, console restoration, and documented run/groups/export aliases passed. Missing run ID returns 400; an unknown run returns 404. Snapshot: `data/evidence/gate1-live-pending-ff57ceec-5f59-49e0-9a26-d9911b2fdd57.json`.

Final review wording and narrow-screen corrections:

| Before | After | Why |
|---|---|---|
| Unresolved billing was described as conflicting audience/eligibility | Plan, billing period, or eligibility needs more context | Names the actual unresolved pricing scope |
| Footer described publication while the published count was zero | Pending approval describes the next operation; actual publication uses per-group results | Keeps result claims tied to recorded state |
| Price row overflowed at 320px with 150% text zoom | Price tokens wrap and grid children can shrink | Keeps enlarged text inside the review surface |

Populated review screens were inspected at 1440px, 375px, and 320px. Visible keyboard focus and reduced motion passed. The final text-zoom recheck is recorded with the browser evidence. Screenshots are saved under `/private/tmp/mogs-review-*` and `/private/tmp/mogs-context-copy-320.png`. The parallel frontend guardrail/style changes in this checkout are preserved separately from this integration commit.

Open `/console`, confirm the price change, open the direct-price group and approve its displayed revision, then review and approve annual savings on the same web page. The console requires one human approval per complete group and displays the served verification result. The test harness cannot use the live demo content, facts, or database paths.

**Human live approval is pending.** Corpus expansion, evaluation lane D, the 22-asset timing gate, and full rehearsals have not started.

For an isolated rerun, choose a fresh `MOGS_GATE1_ROOT`, prepare it with `npm run gate1:smoke -- prepare`, and run a local server with `MOGS_CONTENT_ROOT`, `MOGS_FACTS_PATH`, `MOGS_DATABASE_PATH`, and `MOGS_BASE_URL` pointing to that copy. Use a separate `MOGS_BUILD_DIR` for concurrent Next servers. Run `npm run gate1:smoke` with that root/base URL and the seed commit recorded in `MOGS_SEED_REVISION`. Provider keys stay in ignored `.env.local`.
