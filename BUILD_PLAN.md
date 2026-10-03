# Launch Correction Agent — swarm build plan

**Authority:** `SPEC.md` is the product and implementation contract. This plan sets build order, ownership, and gates. The accepted interview decisions are incorporated in the revised spec and take precedence over conflicting language in the original pasted draft. One coordinator owns shared contracts and integration; agents A–D own the paths below. Code freeze: **5:00 PM Pacific** on the build day.

## Ship target and critical path

Ship a local, fictional MOGS (Member of GTM Staff) demo: confirm Starter monthly changes from $30 to $40 for new customers; within **90 seconds**, a live run over **20 served web pages plus the paired emails** produces a reviewable correction group; one approval of that group publishes its eligible patches to the locally served files, rechecks the browser pages, and records verified or failed verification. Direct price, annual savings, per-day, valid grandfathering, historical, unrelated, and ambiguous claims must be visible. `npm run reset` must restore the rehearsal state.

The dependency chain is **shared contract → served assets and crawl → judge → fix and checks → group → atomic group publish → live verify → UI → eval and rehearsal**. Parallel work starts after the shared contract is frozen. Ads, decks, corpus volume, and polish enter only after this chain works. A passing build is not a completed demo.

## Step 0 — coordinator freezes the seams

Do this before agents edit their areas. Only the coordinator edits shared files (`lib/types.ts`, `lib/db.ts`, `lib/facts/derive.ts`, `data/facts.json`, `fixtures/*`, package scripts, and cross-cutting configuration). Commit this baseline before dispatch. Completion means all agents can typecheck against the same contracts and run against the same fixture.

1. Initialize Git and scaffold one Next.js App Router + TypeScript app in the existing directory. Add `dev`, `build`, `typecheck`, `test`, `eval`, and `reset` scripts. Keep SQLite at `data/app.db`. Add `.env.example`; keep real keys out of Git.
2. Define the exact source format: UTF-8 Markdown files with frontmatter and **plain editable blocks carrying stable `sourceId`s**. Render each block with `data-source-id` and `data-role`; render asset metadata in `#asset-meta`. Email Liquid tags remain literal. General rich Markdown editing is outside this build.
3. Freeze stable IDs: `Passage.id` is derived from surface + asset path + `sourceId`; `ManifestRow` stores that `passageId`. The evaluator joins by ID, never by passage text. A source lookup must find that source ID exactly once and match its original text/hash.
4. Freeze eligibility: the $30 exception applies only to an **active Starter monthly subscriber from before the change**. Asset metadata must carry that status explicitly; `audienceHint: existing_customers` alone never grants the exception. The paired emails use the same sentence with different eligibility context.
5. Freeze fact behavior: confirming the change updates the canonical local pricing page to $40 for new monthly customers, retains the eligibility rule for $30, bumps `factVersion`, and computes derived values in code. `reset` returns facts, source content, and DB to the initial state.
6. Freeze judge output with `adapter` and optional/adapter-specific confidence. Jev probabilities and frontier fallback scores must not be presented as equivalent. In-scope unchanged Starter claims remain judge candidates and can receive `consistent`; `unrelated` is reserved for truly unrelated claims.
7. Freeze group publish semantics: approval is **per correction group**, across its surfaces. The whole group is preflighted against fact version, original source block, source freshness, and hard checks. Multiple changes in one file are applied to one staged file image. If any eligible patch fails, publish none; if a staged write fails, restore original files and report the failure. Withheld/dropped items are outside the approvable set.
8. Freeze hard checks and override rules: source location/freshness, allowed numbers, scope qualifiers, email tokens/URLs, and ad lengths block publishing. A recorded human override may address only span size or model disagreement. A published override becomes `verified` only after a passing live recheck.
9. Create one fixture each for facts, served page/passage, judgment, patch/checks, group, run progress, and eval result. Freeze API request/response shapes and fixture IDs. Agent C starts from fixtures; B implements those shapes.
10. **Do now — provider gate:** smoke-test the actual Jev adapter on **direct price, grandfathered eligibility, and derived savings**, checking expected fields and usable latency, plus one frontier fix call. Make the Jev decision by **11:50 AM** if still possible; if that time has passed, decide within 30 minutes of kickoff. If the three-case gate fails, set `JUDGE_ADAPTER=frontier`, mark its confidence as unavailable or adapter-specific, and continue.

No agent changes shared files after this freeze. Contract changes go to the coordinator, who updates types, fixtures, and affected agents together.

## Parallel ownership after Step 0

| Agent | Owns | First deliverable | Done when |
|---|---|---|---|
| **A — assets and corpus** | `app/site/**`, `app/assets/**`, `content/**`, `scripts/generate-site.ts`, `scripts/reset.ts` | 20 served web pages, canonical pricing, paired emails, sitemap, manifest by `passageId` | Every manifest ID resolves once to its served source block; reset is repeatable; protected and featured examples are planted and labeled. Expand to 60+ web pages, ads, and decks only after checkpoint 1. |
| **B — pipeline and APIs** | `lib/pipeline/**`, `app/api/**` | `/api/run` on A's 20 pages plus paired email, with progress, judgments, patches, groups | One group approval preflights and publishes all eligible patches, re-fetches served URLs, and records verification; a failed hard check or stale block publishes none. |
| **C — review console** | `app/console/**` except `eval/**` and `baseline/**`; `components/**` | Fixture-backed confirm → progress → group review → approve flow | A reviewer can edit/drop a patch, see check results and surface breakdown, approve one group, and open verified served URLs without using a terminal; approve/edit/drop/escalation actions and human review time are recorded. |
| **D — evaluation and baseline** | `scripts/eval.ts`, `lib/metrics/**`, `app/console/eval/**`, `app/console/baseline/**` | ID-based tuning/held-out report with counts and protected-case failures | Reports prefilter recall, label matrix, contradicting precision/recall, false edits, repair validity, misses and withheld items by split/kind/surface; frontier and Jev results remain separate. |

**A ↔ B:** A supplies served URLs, `#asset-meta`, `data-source-id`, `data-role`, and manifest IDs. B crawls those exact rendered elements. Agree on a two-block sample before generating volume.

**B ↔ C:** C uses Step 0 fixtures and API shapes. B connects real progress and approve responses without asking C to read DB internals. Surface counts and status transitions are data from B, not UI guesses.

**A/B ↔ D:** A freezes template IDs and the held-out manifest before tuning. B exposes judgments, patch checks, and run IDs keyed by `passageId`; D never joins on text. D can score fixtures before the complete pipeline exists.

**Coordinator:** integrate small working slices, resolve seam changes, run gates, write/verify Jeremy-authored passages if time is reserved, and own the final cut decision. If Jeremy's ten passages are unavailable, A may supply agent-written substitutes labeled as such; anything chosen after seeing results stays out of held-out metrics.

## Ordered integration gates

### Gate 1 — served source and web checkpoint

- A's first 20 web pages and paired emails appear in the sitemap and browser. `/site/pricing` renders from current facts. Exact source IDs survive rendering; Liquid tags survive email rendering.
- B crawls the served routes and produces passage IDs that match the manifest. The lexical prefilter includes unchanged in-scope Starter pricing claims. Record pages, passages, candidates, and judging latency.
- Live confirm → reviewable group takes **≤90 seconds** on this scope. All featured wrong claims on the shown surfaces are found. The paired sentence is `contradicting` for new signups and `valid_exception` only for an active pre-change Starter monthly subscriber. “Starter is $30 a month” on a new-customer page is wrong; “Plans from $30” escalates as ambiguous.
- **Before the first `npm run reset` rehearsal**, commit the generated, frozen demo corpus, held-out manifest/template split, and initial facts to Git. A's reset script must restore from this committed seed, not the earlier Step 0 scaffold commit. Verify a publish changes files and reset restores their exact seed hashes.

### Gate 2 — safe publish and review

- C shows direct and derived groups, outliers, ambiguous items, checks, and the paired exception; one approve action handles one group across its surfaces.
- B handles two edits in the same file in one staged write. Test a stale source block, a missing block, a broken email token/URL, and an ad over length where applicable: each blocks the entire eligible group. Test allowed override paths and record who/what was overridden.
- After approval, browser URLs show replacements. Rejudge each changed block: passing results are `verified`; failures are `failed_verify`. Run `reset`, then repeat this path at least three times for rehearsal.

### Gate 3 — frozen synthetic evaluation

- Freeze held-out phrasings before threshold tuning. Fit `T_REL` on tuning only. Fit `T_LABEL` only for an adapter that supplies a validated comparable confidence score; Jev and frontier results are evaluated separately. A genuine held-out label correction is logged, followed by a full rerun and disclosure.
- Require **100% detection of featured wrong claims on shown surfaces** and **≥80% recall on held-out contradicting web claims**, displayed as numerator/denominator. For every shown surface, require **zero proposed edits** to planted grandfathered, historical, and unrelated claims. Show all misses, withheld fixes, and unlabeled findings plainly.
- Call this a **synthetic scenario regression test**. Do not infer real-customer accuracy. If an adapter changed, rerun and report that adapter's metrics separately.
- Jeremy labels the timed 30-passage baseline blind to agent answers. Jeremy's labels form the human baseline reference; show disagreements with the generated manifest and compare the agent on the same 30. If this cannot be done, omit the baseline claim.

### Gate 4 — optional surfaces

Expand from the required paired emails to the full email collection, then add ads and decks through the same pipeline. Each surface must pass extraction, metadata, safety checks, publish/verify, and its protected-case gate before it appears in the pitch. Scenario sends/spend may sort findings but remain explicitly labeled **invented scenario data**.

## Time and cuts

Use the original checkpoints if still available; if a clock time has passed, apply its gate immediately and cut lower-priority scope. A surface still failing its own acceptance gate by **3:45 PM** leaves the sitemap and pitch. At **4:15 PM**, stop feature work and run three reset-to-verify rehearsals plus a backup screen capture. At **5:00 PM**, freeze code.

| Decision point | Required evidence | Action if red |
|---|---|---|
| **1:30 PM — web checkpoint** | 20 web pages + paired emails, live run, first group, publish/verify | Reduce corpus to the checkpoint slice; focus A/B/C on this path. |
| **2:30 PM — eval checkpoint** | Frozen held-out split, first counts, largest failure class identified | Fix that class on tuning; leave secondary surfaces off. |
| **3:45 PM — surface gate** | Each pitched surface passes its protection and publishing checks | Remove failing surface individually; keep accurate asset counts. |
| **4:15 PM — rehearsal** | Reset works and all demo links/checks complete | Cut visual polish, baseline page, and optional cases. |
| **5:00 PM — freeze** | Demo path and evidence captured | Stop edits; pitch only verified behavior. |

Cut in this order: stretch (`recheckChanged`, fact-version staleness, real-site read-only run), decks, ads, full corpus size, baseline page, extra escalation actions. Retain the 20-page plus paired-email path, derived claims, exception handling, grouped approval, hard safety checks, local publish/verify, honest eval counts, and reset. If the paired email cannot pass, state the narrower web-only result rather than claiming the target was met.

## Immediate start instructions

1. **Coordinator:** put the revised `SPEC.md` and this file under Git; scaffold the app and freeze Step 0 types, fixtures, source format, scripts, and API shapes. Run `npm run typecheck`. **Run the three-case Jev gate immediately** and smoke-test the frontier path; record the adapter decision in `.env.example` or a build log without exposing keys.
2. **Dispatch A:** “Build the first 20 served web pages, canonical pricing, two paired emails, sitemap, stable source IDs, manifest, and reset. Match Step 0 fixtures. Return sample URLs and manifest IDs.”
3. **Dispatch B:** “Build the crawl-to-verify path and APIs against the frozen fixture. First pass the two-block extraction sample, then the 20-page plus paired-email run. Prove group preflight and same-file multi-edit behavior.”
4. **Dispatch C:** “Build the fixture-backed reviewer path from confirm to verified link. Match the frozen API shapes; show hard check failures and override records.”
5. **Dispatch D:** “Freeze the template split, build ID-based metrics, and return held-out counts with all misses/protected-case failures. Prepare blind 30-passage baseline only if Jeremy can perform it.”
6. **Coordinator after each merge:** run `npm run typecheck`, `npm run test`, `npm run build`, then a focused browser smoke test of the changed path. Use `npm run reset` before each full rehearsal. Record the exact run ID, adapter, facts version, corpus scope, counts, and elapsed time used in the pitch.

When the scaffold and first routes exist, start the local app with `npm run dev`; check `http://localhost:3000/site/pricing` and `http://localhost:3000/sitemap.xml` in a browser before running the crawler. Run `npm run eval` only after A has frozen the held-out manifest; run `npm run reset` before the timed demo path.

## Demo wording and evidence

Say **“fictional company,” “locally served asset,” “published locally and re-checked in the browser,” “one approval per correction group,”** and **“synthetic held-out test.”** Name the exact asset counts and adapter used. Show numerators and denominators, misses, protected claims, withheld fixes, and any failed verification. Treat scenario volume as invented. A local browser check supports the local publishing claim; it does not establish a production integration or live customer impact.
