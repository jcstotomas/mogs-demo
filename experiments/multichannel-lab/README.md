# MOGS multichannel lab

An isolated local experiment for auditing HTML email exports, PDF sales decks, and PNG/JPEG creative against the fictional MOGS pricing change. Import documents, describe the work in natural language, and let the agent inspect the inventory, read the pricing facts, ask about missing details, and run a source-linked audit. Inspect located findings and export an immutable JSON report. Original documents are never edited or published.

The natural-language agent uses an actual model tool loop. Its audit tool is backed by **conservative deterministic MOGS pricing rules**, not a general semantic claim checker. It supports explicit monthly-price, annual-savings, per-day, and plan-gap wording, preserves known exceptions, and withholds unsupported or ambiguous wording. Every extracted unit receives a decision; no embeddings, vector database, retrieval filtering, email sending, or native document write-back are used. The agent can send task text and bounded inspected excerpts to the configured Anthropic model; extraction and pricing checks remain local.

## Run locally

From this package directory:

```sh
npm ci
cp .env.example .env
# Add MOGS_LAB_ANTHROPIC_API_KEY to the ignored .env file.
npm start
```

Open [the lab](http://127.0.0.1:3210). Choose **Load designed campaign** to import two designed emails, a five-slide sales deck, and three photographic creatives, or upload a real supported file and fill in its context. Try “Raise Starter to $40 a month for new customers, preserve legacy pricing, and check all imported assets.” Select assets to constrain the agent, follow its recorded actions, inspect a finding beside its source, and export the report. Clear read-only requests run directly; ambiguous changes receive a follow-up question.

The flag defaults off. Only `MOGS_MULTICHANNEL_ENABLED=1` enables routes and work. `npm start` without it in the process environment or local `.env` serves a disabled 404 response and never opens a database or reads uploaded assets. Environment changes require restarting the server. Stop it with Ctrl+C; pending scans are cancelled, late extraction stays in disposable scratch space, and finished evidence is preserved.

Optional environment values:

| Variable | Meaning |
|---|---|
| `MOGS_LAB_ANTHROPIC_API_KEY` | Model credential in a lab-specific setting. Without it, imports and existing reports work, and the UI explains that the agent is unavailable. |
| `MOGS_LAB_MODEL` | Anthropic model ID; default `claude-sonnet-5-5`, verified against the provider model list. |
| `MOGS_LAB_PORT` | Local port, default 3210. Server binds only to 127.0.0.1. |
| `MOGS_LAB_STORAGE` | Storage name, default `default`; restricted to letters, numbers, underscores, and hyphens. Each name gets independent state under `.runtime/`. |
| `MOGS_LAB_PYTHON` | Python executable with `pdfplumber`, `pypdf`, and Pillow. Defaults to an available Codex bundled Python, then `python3`. |
| `MOGS_LAB_PDFTOPPM` | Poppler renderer executable, otherwise resolved from PATH. |
| `MOGS_LAB_TESSERACT` | Tesseract executable with English language data, otherwise resolved from PATH. |

Node 24 or newer with built-in SQLite and default [TypeScript stripping](https://nodejs.org/api/typescript.html) is required; this worktree was tested on Node 26.7. Tests and fixture generation also use Python `reportlab`. The Codex bundled runtime supplies the PDF/Python dependencies on this machine; Tesseract is installed locally. Missing tools return extraction failures rather than empty success. The server loads only its own optional `.env`; it does not read the launch app's environment or GitHub/deployment credentials. Keep the ignored file private.

## Storage and source evidence

Each named runtime has its own SQLite file, imported originals, generated previews, revisions, named run records, and durable agent tasks with tool events and reported token usage. These are ignored by Git. Asset revisions bind exact source bytes, normalized metadata, and extraction version. Content units retain their original extracted text, text/context hashes, and an exact DOM field, PDF page/box, or image region. Preview hashes are verified independently when served.

A new upload under the same filename replaces its active revision while retaining older assets and reports. Changed source or context makes earlier runs stale. Facts and engine identity are frozen into each run. The default facts map to copied immutable core fixtures documented in [fixture provenance](fixtures/facts/provenance.json); they do not read live launch state.

Email previews are inert reconstructions with original text locations. A strict allowlist preserves static inline formatting and bounded embedded PNG/JPEG/WebP images. Scripts, forms, external images, links, and tracking cannot execute. Email metadata follows the designed body; embedded image text remains outside extraction coverage. PDF previews are rendered from the actual imported bytes. Creative previews retain the original image with observed text boxes. Extracted words do not establish editable native slide objects or design layers.

## Agent boundaries

The agent has tools to list the selected inventory, read immutable pricing facts, inspect bounded source excerpts, request clarification, and launch one complete pricing audit per task. Source content is evidence, never permission to change the task. Agent actions are restricted to the selected current revisions. Facts other than Starter’s desired monthly price remain fixed. It cannot edit or publish source files. Tool events show actions and outcomes, not private reasoning.

Tasks have bounded model steps, generated output, excerpts, elapsed time, and concurrency. A restart retains interrupted task records; shutdown cancels pending work. Provider failures appear as failures rather than fabricated scan results. Missing model configuration does not silently switch to a pretend agent.

## Coverage and limitations

- Image OCR always reports partial coverage because unrecognized text and non-text visual claims may remain. Low-confidence regions withhold corrections.
- Scanned PDF pages, embedded imagery, vector artwork, unsupported font extraction, and unresolved template branches remain visible as coverage warnings.
- Subject, preheader, and plain-text variants are separate fields in the context form/API. Liquid tokens remain literal; the lab does not execute templates.
- Unknown eligibility, conflicting scope, unsupported phrasing, thresholds without safe copy, and complex pricing qualifiers remain unresolved or withheld.
- A passing suggestion means its supported text substitution passed the lab checks. It is not an edited asset, human approval, deployment, or publication.
- Limits: 10 MB per file, 30 PDF pages, 25 million image/rendered pixels, 1,000 units per asset, 100 stored revisions per named runtime, bounded extraction timeout, and one scan at a time. Over-limit and malformed inputs fail explicitly.

## Verify

```sh
npm run build
npm test
MOGS_MULTICHANNEL_ENABLED=1 npm run evaluate
MOGS_MULTICHANNEL_ENABLED=1 npm run evaluate:showcase
```

The build runs typechecking and the existing CSS guardrails copied into this package. Browser verification remains a separate requirement. Evaluation processes all 12 frozen fixture assets through actual HTML/PDF parsers and local Tesseract, then checks all 65 expected claim occurrences. Reports under `evidence/` retain failed and successful runs. Four OCR matches may differ only in terminal punctuation; the report preserves raw expected/observed text and exact-match flags. Labels, fixture bytes, source hashes, and deterministic replacement assertions stay fixed.

The separate [designed campaign](showcase/README.md) has its own frozen manifest and expected pricing occurrences. Its natural photographic imagery and unsupported standalone pricing remain explicitly partial or unresolved. `evaluate:showcase` never substitutes for the original 65-occurrence regression evaluation.

`npm run fixtures` regenerates synthetic artifacts only with the flag enabled; normal development should use the committed files. Changing a frozen fixture requires a new documented corpus and expected-result review.

See [verification evidence](evidence/VERIFICATION.md), [the lab plan](../../docs/MULTICHANNEL_PLAN.md), and [UI guardrails](../../docs/FRONTEND_UI.md). This package is integrated into the local main application through the opt-in `/console/campaign` bridge, copied from `b3e9404`. Its own Node process and `.runtime/` state remain separate. The coordinator recorded the user-approved early MVP sequence in the root plan. It supplies no evidence toward the core 22-asset release or the separate 200-asset benchmark.

## Launch correction compatibility

The natural-language layer can prepare the existing launch system's v2 Confirm request using `prepareLaunchHandoff`. It verifies the observed baseline hash and commit, unchanged canonical before/desired facts, no active launch run, merge-check readiness, and the fixed $30→$40 change. The output is a human-reviewable request proposal. It does not call the launch API or carry lab suggestions into its patch/approval records. Other lab target prices remain experiments and fail this handoff check.

The adapter was exercised against the **actual current core schemas and coordinator**, in a temporary fixture database. Reproduce that check with:

```sh
MOGS_MULTICHANNEL_ENABLED=1 MOGS_CORE_ROOT=/absolute/path/to/project_hack npm run verify:launch
```

Named success/failure evidence is preserved under `evidence/launch-compatibility-*.json`, including source hashes and the core commit for passing runs. A passing fixture check demonstrates contract compatibility, not a live launch or deployment. Human group approval, PR submission, GitHub merge, and rendered verification remain in the core system. The main application now exposes the opt-in campaign workspace. It reads the current core run without changing it and links to its existing human review; it does not invoke a new Confirm while that run is active.
