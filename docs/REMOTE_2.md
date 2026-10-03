# Required 22-asset demo build

## Built and frozen

- Exactly 20 web assets including canonical pricing, plus two email previews. Nineteen web sources and both emails are editable; pricing follows canonical facts.
- 110 rendered passages, including 103 editable blocks. The generous lexical filter selects 91 passages; 19 are recorded exclusions.
- The source rubric contains 40 contradictions: 37 deterministic repair assertions and three thresholds requiring withholding. Other labels include consistent, eligible/historical exceptions, unrelated copy and ambiguous scope.
- Five independent held-out representatives per deterministic repair kind are frozen before provider calls. Label splits and representatives are preparation; evaluation scores remain deferred.
- Original miniature source bytes, seed, labels and API fixtures remain available under `fixtures/remote/miniature/` and `fixtures/remote/coverage-miniature.json`.

Source corpus commit: `89f4ba3fe71619bca6a3faa1e0b5a54f15520204`. Corpus hash: `22072aae8d911d414640982cfa59b86fcbf210c5c9854500157d3c595337d4a2`.

## Implementation

- Public artifact/source readers validate either the exact miniature inventory or the exact required inventory. All 22 routes carry source/fact/deployment identities; static pages expose no console, APIs, credentials or database.
- After full-scope classification, the pipeline completes smaller correction groups first. Each group seals only after its entire member set has terminal drafting/check outcomes. Original timing and prior approvals persist; later failures block readiness and further approval.
- Direct-price classification requires plan and interval support in the passage or nearest heading. Facts and neighboring offers cannot fill missing scope.
- Pricing inequalities such as “less than $35” resolve to thresholds without a deterministic replacement. Removing an inequality also fails qualifier preservation checks.
- `scripts/required-analysis.ts` reads the exact built source revision, crawls the local static target and runs the real provider against an isolated database/capture. It never approves groups or submits a PR.
- `/console/remote?recording=required-22` loads the saved real-provider analysis. It displays local evidence and disables approval/publication actions. The original live miniature remains on port 3104.

## Public seed handoff

[Seed setup PR #7](https://github.com/jcstotomas/mogs-demo/pull/7) prepares the pristine $30 corpus and includes the approved public design. It is separate from a correction PR and has zero repair or human group approval credit.

- Base: human-merged miniature `308d64631320acf022ceef9620eb161369305c2f`.
- Seed candidate: `38418a55b71f111e9310c28487fe699dc03c1d60`.
- [Public preview](https://mogs-demo-pngdru8o8-jcstotomas-projects.vercel.app), Ready deployment `dpl_7cxWABjfnGV4z8VK6vqt6UoS9VJj`.
- Anonymous readback resolved all 22 assets/110 passages against exact Git source, source IDs and hashes, frozen rubric, canonical initial facts and 22 sitemap paths. Private routes returned 404.
- Both required trusted App statuses passed for this seed setup. Main remained at the verified miniature throughout preparation.

A person must merge this setup PR. After the matching production seed is observed, open the live v2 console on port 3107, Confirm a new correction attempt, approve the four complete groups, review the correction PR/preview and make a separate human merge. Publication checks remain mandatory.

## Provider runs and concrete fixes

All three records are preserved under `data/evidence/remote2/`:

| Run | First group | All ready | Outcome |
|---|---:|---:|---|
| `7582a348-2d31-406b-8ccc-bd322ca4e97e` | 66.889s | 120.702s | No provider errors; correctness failed because an unnamed offer received an automatic replacement. |
| `cdef77bb-30ea-4a70-9566-c9aee19df8cf` | 67.991s | 116.885s | Unnamed offer protected; correctness failed because a misclassified threshold lost “less than” and passed the incomplete qualifier check. |
| `753e13a0-e6a2-4276-8701-8ab23009b6b5` | 68.979s | 112.594s | 91/91 candidates judged; all 37 expected repairs drafted with passing checks, all three required thresholds withheld, zero protected/ambiguous replacements and zero provider errors. |

These are local real-provider analysis timings. They do not pass the deployed Remote 2 gate. The original corpus/labels were preserved while correcting these runtime defects.

The final run used source `11221354d99aaac170ebd9475a707a04abfebbca` and runtime `e5beda089b6e61d6dd9b613670e55fb590d3c8c5`. The existing frontier adapter/model (`claude-sonnet-5-5`), concurrency 4 and provider configuration were unchanged. Frontier confidence remains unavailable. Four complete groups contain 9 plan-gap, 9 annual-savings, 9 daily-cost and 10 direct-price repairs. Seven items were withheld in total; the three required threshold cases are among them. A [focused readback](../data/evidence/remote2/local-analysis-safety-readback.json) compared the final replacements with the frozen expected text and verified zero human approvals, submissions or deployment observations. This is a local output check; broad evaluation is deferred.

## Demo UI walkthrough

| Before | After | Why |
|---|---|---|
| The miniature review showed four assets and five repairs. | The saved local provider recording shows 22 assets, 110 passages and 37 checked proposals across four groups. | Make the expanded scope reviewable while retaining the miniature's live evidence. |
| The live console offers human approval and submission actions for a real attempt. | The local recording labels its evidence and disables Confirm, approval, submission and deployment actions. | Prevent local analysis from receiving human or publication credit. |

One walkthrough covered the changed public page and populated console at desktop 1440px and mobile 375px widths. Both views had one main heading, no horizontal overflow and visible keyboard focus; publication controls in the recording were disabled with explanations. No new animation or shared styling was introduced. Captures: [site desktop](../data/evidence/remote2/full-site-desktop.png), [site mobile](../data/evidence/remote2/full-site-mobile.png), [review desktop](../data/evidence/remote2/full-review-desktop.png), [groups desktop](../data/evidence/remote2/full-review-groups-desktop.png), [groups mobile](../data/evidence/remote2/full-review-groups-mobile.png), and [seed PR handoff](../data/evidence/remote2/seed-pr-handoff.png).

## Checks and remaining acceptance

Typecheck, coordinator/public builds, UI source checks and focused artifact, corpus/preparation, complete-group and scope/qualifier regressions passed. The changed site/review views passed the single desktop/mobile, focus and overflow walkthrough. Unchanged UI evidence was reused. No broad suite, scoring run, recovery drill or rehearsal was added.

Coordinator build commands were `npm run typecheck`, `MOGS_BUILD_DIR=.next/full-review npm run build`, and `npm run public:build`. The artifact checks ran the existing miniature and new full-scope files (six assertions). Builder handoffs record focused corpus/preparation checks and twelve complete-group pipeline checks; the two concrete scope/qualifier regressions were rerun after the live failures. The final immutable run and seed readback records preserve their exact counts and identities.

Pending: actual seed merge/production observation, complete deployed correction with human approvals and correction merge, deployed 90/180 timing, production repair scoring, full evaluation, recovery drills and rehearsals. No fixture/local result supplies those gates. The 200-asset benchmark remains deferred.
