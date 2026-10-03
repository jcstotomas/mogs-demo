# MOGS Remote 0 checkpoint

**Historical status at foundation commit `4f3eff4`: the original combined Remote 0 did not pass; A–D were paused.** This record covers the coordinator foundation and public seed deployment on 2026-10-03. The required full scope remains 20 web pages including pricing plus two email previews. The deployed miniature contains three source assets (33 marked blocks) plus pricing (seven blocks).

## Current dispatch under the approved split

The revised [build plan](../BUILD_PLAN.md) separates Remote 0A local contracts from Remote 0B live enforcement. The committed types/database/API fixtures and passing local checks below qualify `4f3eff4` for Remote 0A. This reassessment reuses the recorded evidence; it does not claim a fresh runtime test or deployment. A/B/C may build against fixtures: A now includes corpus/evaluation preparation, B classification/corrections, and C console/review. The coordinator retains shared contracts/integration and completes Remote 0B in parallel.

The failed GitHub enforcement result remains unchanged and blocks real correction/restoration submission and publication. A disposable coordinator enforcement probe is gate evidence only. No builder dispatch, new PR or deployment was performed by this planning revision. Active corpus expansion waits for the successful Remote 1 miniature; the full 22-asset timing/evaluation/rehearsal requirements remain pending.

## Public baseline

| Identity | Observed value |
|---|---|
| Repository | Private `jcstotomas/mogs-demo`, connected account has administrator access |
| Remote `main` and deployed Git SHA | `e573c2608ce3fa54f51cab67594355448aa1059b` |
| Production site | [mogs-demo.vercel.app](https://mogs-demo.vercel.app) |
| Immutable deployment | [mogs-demo-pmrmogsx4-jcstotomas-projects.vercel.app](https://mogs-demo-pmrmogsx4-jcstotomas-projects.vercel.app) |
| Vercel project / team | `prj_hT55y9ozmq67qLkneP8csBNUuVTr` / `team_tTySQ8aRrx08Ma0X2AMFm40d` |
| Ready deployment | `dpl_J4vVHRyNZC5QfB9BafiaaeurmzDJ` |
| Public facts | Exact pristine seed bytes; Starter $30; normalized hash `a0512f91ade4e8dfc3e73df89d2661eddcf409dbfb8cecf0f0ac71c987767664` |
| Exact facts file hash | `d9e8c25d0f432ec21b3c80317203236d74518b65f3a88a8d44c1fd82dfe137ee` |
| Inventory hash | `e2a7a3f6835759dadd8881f87f1eeeef73a88c7e62d2873647924d53e74e5605` |

All four content routes return 200 on both the production and immutable origins. Independent coordinator readback compared every source ID, role, text, source body, metadata, and exact artifact/fact identity with the deployed commit. The sitemap contains exactly those four production URLs. Console/API routes, database, fact JSON, environment file, spec and generated artifact paths return 404. Source/build credentials and coordinator state are excluded from the static output.

The first deployment returned 404 for extensionless routes; `cleanUrls: true` fixed it. The original immutable URL required Vercel login and the sitemap linked there. After the human explicitly approved public previews, only the new MOGS project's deployment authentication was disabled; API readback and anonymous requests confirmed it. The production sitemap origin was then configured and redeployed. These failures and their resolutions remain in [deployment-audit.md](remote0/deployment-audit.md) and [public-deployment.json](remote0/public-deployment.json).

The coordinator readback is [public-readback.json](../data/evidence/remote0/public-readback.json). The deployment worker's earlier schema probe used an in-memory placeholder App ID; it did not persist a production attempt or prove App ownership. The independent readback does not need an App ID. **No real correction PR, approved candidate preview, human merge, or correction production verification is claimed.**

## Executable foundation

| Files | Implemented contract |
|---|---|
| `lib/runs/remote-types.ts`, `remote-db.ts`, `remote-service.ts` | Strict v2 records/requests, separate durable SQLite, immutable attempt facts, atomic Confirm/replay, target reservation, complete-scope sealing, revision-bound approvals, frozen 180,000 ms deadline, restoration and historical v1 archive |
| `lib/submission/candidate.ts`, `restoration.ts` | Whole mapped-source freshness, exact before-facts file hash, complete approved bundle, original eligible contradiction guard, same-file batching, paired checks and final combined-context rejudge; restoration has a separate seed intent and no repair credit |
| `lib/submission/github.ts`, `service.ts` | Exact durable images/checks before Git writes, deterministic objects/unique attempt commit, create-only branch, one marked PR, restart/lost-response recovery, App/bot source validation and immutable candidate SHA |
| `lib/submission/enforcement.ts`, `recovery.ts` | Success requires matching durable candidate or complete preview proof and live human approvals; raw protection settings cannot substitute for behavior probes. Abandon retires statuses/observes closure; unknown outcomes stay locked; atomic merge-race recording and explicit failed-deployment reconciliation |
| `lib/deployment/**`, `apps/public/**` | Pure committed artifact/pricing/provenance, static public build, complete rendered verification, fresh pinned provider rejudgment, actual recorded PR merge required for production, relevant export binding and trusted seed-revision reads. Live verification rejects injected fixture network/judge/seed/merge readers |
| `lib/metrics/coverage-contract.ts`, `fixtures/remote/**`, `lib/runs/remote-fixtures.ts` | Frozen API DTO/evidence fixture, stable inventory and representative registry, independent per-kind denominators, misses/errors retained, preview and production scoring kept distinct |
| `scripts/check-remote-contracts.ts`, `migrate-remote.ts`, `remote-audit.ts`, `check-public-deployment.ts`, `serve-public.ts`, package/config/environment example | Repeatable fixture, migration, safe configuration audit and public readback commands; isolated source checkout and static serving |
| `AGENTS.md`, `SPEC.md`, `BUILD_PLAN.md`, `README.md`, this evidence directory | Updated direction, coordinator ownership, frozen boundaries, gates, setup and truthful evidence limits |

Candidate combined checks are immutable beside their exact images and are included in v2 exports as `candidateChecks`. Before submission they are null. Fixture approvals/PRs/SHAs are labeled synthetic; test approval events are excluded from human counts. The coverage miniature has 33 featured rows and **zero independent held-out representatives**; its gate is `not_eligible`. [corpus-coverage.md](remote0/corpus-coverage.md) is a proposal for A's later expansion, not implemented 22-asset coverage.

Existing v1 unversioned handlers retain local publication behavior. Posting a v2 Confirm DTO to the live `/api/facts` returned HTTP 400 for the unsupported v2 fields. The v2 DTOs and services are executable; v2 HTTP/console wiring remains assigned to the later lanes. No A–D implementation was dispatched.

## Checks and evidence

| Check | Result |
|---|---|
| `npm test` | 95/95: 13 v1 contracts, seven v1 runtime, four public artifact/template, eight coverage, 19 Git/submission proof, 13 state, eight candidate/recovery, 14 deployment verification and nine UI guardrail tests |
| `npm run typecheck` | Passed |
| `npm run contracts` | Passed: 13 record fixtures, six API shapes/errors, source round trip, preflight and SQLite constraints |
| `npm run remote:check` | Passed fixture gate: four assets, 40 passages, 30 fabricated judgments, ten lexical exclusions, four complete groups/test approvals, three candidate files; no model calls or remote writes; held-out gate `not_eligible` |
| Public static build | Passed with exactly the four miniature asset routes; public output excludes console/API and coordinator runtime |
| `MOGS_BUILD_DIR=.next/remote0-check npm run build` | Passed. The local v1 application emits 13 dynamic-filesystem tracing warnings; it is not the deployed target. The public target is a separate static export |
| `npm run public:verify` | Passed anonymous full-content/provenance readback, four correct sitemap links and eight excluded paths |
| `npm run remote:migrate` | Passed: 105 raw v1 rows archived; before/after source/archive hashes match; zero active v2 attempts |
| `npm run remote:audit` | Expected exit 1: provider configuration matches validated evidence; three App configuration fields are missing |

The actual read-only v1 archive is [migration.json](../data/evidence/remote0/migration.json): two fact snapshots, one run, three pages, 33 passages, 24 judgments, four groups, six patches, five memberships, four publications, 18 review events and five idempotency records. The archive ID/source hashes are `9e414989fafbb914833fcd2c23f29e7b9ff7a14157770f806a16d9fb3e15f8da`. The original database and local published content remain intact.

Focused browser checks covered the real public pricing page at 1440, 375 and 320 pixels: no horizontal overflow, one h1/main, 14px body text, 44px standalone links/brand, visible keyboard skip-link focus, reduced motion with zero-duration link transitions. Onboarding navigation showed literal Liquid/URLs and the fictional email-preview label. Saved screenshots: [desktop](../data/evidence/remote0/deployed-pricing-desktop.jpg), [mobile](../data/evidence/remote0/deployed-pricing-mobile.jpg). A separate text-zoom check was not recorded.

| Before | After | Why |
|---|---|---|
| No isolated public target | Warm neutral, read-only fictional site and email previews | Show publicly served content while keeping the review worker local |
| Extensionless routes 404 | All four content routes 200 | Match the frozen inventory URLs |
| Protected preview links in sitemap | Public preview access approved; sitemap uses the production origin | Allow independent rendered readback |
| Existing console UI guardrails in the working tree | Preserved and included with their checker/tests/evidence | Keep the baseline reproducible without changing the approved v1 flow |

## Provider gate

Reused the validated direct Anthropic frontier configuration, `claude-sonnet-5-5`, prompt `gate1-v2`, relevance 0.2, label threshold 0.7, concurrency four and 20,000 ms request timeout. The current configuration exactly matches saved completed local run `ff57ceec-5f59-49e0-9a26-d9911b2fdd57`; no fresh billed calls were made for this checkpoint. The original Step 0 smoke passed direct price, eligible grandfathering, derived savings and structured checked fix with frontier. Jev passed direct price but failed eligible grandfathering and savings. Frontier confidence/probabilities remain unavailable; they are never represented as Jev scores. See [STEP_0.md](STEP_0.md), [GATE_1.md](GATE_1.md), and [config-audit.json](../data/evidence/remote0/config-audit.json).

## Recorded enforcement blockers and original next action

1. Configure the custom GitHub App installation token, App ID and slug in ignored `.env.local`: `MOGS_GITHUB_TOKEN`, `MOGS_STATUS_PRODUCER_APP_ID`, `MOGS_STATUS_PRODUCER_APP_SLUG`. Its permissions are contents, pull requests, commit statuses and administration write for this repository. The connected GitHub integration cannot administer branch protection.
2. Configure both required contexts bound to that App; require strict current-base checks, administrators/no bypass, no force push/deletion, no merge queue or automatic merge. The connected read currently reports `main.protected=false`, checks empty/enforcement off; protection detail read returns HTTP 403. [github-enforcement.json](../data/evidence/remote0/github-enforcement.json) records this failed gate. Private-repository enforcement availability has not been established; report any account limitation directly.
3. Prove real pending/failing/wrong-head rejection and successful current-head eligibility on a disposable probe PR, with the trusted producer and candidate-specific preview/deployment identities. Local fault tests and public seed observations cannot replace these checks.
4. Under the original combined gate, all dispatch waited for this evidence and D followed A. The approved split above supersedes that sequence: local builders may start at Remote 0A; commit passing Remote 0B evidence before the real Remote 1 submission. Remote 1 still exercises human complete-group approval and the actual correction PR/preview/merge/public path before asset expansion.

Local partial commits include public bootstrap `328ffb1` and routing fix `635eb2f`. The foundation checkpoint commit containing this record remains **local only**, and its hash is reported in the coordinator handoff. Primary local `main` and remote `main` have diverged: the remote seed has separate audit/trigger commits and the routing cherry-pick. The ignored `data/remote/source` checkout preserves the actual public Git baseline. Do not push primary `main` over it or deploy the repaired v1 working content. Dispatch authority now comes from the explicit Remote 0A qualification in the build plan; this record never establishes passing live enforcement.
