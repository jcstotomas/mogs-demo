# Launch Correction Agent: swarm instructions

Read [SPEC.md](SPEC.md) before changing behavior or data contracts. Read [BUILD_PLAN.md](BUILD_PLAN.md) before starting a phase or claiming a milestone. `SPEC.md` defines the product and acceptance rules; `BUILD_PLAN.md` defines sequence, ownership, and cut gates. Surface a conflict to the coordinator before implementing it.

## Start and handoff

1. The coordinator completes Step 0: app scaffold, shared types and database, facts and derived values, fixtures, and provider smoke tests. Agent work starts against these frozen contracts.
2. Claim one lane from the ownership table below. Work in a separate Git worktree when available. In a shared checkout, edit only files in the claimed lane.
3. At each gate, report files changed, commands run and results, sample output, and any unmet acceptance check. The coordinator integrates lanes and runs the end-to-end gate.

| Lane | Owns |
|---|---|
| A — corpus | `app/site/**`, `app/assets/**`, `content/**`, `scripts/generate-site.ts`, `scripts/reset.ts` |
| B — pipeline | `lib/pipeline/**`, `app/api/**` |
| C — console | `app/console/**` except `eval/**` and `baseline/**`; `components/**` |
| D — evaluation | `scripts/eval.ts`, `lib/metrics/**`, `app/console/eval/**`, `app/console/baseline/**` |
| Coordinator — shared | `lib/types.ts`, `lib/db.ts`, `lib/facts/**`, `data/facts.json`, `fixtures/**`, package/config files, integration and release gates |

Shared contracts are frozen after Step 0. Send a proposed contract change to the coordinator with its impact on other lanes; wait for the coordinated update before coding against it. Preserve other agents' work during integration.

## Demo truth and safety

- The required live slice is 20 web pages plus the paired emails. It must reach a reviewable group within 90 seconds and publish and verify after one approval per correction group.
- Claims about results use the frozen synthetic corpus and real counts. Scenario sends and spend are invented inputs. Publishing writes locally served Markdown; verification reads the local rendered asset.
- A failed hard check blocks publication. A human override of edit size or model disagreement is recorded, and a failed live recheck is reported as failed verification.
- Report a missed gate plainly. Cut optional surfaces according to `BUILD_PLAN.md`; remove cut surfaces from the sitemap and pitch.
