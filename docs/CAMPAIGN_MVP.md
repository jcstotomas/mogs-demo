# Integrated campaign MVP

The October 3 user instruction prioritizes a demo and minimum viable development checks. The coordinator imported the implemented multichannel package from `codex/multichannel-lab` at `b3e9404` and revised the integration sequence in SPEC/BUILD_PLAN. This is a local MVP; broader release acceptance remains deferred.

## Open and demo

Open [campaign review](http://localhost:3110/console/campaign). The app is running from `.next/campaign-demo`; `npm run demo:build` and `npm run demo` reproduce it. The original website review on port 3107 remains available.

1. Show the six imported sources: two designed emails, one five-slide PDF deck, and three creatives. A fresh library can use **Load designed campaign**; the current library is already loaded.
2. Say: “Raise Starter to $40 a month for new customers, preserve legacy pricing, and check all imported assets.” Choose **Ask MOGS**, or show the saved completed request to avoid model waiting on stage.
3. Select **A little more room to grow**, then its first **Show source location** action. The original creative highlights “Save 20%”; the checked suggestion says “Save 40%.”
4. Show the welcome email’s $30→$40 correction and the eligible subscriber email’s preserved $30 claim. The source files remain unchanged.
5. Select the deck and an annual-savings finding. The actual PDF page 4 and highlighted region appear beside its proposed copy.
6. Choose **Continue website review** for the existing 37 checked repairs and four complete approval groups. Human group approval, one correction PR, verified preview, human merge and public verification remain the existing publication sequence.

The core workflow covers 22 website/email assets. The six imports have their own counts and reports. Their suggestions do not enter the core Git candidate. Imported email activation/sending, deck/creative editing, bulk libraries, connectors and incoming-PR analysis remain future work.

## Observed result

- Core run `097e9332-aa63-428c-8c81-5e2b462a69bf`: 22 assets, 110 passages, 37 checked repairs, four groups, zero approvals. Its stored run/evidence rows retain the exact pre-integration hash.
- New agent task `task_d0e05a9b-7e61-4d9b-a558-4a9f0a186060`, model `claude-sonnet-5-5`, completed using actual tools and provider calls; reported usage was 9,903 input and 732 output tokens.
- New audit `lab_224f315f-8b43-41a4-8ba1-964a8577d3a3`: six assets, 123 extracted/checked blocks, eight suggestions with passing checks, five unresolved items. Status is **partial**, with explicit OCR/visual omissions. No proposed replacements on protected or unresolved-context findings.
- All six original source hashes match the frozen campaign manifest. Export records `publication: none`.
- The campaign and saved launch before/desired fact copies match. The lab’s deterministic pricing checker remains distinct from the core model pipeline; the natural-language layer orchestrates the lab tools.

## Focused verification

Root `npm run typecheck`, `npm run demo:build`, and `npm run campaign:check` passed. The first typecheck found a ProcessEnv declaration mismatch; the allowlisted child environment was fixed and the affected check passed. The app build includes the static UI check. Dynamic filesystem tracing warnings remain non-blocking; inspection of 33 app trace files found zero lab or credential files.

One bridge check verifies flag-off isolation, local request restrictions, bounded forwarding, actual import/check/export and sandboxed preview. One browser walkthrough covers the live request and email/deck/creative locations, desktop 1440px, mobile 375px, no horizontal overflow and visible 3px keyboard focus. No broad suite, parser evaluation, core provider rerun or recovery drill was added. Existing lab evidence is retained as prior evidence.

| Before | After | Why |
|---|---|---|
| Campaign assets and agent lived in a separate worktree/app. | Main campaign workspace serves the actual lab review through a local bridge. | One entry point for the demo. |
| The added assets were absent from the main codebase. | Six designed sources, real extraction and saved findings are available locally. | Show the consequences across formats. |
| Corrections followed many unrelated source blocks. | Checked corrections and unresolved items appear first; all blocks/counts remain. | Reach the useful decision quickly. |

## Boundaries and implementation

`MOGS_MULTICHANNEL_ENABLED` defaults off. The explicit `demo` launcher enables it. Disabled campaign routes return 404 before process startup/body consumption/storage access. The lazy loopback child receives an allowlisted environment with only the model credential; launch/GitHub/deployment credentials and core state remain outside it. It uses named storage `main-campaign-demo` under the lab’s ignored `.runtime/`. Source previews remain inert and sandboxed.

Root TypeScript and output tracing exclude `experiments/**`; the lab retains its own package/typecheck. No shared launch schema, source inventory, facts, approvals or publication contract changed. Core context is read through a read-only SQLite connection without runtime recovery or model initialization. No public deployment was changed by this integration.

Evidence: [checkpoint](../data/evidence/campaign-integration/before.json), [fresh result](../data/evidence/campaign-integration/happy-path.json), [agent](../data/evidence/campaign-integration/live-agent.json), [immutable report](../data/evidence/campaign-integration/report.json), [bridge check](../data/evidence/campaign-integration/bridge-check.json), [browser measurements](ui/campaign-integration/browser-checks.json).

Screenshots: [workspace desktop](ui/campaign-integration/workspace-desktop.png), [workspace mobile](ui/campaign-integration/workspace-mobile.png), [email desktop](ui/campaign-integration/email-highlight-desktop.png), [email mobile](ui/campaign-integration/email-highlight-mobile.png), [deck page 4](ui/campaign-integration/deck-highlight-desktop.png), [creative](ui/campaign-integration/creative-highlight-desktop.png).
