# Multichannel lab verification

Implementation evidence for the isolated local lab on October 3, 2026. Earlier results are retained below; the natural-language additions and final checks are recorded separately. This record does not advance any core Remote gate or establish live source editing/publication.

## Source and scope

- Core starting commit: `684ea40`.
- Approved plan committed in the isolated worktree: `b9d1679`.
- Branch: `codex/multichannel-lab`.
- Owned implementation: `experiments/multichannel-lab/**`.
- Frozen synthetic corpus: four HTML emails, four PDF decks, four static creatives; 65 expected claim occurrences and 18 deterministic repair expectations.
- Corpus manifest SHA-256: `1d48d9a5c3a1307caead6a3a461dce352fcdc04a3ab31d40ef81266abf845e10`.
- Default facts SHA-256: `2cdaf412beee8802e09f9dc358e7792e78ed80421381844fd56b6b72fb206fe1`. Canonical copied fact origins and exact hashes are in `../fixtures/facts/provenance.json`.

## Executed checks

| Check | Result and boundary |
|---|---|
| Lab build | Passed typecheck and existing CSS source guardrails. |
| Automated tests | 42 passed, zero failed. Includes actual HTML/PDF/image extraction, PDF rendering, real Tesseract OCR, immutable facts parity, conditional and eligibility scope, exact replacements, storage isolation, flag-off requests, source freshness, preview tampering, restart, and cancelled late extraction. |
| Final corpus run | `lab_e533c659-6cf9-4387-887b-550b9e7afadc`: 12 assets, 112 extracted units accounted for, 65/65 expected outcomes, zero unexpected suggestions on unlabelled units. |
| Coverage state | Intentionally `partial`: image OCR cannot establish complete visual coverage, emails include omitted image/conditional regions, and ambiguous claims remain unresolved. A passing fixture expectation does not remove these warnings. |
| Native source preservation | Originals are retained unchanged; proposals are JSON text suggestions and source overlays. Tests block changed originals and altered previews. |
| External actions at the initial extraction milestone | No model API calls, email sending, source writes, repository submission, or deployment at that milestone. Later agent verification used live model calls as recorded below. |

The final run's 17 ms measures only the deterministic analysis stage after extraction; it is not import/OCR latency or a core demo timing result. PDF/OCR tests exercise the real local tools. This synthetic corpus is not a customer accuracy benchmark, and the explicit rules do not establish broad semantic understanding.

## Retained failures and repairs

The initial evaluation `lab_fd6eb18f-5763-4a3c-98f3-7f545209eead` scored 59/65. Two failures came from the evaluator matching repeated email body text to preheader units before the field-specific expectation. Four came from OCR omitting a terminal period. The evaluator now joins metadata fields separately and, for OCR matching only, normalizes whitespace and terminal sentence punctuation. Reports preserve raw expected/observed text, exact-match flags, and exact correction assertions. The fixture bytes and labels were unchanged. Intermediate successful run `lab_6553ce3f-001d-4a6a-a96d-323a2ccb542b` remains recorded with its earlier fact snapshot.

The independent integration review found two additional issues: cancelled extraction could write late durable previews, and preview bytes lacked a separate integrity check. Extraction now runs in disposable scratch space and commits previews only while active; stored previews receive hashes checked on read. Both fixes have passing regression tests. The coordinator also corrected the lab's initial cutoff to the immutable canonical fact fixture and added parity checks.

## Browser evidence

Browser evidence is saved under `browser/`; its report lists observed states, viewport sizes, input checks, and any limitations. Screenshots and fixture reports belong to this experimental lab only. Source location checks include an email occurrence, PDF page boxes, and image OCR regions.

The CLI browser sanity check on the final local server confirmed meaningful content, no error overlay, no horizontal overflow at its desktop viewport, and the import/scan/review/export controls. A separate UI review covers the required desktop/mobile states and modality checks.

## Remaining scope

L4 embeddings/retrieval comparison and L5 main-application integration remain deferred. Native decks/design layers, live source connectors, semantic model checking, edited file generation, publication and sending are not implemented. Unknown wording and incomplete extraction stay visible and withheld. Local review capability and its synthetic tests do not satisfy the core deployed demo's acceptance gates.

## Natural-language agent and launch compatibility

The user requested actual agent orchestration in place of the numeric form and compatibility with the launch correction system. The lab now uses the AI SDK ToolLoopAgent with lab-specific Anthropic configuration and a bounded task queue. Its pricing checker remains a separate deterministic full scanner; the model chooses tools and interprets requests. No publication tool is exposed.

Executed checks after the change:

- Integrated build and **63 automated tests passed** before the final UI review. Tests include actual SDK tool orchestration with a mock model, clarification, scope/price evidence, source freshness, cancellation, restart, input/output/step limits, HTTP availability/export, and core handoff boundaries. Mocked SDK tests are not live model evidence.
- Real provider task `task_71ec98e7-9d0b-4cdc-a87d-e997ebf6921b` completed using `claude-sonnet-5-5`: listed assets, read facts, and ran the scanner over all 12 assets and 112 units. Run `lab_fc89a979-18ce-4eca-ad6b-4179780dadc3` returned 18 suggestions and 18 unresolved items with partial coverage. Reported usage: 10,580 input tokens and 1,007 output tokens across the task.
- Real provider task `task_27362616-88a4-4a3f-899f-1fefc7d1c34e` asked for the missing monthly price without starting a scan. Reply `40` in task `task_2c608db9-7739-4c09-9eff-5b1ee7f4b50a` retained the email-only request and scanned exactly four emails, 44 units, eight suggestions, six unresolved. All live evidence files are synthetic-corpus tasks. Reported token usage is retained; dollar billing was not independently observed.
- `verify:launch` loaded the actual current core v2 schemas, canonical facts, hash function, and RemoteCoordinator. It created/replayed a fixture run in a temporary database, carrying only the three core fixture assets, no lab patches, and no approvals/submission. It rejected incompatible $45 facts. The evidence binds the core commit and relevant file hashes. This is compatibility proof, not a live launch or deployment.
- Protected-copy review found and fixed a flattened email context bug plus unsupported currency/billing/unit suffixes. Versions advanced to extractor v2 and checker v2. Frozen fixture bytes stayed unchanged. Run `lab_ce04b98e-2b42-4266-8d09-b43d49f5a195` passed **65/65**, 12 assets and 112 units, with partial coverage retained.
- Export now includes an immutable source manifest with filename, original hash, audience context, located units, extraction version, preview hashes and coverage warnings; old runs without a manifest require a fresh scan. Cancellation/failed terminal paths recompute counts from retained findings. Named compatibility attempts preserve success/failure evidence.

The handoff adapter prepares the existing `/api/v2/facts` request only. It requires matching canonical facts, observed baseline identity, no active core run and available merge checks. The main console remains unchanged, and enabling a live integration remains L5 work. Group approval, checked PR submission, human GitHub merge, deployment observation and rendered verification stay owned by the launch system.

## Final handoff boundary

Implementation file hashes are in `implementation-files.json`; final frontend states and request wiring are in `browser/README.md`. The final backend/type/UI build passed with 63 automated tests; the final UI-only interaction fixes also passed syntax and UI checks. Additional live browser model calls were blocked by automatic approval review over transmission authorization. Three earlier successful live API tasks, actual saved result rendering, and strictly local browser fixture submissions remain distinct evidence. No additional provider transfer was attempted after that block.

The package remains in `/Users/jeremy/.codex/worktrees/multichannel-lab/project_hack` on `codex/multichannel-lab`, outside the primary checkout and its compiler/corpus paths. Runtime databases, imports, previews, and the private environment are ignored. The running local preview is `http://127.0.0.1:3212`; this lab makes no production app changes. Owned source is the lab package plus the coordinator plan update. L4 retrieval and L5 activation in the main console are deferred.
