# Multichannel lab frontend verification

Checked October 3, 2026. Final UI source hashes are recorded in `ui-source-hashes.json`. This evidence is local and synthetic; it does not satisfy a core launch or publication gate.

## Delivered interface

The primary workflow is a natural-language task composer with example prompts, explicit Anthropic processing disclosure, model availability, actual recorded tool events, clarification replies, task history, and links to the task's exact analysis run. The numerical price form was removed. Approved pricing facts remain in a read-only disclosure. Imported HTML, PDF and image review, context, extraction warnings, five outcome labels, source locators, original previews, and report export remain available.

Agent replies use safe text nodes with limited bold/code-marker formatting; imported content and model text never enter `innerHTML`. Email previews remain sandboxed. Source original bytes are not modified by UI actions.

## Current executable and browser checks

- `node --check public/app.js`: passed.
- `npm run ui:check`: passed against existing UI guardrails with the reviewed lab font-root mapping.
- Chromium via cached agent-browser, isolated `mogs-lab-ui` session, server `http://127.0.0.1:3212`.
- Current page loads and browser console/page-error checks returned no errors.
- Actual previously completed provider task `task_71ec98e7-9d0b-4cdc-a87d-e997ebf6921b` and run `lab_fc89a979-18ce-4eca-ad6b-4179780dadc3` render real saved full-corpus results: 12 assets, 112 checked blocks, 18 suggestions, 18 unresolved; status partial.
- Actual saved clarification `task_27362616-88a4-4a3f-899f-1fefc7d1c34e` renders the missing-price question and changes composer controls to “Your reply” / “Send reply.” Its saved follow-up task is `task_2c608db9-7739-4c09-9eff-5b1ee7f4b50a`.
- Initial load of the email-only task selects an in-scope email with findings (Offer comparison, 8 findings), rather than showing an unrelated creative with zero findings.
- Selecting the full-corpus task, browsing another run, then activating “Review the findings” restores the exact full-corpus task run.
- Current new-customer email selection renders 13 findings and an iframe URL bound to the selected asset/unit with `#mogs-selected-unit`.
- Current natural-language layout: measured scroll width equals viewport width at 1440, 375, and 320px. No horizontal document overflow. Desktop/mobile screenshots are included.
- Keyboard: Tab reaches the home link with a visible 3px solid focus outline; activating the skip link places focus on `#review`.
- Reduced motion emulated: media query true, zero active animations, zero elements with nonzero transition durations or animation names.
- Source-location behavior for email occurrence, repeated PDF page-2 occurrence, and creative OCR region was verified before the composer change and preserved under `pre-agent/`. Current email source review was rechecked. Underlying backend changes and fixture evidence are reported by the coordinator separately.

## Local fixture submission proof

`mock-ui-server.mjs` is an isolated local-only server on port 3214. It imports no provider SDK or application service, does not proxy requests, and returns visibly labelled fixture responses. It used a copy of the observed synthetic source state. The server was stopped after verification.

`mock-ui-submissions.json` records the actual browser POSTs:

1. A natural-language initial request with all 12 selected asset IDs.
2. A keyboard-submitted clarification with exactly `{"message":"40","previousTaskId":"task_fixture_question"}`, retaining original scope rather than attaching a changed selection.

Assertions passed. The UI rendered both turns and linked the returned run. This establishes frontend request wiring only; it is separate from the coordinator's three successful live provider API tests. `observed-existing-agent-state.json` is the read-only snapshot used for inspection; `synthetic-scope-proof.json` proves every active source byte hash and normalized context hash matched the twelve generated fixtures.

The final submit handler also retains an accepted task before refreshing state, preserves input if refresh fails, and distinguishes acceptance from submission failure, avoiding a false claim that an already accepted request never started. This last defensive branch received source/syntax checks, not an injected refresh-failure browser test.

## Evidence limits

Two attempts to authorize an additional live browser submission were rejected by automatic approval review. The stated reason was transmission of selected content to Anthropic without explicit payload/destination authorization; the review did not accept the agent-generated synthetic-only proof. No further model submission was attempted. Existing real task records and strictly local fixture responses were used instead. Fresh browser-to-provider submission and live clarification completion are therefore not claimed here; live provider behavior is established only by the coordinator's separate API evidence.

Model-unavailable, parser-failure and stale visual states received the additional strictly local fixture pass below; the flag-disabled404 used the actual server. All-source semantic coverage, native editing, sending, activation, deployment, and public verification remain outside this lab evidence. A prior CUA export-download wait stalled and was interrupted; browser download completion is not claimed. The coordinator verified export over HTTP.

## UI review

| Before | After | Why |
|---|---|---|
| Monthly price number field was the primary action | A request composer accepts the desired change and scope in natural language | Let the agent select tools and request missing context |
| A run appeared without an explanation of agent actions | Saved tool events, reply, task status and model evidence accompany results | Tie activity claims to actual recorded actions |
| Missing input required revisiting the form | A clarification becomes a reply in the same task chain | Preserve the user's request and original scope |
| A task run could leave an out-of-scope asset selected | Task completion and history select a valid source; its review link restores its run | Keep displayed findings attached to the request |
| Provider processing was implicit | Composer explains Anthropic request interpretation and possible source excerpts | Make processing visible before the user submits |
| Accepted requests could be misreported after a refresh error | Accepted task is retained and refresh failure is distinct | Prevent misleading retry behavior |

No animation was added. Source and review changes are immediate. Previous numeric-workflow screenshots are explicitly labelled historical under `pre-agent/`; they are not the final task-composer evidence.

## Additional bounded visual-state pass

`visual-fixture-server.mjs` served clearly labelled local-only states on port3214. It imports no provider code, forwards no requests and rejects writes. These screenshots verify UI rendering only, not fresh provider/parser failures. No model request was made.

- **Model unavailable:** `model-unavailable-fixture-1440.png`. Provider-unavailable reason and configuration help are visible; both composer textarea and submit button are disabled. Existing source review remains available.
- **Parser failure:** `parser-failure-fixture-1440.png`. Asset extraction failure, failed run, one accounted asset, zero checked blocks, explicit parser-error message and no-source-findings explanation are visible. A parser failure does not appear as a successful empty audit.
- **Stale report:** `stale-report-fixture-1440.png`. The run displays the stale-report warning and its suggestions read “Previously suggested · stale.” Export remains available, linked to the historical run ID. The warning explicitly retains earlier suggestions as evidence and requires a new check. The fixture does not implement downloads; export content remains covered by coordinator HTTP tests, not this screenshot.
- **Flag off:** `flag-disabled-404.png`. The actual lab server ran on port3215 with `MOGS_MULTICHANNEL_ENABLED=0`; the browser showed the disabled response, HTTP verification returned404, and `.runtime/disabled-ui-verification` was never created.
- **200% text scale:** root base font was doubled from16px to32px in the browser only (text scaling, not whole-page browser zoom). Document width still matched viewport at1440 and375px. Screenshots: `text-zoom-200-fixture-1440.png` and `text-zoom-200-fixture-375.png`.
- **Pointer hover:** browser matched `(hover: hover) and (pointer: fine)`. The enabled example-import button changed from `rgb(255,254,250)` to `rgb(228,233,221)` when hovered, with `:hover` true. No click or import request occurred.
- Browser page-error output was empty during this pass. Both temporary servers and the temporary browser session were stopped afterward.

No product source changes were needed in this additional pass, so the source hashes above remain current. Fresh live browser-to-provider submission, download-event completion, and the injected accepted-request refresh-error branch remain the evidence limits described above.
