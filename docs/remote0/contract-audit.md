# Remote 0 contract and recovery audit

Status: coordinator support recommendations, not an executable contract freeze or a passing gate. Reviewed the current planning documents and v1 runtime at checkout `3fa841a` on 2026-10-03. No source or fixture changes, provider calls, remote mutations, or test executions were performed for this audit. The coordinator is implementing v2 in separate modules; exact exported names remain its decision.

## Existing boundaries to preserve

| Evidence in the current code | Consequence for v2 |
|---|---|
| `lib/db.ts:10–19`: facts use a global numeric primary key; both live-run indexes remain unique even after completion. | Do not insert repeated v2 rehearsals into these v1 identities. Scope new facts by attempt and phase/version, with a separate active-target reservation. |
| `lib/db.ts:69–71`: the opener rejects `user_version > 1` and reapplies v1 DDL on every open. | A shared-file schema-version bump breaks the v1 runtime; dropping its old indexes alone is also ineffective. Use a separate v2 database, or namespaced v2 tables and an independent migration ledger with explicitly compatible openers. Keep v1 history and replay behavior intact. |
| `lib/runs/service.ts:123–153`: facts read the mutable local file; confirmation writes that file; an existing change replays the latest run. | V2 reads observed deployment facts and writes desired state to its database only. It cannot reuse the v1 confirmation service. |
| `lib/runs/service.ts`, `approve`: approval immediately replaces local files, then verifies them. | Explicit API/service version dispatch is required. V2 approval records authorization only; there must be no fallback to the v1 publisher. |
| `lib/db.ts:95–104`: pages/passages/judgments can be upserted under a run; only selected identity fields are immutable. | V2's original source/fact snapshot must remain immutable. Store new observations or check attempts separately rather than replacing the captured baseline. |
| `lib/types.ts`: publication is group-bound and includes local before/after file images; review actions cover v1 operations. | A v2 submission is run-bound and includes multiple approved groups. Preserve the local publication payload rather than reinterpreting it as a PR or production deployment. |

If the v2 database is separate, preserve v1 records in place or import byte-preserved archival envelopes; do not silently normalize old payloads through stricter v2 schemas. New v2 uniqueness rules replace the old rules for v2 attempts, without needing to weaken the still-running v1 store.

## Minimal identity and record invariants

| Record | Required invariant |
|---|---|
| Target reservation | One durable active mutation owner per configured repository/base branch/public deployment target. Both launch attempts and seed-restoration operations acquire it transactionally. Crashes and unknown remote outcomes do not free it. |
| Launch attempt | Fresh `launchAttemptId` per rehearsal; fixed target, run ID, captured baseline observation, source commit, scope/inventory, configuration, and original confirmation time. Completed v1 records occupy no v2 slot. |
| Before/desired facts | Immutable snapshots referenced explicitly by attempt plus phase/version and exact serialized artifact hash. Never recover “before” through `desiredVersion - 1`. Numeric versions 1/2 may recur in another attempt. |
| Published facts | Append-only deployment observations containing actual deployment/commit/fact hashes. Confirm does not replace this observation with desired facts. Reconciliation records what is actually deployed even when it differs from the approved candidate. |
| Source snapshot | Original page/block/context/metadata bytes or hashes are keyed by run and stable IDs. The same passage ID in another run cannot provide a judgment, patch, approval, or verification for this one. |
| Group and approval | Approval pins run, desired facts, group revision, membership/eligible set, and the checked replacement/revision hashes. Store approval separately from group readiness. Checked edits/drops invalidate affected approval while retaining the old event. |
| Candidate | Immutable pinned base plus combined approved edits and deterministic `data/facts.json`. Its exact changed-path set, file hashes, tree hash, bundle hash, and candidate SHA belong to one submission operation. Preserve all unapproved and protected source bytes. |
| Submission journal | Persist operation ID, request fingerprint, candidate identity, deterministic owned branch, and expected remote effects before push or PR creation. Record each observed effect independently. A timeout means an unknown outcome until reconciliation. |
| Deployment observation | Bind environment, target/origin, provider deployment ID, candidate or actual merged SHA, source/fact hashes, rendered observations, and fresh verdicts. Preview and production have separate success records. |
| Idempotency record | Versioned operation namespace, target/attempt, key, canonical request fingerprint, original operation identity/response, and original timestamp. Same key/payload replays; changed payload conflicts. An old v1 key must not start a v2 launch. |
| Review event | Append-only actor/action/identity/timestamp. A retry, poll, or test approval adds no human action. Submission, abandonment, reconciliation, GitHub merge, and restoration remain distinguishable. |

Candidate commits need unique attempt identity, for example the `launchAttemptId` in the commit message. A new attempt must not reuse an abandoned candidate's SHA: posting successful required statuses on that SHA could otherwise revive the old PR's merge eligibility. Distinct branch names alone do not establish distinct commit-status identity.

## Minimal transitions and guards

Keep analysis, launch lifecycle, submission, and deployment observation orthogonal. The following names are proposed; the guards are the required behavior.

| Transition | Preconditions and durable effect |
|---|---|
| No active target → active launch | Verify base-branch head equals the observed production commit and source/fact inventory. In one transaction reserve target, create attempt/run, store before/desired snapshots and confirmation replay. Leave published source unchanged. |
| Collecting → classifying → drafting → ready | Each transition is monotonic and tied to the same run snapshot. Readiness requires the full scope and terminal results, with explicit withholding. Provider/extraction errors are operational failures, not semantic labels. |
| Any unfinished analysis → failed | Persist the error/deadline outcome; reject late results for readiness and counters. An expired run cannot become ready on a delayed callback. The launch slot remains held until explicit abandonment. |
| Collecting group → sealed | Complete full-scope classification and all potential member outcomes; at least one eligible patch, correct membership partition, and every applicable check pass for eligible members. Sealing alone is not approval. |
| Sealed → approved revision | Compare the displayed revision and complete checked member hashes. Record approval and idempotency together; write no source and create no PR. |
| Approved revision → invalidated approval | Before submission, a checked edit/drop increments affected revisions and records invalidation. Source, scope, or desired-fact changes require a new attempt instead. |
| Ready run/all eligible groups approved → preparing submission | Freeze all approved revisions and candidate intent. Build in an isolated checkout of the pinned base. A missing approval or stale/missing/failed member blocks the entire operation. |
| Preparing → prepared candidate | Combine all same-file edits first. Original-location checks use base bytes; preservation compares base/candidate; context and canonical facts use the final candidate. Freeze successful checks and candidate identity before remote writes. |
| Prepared → submitted | Reconcile or perform the journaled branch push/PR creation; persist the actual PR identity. Retry discovers the owned matching branch/PR instead of creating another. Unrecognized work is a conflict, never a force-push target. |
| Submitted → preview verified | Observe the matching candidate deployment and fresh rendered checks. Required statuses target that exact current head and approved evidence. A changed base/head invalidates readiness and requires abandonment/new attempt. |
| Preview verified → merge observed | Record a human GitHub merge and validate approved candidate path/tree identity, accounting for authorized merge/squash SHA differences. This observation never performs a merge. The accepted own merge is not treated as an unrelated base advance. |
| Merge observed → production verified → completed launch | Observe the actual merged commit's deployment and verify every required source/fact/protected/rendered observation and fresh verdict. Only then release the target reservation. |
| Unmerged attempt → abandoning → abandoned | Journal retirement, post and verify terminal failing required statuses for every known attempt head, close the unmerged PR if present, and confirm its identity/state. Release only after known retirement. Preserve the branch and audit. |
| Abandoning + merge observed | Do not report abandonment or undo deployment. Record the race and follow merged verification/reconciliation. Keep the slot until the resulting state is known. |
| Merged verification/deployment failure → reconciling → reconciled failure | Explicit reviewer action records the actual public commit/facts/hashes and preserves the failure. No content rollback or implicit seed restore. Release only after a coherent observed terminal state. |
| No active target → restoration operation | Reserve the same target, pin current base and frozen seed, create a separate restoration journal and unique candidate identity. Check exact seed bytes/preserved paths and the $30 preview using the required contexts. Human merge and verified production seed are required before release. |
| Any unknown remote outcome → blocked/recovering | Retain reservation and immutable intent. A retry or restart observes remote state before further mutation; no blind second PR, automatic merge, or reset. |

Do not represent a known failure as success merely to free the active slot. `failed` is an observation; `abandoned` or `reconciled_failure` is the explicit lifecycle resolution. Successful retry observations may follow earlier failed preview/verification attempts for the same unchanged candidate, but the earlier records remain intact.

## Meaningful failure-test matrix

Use isolated temporary databases/checkouts, a controllable clock, and deterministic fake Git/deployment adapters for contract tests. Assert persisted records and effect counts across a new coordinator instance, not only thrown errors. Real repository enforcement and actual deployment observations remain separate Remote 0 evidence gates.

| ID | Trigger | Required assertion |
|---|---|---|
| M1 | Open a populated v1 store before and after v2 initialization. | Historical payload/replay digests remain equal; v1 exports still open; no incompatible `user_version` change or unexpected migration replay. |
| M2 | Complete three fresh seeded launch attempts using versions 1/2 and the same seeded change ID. | Distinct attempt/run/snapshot identities; old records remain; exactly one active attempt per target at a time. |
| M3 | Two coordinators concurrently confirm different keys for the same target. | One reservation/attempt wins; the other gets a conflict. Same logical retry returns the original timestamp/run and adds no second effect. |
| F1 | Confirm against a matching remote baseline while local v1 facts already say $40. | Before facts come from the pinned $30 deployment/seed, desired facts are $40, and local/public source bytes are unchanged. |
| F2 | Reuse fact version or passage IDs from another run/attempt. | Cross-attempt references are rejected at storage/service boundaries; equal numeric versions or text do not satisfy ownership. |
| F3 | Change base head, deployed SHA, source bytes, or fact artifact between capture and submission. | Whole operation blocks; no candidate push/PR/status success and no silent baseline rewrite. |
| A1 | Complete one group before full classification, omit a member, or omit a required check. | Group cannot become approvable; timing fields do not falsely record success. |
| A2 | Approve, retry, then edit/drop one member before submission. | One original approval action; revision advance invalidates only affected approval; fresh approval is required; unrelated approved groups remain recorded. |
| A3 | Submit while one eligible group is unapproved or one approved member is stale. | No partial candidate/remote write; excluded/withheld items remain explicit and do not replace missing approval. |
| C1 | Two approved groups change neighboring blocks in one file. | One combined file image; rejudgment sees both final changes; base-original checks inspect base, not replaced text. |
| C2 | Fail the second staging write or a final combined-context check. | Base/public files remain identical, no remote side effects occur, and no partial staged tree becomes the recorded successful candidate. |
| C3 | Receive a draft/check after source/facts/revision change, abandonment, or the 180-second deadline. | Result cannot overwrite a newer revision, repopulate an expired run, reseal a group, or change successful counters. |
| S1 | Lose response after push or after PR creation; restart before persisting the returned identity. | Lookup recovers the matching recorded operation; exactly one owned branch/candidate/PR exists; request timestamp and identity remain unchanged. |
| S2 | Expected branch exists with an unrecognized SHA or more than one ambiguous PR matches. | Block with evidence; no force push, arbitrary selection, duplicate PR, or readiness success. |
| S3 | Same idempotency key is used with different group revision, bundle, target, or operation kind. | Conflict with zero extra side effects. Old v1 replay remains historical and cannot invoke v2 or vice versa. |
| D1 | Preview build succeeds for another SHA, has stale rendered bytes, or model recheck fails. | Preview remains unverified and its required context is non-success; a build-success flag is insufficient. |
| D2 | Merge SHA differs due to authorized squash/merge; then a deployment reports a different commit. | Approved merged path/tree identity is accepted, but only deployment of the actual recorded merged SHA can verify production. |
| R1 | Lose a terminal-status or PR-close response during abandonment; restart. | Slot remains held until required contexts are observably failing and PR is closed/unmerged; retry adds no duplicate review action. |
| R2 | Reopen abandoned PR; separately create a new attempt with identical source changes. | Old statuses remain failing and cannot be revived by late success callbacks or reused candidate SHA. New attempt uses separate immutable identity. |
| R3 | Human merge races abandonment/close. | Record actual merge; do not mark unmerged abandonment, release prematurely, or roll back. Follow production verification/reconciliation. |
| R4 | Merged deployment fails or serves unknown facts; request reconciliation. | Preserve failure and actual observations; unknown/mismatched observation remains blocked. Known public state can resolve failure without falsely reporting repair success. |
| R5 | Start restoration during an active launch, or launch during restoration; interrupt restoration after PR creation. | Shared reservation blocks the competing operation; restart recovers the same restoration PR; no launch metric receives restoration credit. |
| R6 | Restore seed through required checks, human merge and production observation. | Full content/fact seed hashes match; new launch gets fresh attempt/key identities; local reset alone cannot satisfy this test. |
| E1 | Poll repeatedly or use fixture/test approval while exporting action counts. | No extra human events; preview, production, submission and restoration results remain distinct and retain run/environment identity. |

M1–C3 exercise local executable contracts without a provider. S1–R6 require fake remote fault injection in the contract suite plus selected real remote proofs at the Remote 0 gate; a mocked status success cannot prove branch protection enforcement.

## Existing tests to retain and extend

- `tests/contracts.test.ts`: source round trip, same-file batching, malformed/stale source rejection, complete-group checks, controlled revisions, verification identity, cross-run foreign keys, immutable snapshots and idempotency.
- `tests/runtime.test.ts`: isolated v1 confirmation/approval, same-file sequential publications, protected email, external edits, partial write recovery, restart recovery and asynchronous preflight staleness.
- Keep the v1 “one live scenario until reset” test as historical v1 behavior. Add v2 repeated-attempt tests instead of weakening that test and relabeling the old runtime.
- Existing runtime fixtures intentionally read expected manifest labels through test dependencies. They prove orchestration and recovery only; they are not provider accuracy, held-out evaluation or deployed-publication evidence.

## Coordinator handoff

The highest-risk checks before freezing callers are: database compatibility, explicit v1/v2 API dispatch, run/attempt snapshot ownership, atomic target reservation, approval identity, immutable remote intent before network writes, terminal status retirement with unique commit identity, and restoration sharing the same target lock.

When the executable v2 types arrive, compare their constructors and persistence guards against these invariants. Do not infer passing service behavior from permissive TypeScript/Zod record shapes alone. Record which guards are implemented and tested, which have only fixtures, and which still block Remote 0 completion.

## Executable support handoff

Following the coordinator's later implementation assignment, `lib/runs/remote-db.ts` and `lib/runs/remote-service.ts` provide the separate v2 state boundary. `tests/remote-state.test.ts` currently has 13 passing local tests. These use isolated temporary databases and source fixtures; no live database was migrated or imported, and no provider or remote mutation was performed.

Implemented and exercised:

- Separate v2 database, including refusal of the v1 path, a symlink to it, or an existing non-v2 database. An online SQLite backup imports all v1 raw rows, schema definitions, and exact idempotency response strings into an immutable archive. V1 records, schema version, indexes and replay still open unchanged.
- Transactional reservation shared by correction/restoration. Two independent Node processes racing Confirm produce one active attempt. Confirmation rollback, restart replay, historical-key conflicts and three distinct rehearsals with recurring versions 1/2 are covered.
- Immutable before/desired facts and captured pages/passages; run/attempt ownership; full captured inventory coverage; valid prefilter exclusions; terminal deadline failure; completed analysis timing cannot be rewritten by later review updates.
- Approval records authorize inclusion only. Retries do not create another human action. A changed patch requires a newer revision, clears the affected approval and advances its group revision; submitted candidates reject edits.
- Restoration pins its seed revision, shares the active reservation and records a separate restoration action. Submission intent, candidate identity, recovery records and append-only deployment observations have storage methods for the coordinator's remote adapters.

The targeted state suite and repository typecheck passed at the support handoff. The suite is fixture evidence, not proof of provider accuracy, GitHub enforcement, live PR recovery, deployed preview/production verification or the required 22-asset timing gates. The coordinator's separate remote harness and real Remote 0 evidence must establish those remaining claims.
