# MOGS Remote 1 miniature handoff

**Status on 2026-10-03: the three builders are integrated and a real miniature analysis is ready for human review. Remote 1 remains incomplete.** The recorded run has four sealed correction groups, five checked proposed edits, one withheld threshold claim, zero errors, zero approvals and no submission. Human group approval, a real correction PR, verified preview, human GitHub merge and matching production verification are still required.

Open the [local review console](http://localhost:3104/console/remote?runId=07c47d90-b32a-45cf-9b33-97571ca7819c). The coordinator server is local; the controlled fictional site remains at [mogs-demo.vercel.app](https://mogs-demo.vercel.app). Email publication updates repository-backed previews and never sends messages.

The [build plan](../BUILD_PLAN.md) governs the remaining sequence. Preserve the [Step 0](STEP_0.md), [local Gate 1](GATE_1.md) and [Remote 0](REMOTE_0.md) records. Active scope remains one editable web page plus the paired emails, with canonical pricing additionally captured and verified as the fact-driven output. Expansion to exactly 20 web pages plus two emails waits for completed Remote 1.

## Integrated implementation

| Owner and integrated commit | Files | Completed slice |
|---|---|---|
| A — `de1cea8` | [remote crawler](../lib/crawl/remote.ts), [evaluation preparation](../lib/metrics/remote-preparation.ts), [evaluation script](../scripts/eval.ts), associated crawler/preparation tests | Full miniature extraction bound to exact pinned Git sources, facts, deployment metadata and rendered bodies; isolated pristine evaluation preparation without active inventory expansion |
| B — `7556b40`, `5114e96` | [analysis worker](../lib/pipeline/remote.ts), [patch checks](../lib/pipeline/checks.ts), [v2 handlers](../app/api/v2/_lib/handlers.ts), [HTTP dispatcher](../app/api/v2/_lib/dispatch.ts), [pipeline tests](../tests/remote-pipeline.test.ts), [HTTP tests](../tests/remote-http.test.ts) | Complete classification before sealing; checked drafts and explicit withholding/errors; durable worker ownership shared across route instances; strict local versioned HTTP dispatch |
| C — `5a19e56` | [review route](../app/console/remote/page.tsx), [console](../components/remote-console.tsx), [view model](../components/remote-console-model.ts), [fixture states](../components/remote-console-fixtures.ts), [styles](../components/remote-console.module.css), [console tests](../tests/remote-console.test.ts) | Confirm, progress, complete-group review/approval, submission and deployment evidence, explicit abandon/reconcile states; disabled, clearly labeled fixture controls |
| Coordinator — integrated runtime handoff | [runtime composition](../lib/runs/remote-runtime.ts), [shared read DTOs](../lib/runs/remote-api.ts), [restoration readiness](../lib/runs/remote-restoration.ts), [Git source reader](../lib/deployment/git-source.ts), [Vercel adapter](../lib/deployment/vercel.ts), submission/status integration and associated tests | Actual source/hosting adapters, immutable run snapshots, candidate preparation/submission, explicit deployment observation, recovery/restoration and current enforcement validation |

The local console and `/api/v2` operate on the separate durable v2 database and pinned remote source snapshots. Confirm stores desired facts; group approvals authorize inclusion in a combined candidate. Neither action publishes content. Deployment checking is an explicit action; ordinary status polling does not create reviewer actions or rejudge content.

| Before | After | Why |
|---|---|---|
| Typed v2 fixtures with HTTP/console wiring pending | Integrated local console, versioned routes and analysis worker | Make the miniature source-to-review path usable against recorded live evidence |
| General public seed proof and local provider qualification | Fresh extraction and provider-backed analysis of the actual pinned public miniature | Establish the narrower deployed-source analysis result before human review |
| Module-local worker ownership | Process-shared ownership plus a durable lease | Preserve an active worker when another route instance polls or hot reloads |
| Unchecked hosting/source edge cases | Canonical alias binding, explicit pending production, exact UTF-8 reads and durable status retry checks | Keep deployment/source identity and failures accurate during integration |
| Restoration intent with unfinished analysis state | Complete captured restoration can become ready without model or repair credit | Permit the separate checked restoration path under the existing lifecycle rules |

## Recorded live analysis

The [live analysis export](../data/evidence/remote1/live-analysis.json) is a real provider run over the frozen fictional miniature. Its labels/checks are model results; its source content and commercial scenario are synthetic. It is not a fixture-provider run or a production repair score.

| Field | Recorded value |
|---|---|
| Run ID | `07c47d90-b32a-45cf-9b33-97571ca7819c` |
| Launch attempt | `32907448-eec5-43d9-8db1-20cbb47494cd`, active |
| Original persisted Confirm | `2026-10-03T21:34:32.675Z` |
| Results ready | `2026-10-03T21:35:03.838Z` |
| First complete sealed group / all results ready | **31,163 ms / 31,163 ms** |
| Assets / marked passages | **4 / 40**: two web assets including read-only pricing, two email assets; 20 passages per surface |
| Classification | **30 judgments + 10 lexical exclusions** account for all 40 captured passages |
| Semantic results among judged passages | 7 contradicting, 10 consistent, 5 valid exceptions, 5 unrelated, 3 insufficient context |
| Correction groups / checked eligible patches | **4 / 5** |
| Withheld correction / unresolved errors | **1 / 0** |
| Human approvals / reviewer events | **0 / 0** |
| Submission / candidate checks / deployment observations | **None / none / none** |
| Published / publicly verified corrections | **0 / 0** |

The source inventory is three editable assets containing 33 marked blocks plus canonical pricing containing seven. Pricing participates in scope/classification but receives no model patch. The seven semantic contradictions therefore include the canonical old price; six editable contradictions become five checked proposed edits and one explicitly withheld threshold claim.

| Complete group | Proposed checked edits | Eligible members |
|---|---|---|
| Starter monthly price to $40 | `Starter is $40 a month.` on the web page and onboarding email | 2 |
| Annual savings to 40% | `Save 40% on Starter with annual billing.` | 1 |
| Daily cost to $1.33 | `Starter costs about $1.33 a day.` | 1 |
| Monthly plan gap to $40 | `Team is only $40 a month more than Starter.` | 1 |

Each proposed web patch has seven applicable passing checks; the email patch additionally passes `tokens_kept`, for eight. The threshold has no deterministic safe target, no replacement and an explicit withholding reason. The eligible grandfathered email's identical Starter-price sentence is classified `valid_exception`; no patch targets that email. Historical, already-correct, unrelated and ambiguous passages remain outside the eligible edits. Public preservation after a correction merge still requires the later rendered verification.

The pinned configuration is direct Anthropic frontier `claude-sonnet-5-5` for judging and fixes, prompt `gate1-v2`, relevance threshold 0.2, label threshold 0.7, concurrency four and a 20,000 ms request timeout. Frontier confidence and probabilities remain unavailable. This fresh miniature result supplements the earlier qualification; it does not qualify Jev or a different model/configuration.

## Baseline and evidence boundaries

The [saved live baseline read](../data/evidence/remote1/live-baseline.json), observed at `2026-10-03T21:34:26.275Z`, records current enforcement availability and the pristine $30 public facts before this run was confirmed. The immutable baseline embedded in the run export is a separately timestamped observation; use the export's baseline hash for that attempt.

| Identity | Recorded value |
|---|---|
| Repository / base branch | Public `jcstotomas/mogs-demo` / `main` |
| Base and deployed commit | `e573c2608ce3fa54f51cab67594355448aa1059b` |
| Production deployment | `dpl_J4vVHRyNZC5QfB9BafiaaeurmzDJ` |
| Run baseline hash | `e12343f35c30eb126fbbdcd4f2ace9729c5123077377e8364c65d1c4a2cda7c3` |
| Inventory hash | `e2a7a3f6835759dadd8881f87f1eeeef73a88c7e62d2873647924d53e74e5605` |
| Before / desired fact versions | **1 ($30) / 2 ($40)**, stored separately |
| Before facts hash | `a0512f91ade4e8dfc3e73df89d2661eddcf409dbfb8cecf0f0ac71c987767664` |
| Desired facts hash | `d8d3572f382592e750561c2d8665f5673a0e80b630341abec6cf17e8cc41ca1d` |

[Remote 0's actual enforcement proof](../data/evidence/remote0/enforcement-pass.json) and [protection readback](../data/evidence/remote0/github-enforcement-current.json) bind the required candidate/preview contexts to App ID `5179329`, with strict current-base checks, administrators enforced and no bypass. Disposable audit PRs were closed unmerged and carry no correction or preview/publication credit. The first real correction PR has not been submitted.

The **31.163-second result covers only this miniature**. The required 22-asset timing gate, independent per-kind held-out repair gates, named-run production scoring and rehearsals remain pending. Evaluation preparation has zero eligible independent held-out representatives and supplies no accuracy, repair-success or workload claim. No active content, seed or sitemap expansion is recorded by these builder commits.

## Integrated checks and bounded review

The coordinator recorded the following checks for the integrated implementation:

| Check | Result |
|---|---|
| Full test suite | **160 / 160 passed** |
| Typecheck | Passed |
| Local application build with webpack | Passed after the route-wrapper fix |
| Focused versioned HTTP check after that fix | **8 / 8 passed** |
| Hosting/source adapter checks | **7 / 7 passed** |
| Restoration readiness checks | **5 / 5 passed** |

The first integrated build rejected the optional path-context argument re-exported by the parameterless baseline, facts and restoration routes. One-argument wrappers fixed the generated Next.js route types while preserving Node runtime, dynamic behavior and post-Confirm scheduling. The affected build then passed.

One bounded implementation review found and resolved canonical hosting-alias binding, pending production observation handling, lossy UTF-8 source acceptance, durable status replay and restoration readiness. The affected hosting/source and restoration tests passed. These are implementation checks, not evidence of a corrected preview, human merge or verified production repair.

## Browser evidence

The [fixture browser record](../data/evidence/remote1/console-fixtures.json) covers eight states at 1440 and 375 pixels: initial, collecting, sealed, withheld, failed submission, failed preview, merged failure and verified. These screens explicitly label synthetic identities/results and disable mutation controls. They are UI evidence only; the synthetic verified screen does not establish a verified live run.

The record shows no horizontal overflow, one h1/main, visible surface/check counts and original-before-proposed review order. At 320 pixels, keyboard checks expose the skip link, focus the main region and open the check disclosure; measured controls are 44 pixels high. Reduced-motion measurements report zero-duration transitions.

Sample screenshots: [sealed desktop](../data/evidence/remote1/console-sealed-1440.jpg), [sealed mobile](../data/evidence/remote1/console-sealed-375.jpg), [withheld](../data/evidence/remote1/console-withheld-375.jpg), [failed preview](../data/evidence/remote1/console-failedpreview-375.jpg), [keyboard at 320](../data/evidence/remote1/console-keyboard-320.jpg).

**Final integrated UI checks passed.** The original fixture screenshots predate the narrow contrast correction and remain saved as before evidence. Fresh [computed contrast](../data/evidence/remote1/integrated-contrast.json) covers all eight affected states: normal text minimum 4.55:1, no failing sampled text roles. The progress labels and reviewer counts were darkened only in the v2 console; its arrow now exceeds 3:1. The [live responsive record](../data/evidence/remote1/integrated-responsive.json) reports no overflow at 1440/375/320 and a 44px minimum button height. See [live desktop](../data/evidence/remote1/live-console-1440.png), [live mobile](../data/evidence/remote1/live-console-375.png) and [ready groups](../data/evidence/remote1/live-review-ready.png).

Native Chrome's menu visibly confirmed [200% zoom](../data/evidence/remote1/native-zoom-200-level.png); [populated current/proposed copy](../data/evidence/remote1/native-zoom-200-groups.png) reflowed and remained readable. Zoom was reset and its temporary tab closed. The in-app browser's zoom shortcuts had no effect, so no zoom claim is drawn from them. [Pointer feedback](../data/evidence/remote1/pointer-feedback.json) records an enabled, read-only refresh control changing its hover background. [Keyboard focus](../data/evidence/remote1/integrated-focus.json) records a visible 3px outline on the recovery reason input. Its border and focus colors exceed the 3:1 control threshold against their actual background. The current OS preference is reduced motion; pointer and keyboard controls have instant transitions. The unchanged press rule is restricted to fine pointers without reduced motion and excludes disabled/focus-visible controls; static guardrails test those gates. Browser viewport overrides were reset, and no live group was approved.

The [integrated check record](../data/evidence/remote1/integration-checks.json) also verifies restart resume of the same ready run, unchanged judgment/patch records during polling, invalid/cross-origin Confirm rejection, and the still-pristine public baseline. These checks complete the local implementation handoff, while Remote 1's human approval/publication path remains pending.

## Remaining Remote 1 decisions and gate

1. A person reviews and approves each of the four complete groups in the local console. Preserve the withheld threshold and protected email; approval alone does not publish.
2. Prepare and check the complete combined candidate, including all five approved edits and deterministic canonical facts. Submit one real correction PR, recording exact base/head/tree/bundle identities and retry evidence.
3. Observe and verify the exact candidate preview, including preserved blocks, email tokens/URLs, desired canonical pricing and fresh contextual judgments. Production remains a separate state.
4. A person makes the publication decision by merging through GitHub under the enforced required checks.
5. Observe the matching production deployment and verify every required rendered replacement and protected block. Record production evidence, elapsed intervals and any failed/pending outcome explicitly.

Only then can Remote 1 pass and the active corpus expand to 22 assets. Changed submitted candidates require abandonment and a fresh attempt; merged failures require observed deployment reconciliation. Earlier PRs, failures and restoration evidence remain preserved.
