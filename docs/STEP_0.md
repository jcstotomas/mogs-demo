# MOGS Step 0 baseline

Step 0 freezes the foundation for the build in `SPEC.md` and `BUILD_PLAN.md`. The fictional company name is MOGS throughout. Lanes A–D have not started.

## Provider decision

**Selected judge: frontier, using Anthropic directly with `claude-sonnet-5-5`.** The structured fix model is the same model. Confidence and probabilities are unavailable for frontier judgments and are serialized as null; these outputs are never represented as Jev scores.

Actual stage 1 results are saved in `data/provider-smoke.json`:

| Test | Jev `jev-1.13.0` | Frontier `claude-sonnet-5-5` |
|---|---|---|
| Direct Starter $30 monthly, new customers | Pass: contradicting; confidence 0.87; 255 ms | Pass: contradicting; 3,889 ms |
| Identical copy, explicitly eligible active pre-change monthly subscribers | Fail: insufficient_context after confidence 0.24; 251 ms | Pass: valid_exception; 6,197 ms |
| Annual savings 20% with computed target 40% | Fail: insufficient_context after confidence 0.40; 252 ms | Pass: contradicting; 4,413 ms |

The frontier structured fix produced `Starter is $40 a month.`. Its deterministic target, single-token edit, retained monthly qualifier, exact source/rendered round trip, pinned fact version, and fresh frontier consistency judgment passed. Fix plus rejudgment took 8,454 ms. The three cases within each adapter ran concurrently. The full smoke sequence completed in approximately 14.9 seconds.

Jev uses one transport: direct HTTP `POST https://api.typesafe.ai/v1/systemone` with `TYPESAFE_API_KEY`. Frontier uses `@ai-sdk/anthropic` with `ANTHROPIC_API_KEY`; no Gateway key is required. Available Anthropic model IDs were checked with its authenticated model-list API before selection. The user-provided keys remain in ignored `.env.local` and are never stored in fixtures or evidence.

`JUDGE_ADAPTER=frontier` is the runtime default and the committed environment example. The Jev adapter is retained for explicit future evaluation. Changing the adapter, model, questions, prompts, or thresholds requires a separately identified gate and evaluation. The recorded response model IDs match the configured versions. Stage 2 workload testing and the 90-second 22-asset gate remain pending.

## Frozen interfaces

- `lib/types.ts`: runtime schemas and derived TypeScript types for facts, pages/passages, runs/config/stats, judgments, patches/checks, groups, publications/verification, audit events, manifest and evaluation reports. Only web and email are enabled. All eight named checks are blocking; no override fields exist.
- `lib/contracts/api.ts`: exact confirm, polling, groups, edit/drop, approval and export schemas; common validation/missing/stale/busy/idempotency/provider/runtime errors. Export includes judgments. JSON examples live in `fixtures/api.json`.
- `lib/db.ts`: SQLite schema version 1 and typed persistence. It enforces foreign keys, same-run group/patch joins, one live run until reset, immutable fact/run identity, sealed membership, monotonic revisions, idempotency replay/conflict, and human action counts. Run/publication records retain recovery state and file snapshots. Live database defaults to `data/app.db`; databases and sidecars are ignored at every level under `data/`.
- `lib/assets/source.ts`: shared parser, renderer, DOM extraction and exact block replacement. Public signatures and grammar are frozen; A receives implementation ownership after dispatch. UTF-8/LF, explicit matching markers, one text line per block, unique lowercase IDs, literal Liquid/URLs, role-based HTML, and exact untouched-byte preservation.
- IDs are `assetId = surface + ':' + POSIX content-relative Markdown path` and `passageId = assetId + '#' + sourceId`. Example: `web:site/contract.md#starter-price`. Prefixes are `site/` for web and `email/` for email. IDs are independent of passage text.
- File and block hashes are SHA-256 over exact UTF-8 bytes. A separate metadata hash protects eligibility and audience. Context hashes include metadata, role, heading, and immediate before/after text. Controlled revision chains may revalidate changed neighboring text; changed metadata or original blocks are stale conflicts.
- `lib/corrections.ts`, `lib/runs/contracts.ts`, and `lib/publication/contracts.ts`: canonical correction keys, membership/hash/count checks, complete-scope sealing, valid run transitions, source revision acceptance and matching verification identity. A late asynchronous result must pass the current revision checks before persistence.
- `lib/providers/`: one judge interface, direct Jev transport, Anthropic structured judge/fix adapter, validated environment and model/timeouts. Actual generation does not occur in schema or fixture checks.
- `lib/facts/derive.ts`: integer-cent base prices, fixed seed/cutoff, immutable initial/confirmed snapshots and code-computed savings/per-day/gap values. `data/facts.json` is initial version 1; `fixtures/facts.confirmed.json` is explicit version 2. The live database initially contains only version 1.

Fixtures use three assets: one web fixture and the paired emails. They cover all five block roles, multiple corrections in one file, literal tokens/URLs, and identical text with distinct IDs. Their fabricated judgments and statuses are fixture data, not live performance evidence. Evaluation fixture has `status: fixture`; zero-over-zero metric placeholders are not evaluation results. No corpus template tuning or held-out test has occurred.

## Scripts and verification

Install the pinned dependencies with `npm ci`. Supported runtime is Node >=22.13; the verified runtime was Node 26.7.0 and npm 11.19.0. The lockfile pins the scaffold and SDK dependencies.

| Command | Step 0 result / purpose |
|---|---|
| `npm run fixtures` | Passed; generates matching record/API fixtures; existing live and seed facts are preserved |
| `npm run contracts` | Passed; validates all record/API fixtures and loads the schema with a temporary in-memory SQLite database; initializes live schema/facts |
| `npm test` | Passed: 13 contract tests, zero failures |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; only the root scaffold and not-found route exist |
| `npm run provider:smoke` | Passed stage 1 with frontier selected; writes redacted provider evidence |
| `npm run dev` | Starts the scaffold at localhost; no corpus or console routes are implemented yet |
| `npm run eval`, `npm run reset` | Explicit pending-phase entry points; exit nonzero with a clear message until D/A implement them |

Contract tests exercise computed facts, render/extract/replacement, duplicate/malformed/stale IDs, HTML escaping, full-scope sealing, all required checks, same-file revision chains, changed metadata, verification identity, cross-run database collisions, stale fact upserts, immutable timestamps/membership, one live run, idempotency replay, and human versus test action counts. No full demo or publication/recovery rehearsal has run.

## Handoff boundary

Step 0 provides executable source fixtures, database/schema, API DTOs, lifecycle/publication guard functions, and live provider adapters. The confirm/approve HTTP handlers, run engine, actual file publication/recovery coordinator, corpus routes/sitemap, console, reset implementation and evaluation engine are the next build phases. `CoordinatorServices` freezes those service signatures; it is not an implemented publishing service.

The coordinator must implement serialized mutation and durable recovery using these interfaces and tests while the dispatched lanes build their owned modules. Integrate the miniature three-asset loop first. Its canonical pricing route is outside its run count. Then build the required 20-web/two-email scope and apply the timing, protection, isolated evaluation, and three-rehearsal gates. Do not claim the full demo or the 90-second gate from this baseline.
