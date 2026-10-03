# MOGS Launch Correction Agent: swarm instructions

Read [SPEC.md](SPEC.md) before changing behavior, source formats, or data contracts. Read [BUILD_PLAN.md](BUILD_PLAN.md) before claiming a lane, starting a phase, or reporting a gate. The spec defines product and acceptance rules; the plan defines sequence, path ownership, runtime dispatch, and cuts. Surface a conflict to the coordinator before implementing it.

## Start and handoff

1. The coordinator completes and commits Step 0: scaffold, executable source/render/crawl/replacement fixture, shared types/database, facts, API fixtures, lifecycle/publication contracts, and passing provider/typecheck results. Lanes start only after every Step 0 completion condition in the plan passes; a partial commit with a blocker is not a dispatch baseline.
2. Claim the paths assigned in the build plan's ownership table. Use a separate worktree when available; in a shared checkout, edit only owned paths. The plan schedules A/B/C first and D after A's required handoff to fit three worker slots.
3. Shared contracts are frozen after Step 0. Send proposed changes and their cross-lane impact to the coordinator; wait for the coordinated contract update before implementing against it. Preserve other agents' work during integration.
4. At each gate, report changed files, checks run and results, sample output/run IDs, and unmet acceptance criteria. The coordinator integrates and evaluates the complete path.

## Demo truth and publication

- The required scope is exactly 20 web pages including canonical pricing, plus two paired emails. Follow the miniature loop, required-scope timing, isolated evaluation, and rehearsal gates in the plan. Deferred surfaces stay deferred.
- A group becomes approvable only after full-scope classification and complete group drafting/checking. Claims about the 90-second gate use the first complete sealed group; also report time to all required results.
- Every applicable check must pass. Failed checks withhold patches; any manual edits rerun checks. Publishing and recovery belong to the coordinator's modules. Revalidate pending source blocks and relevant context after application-owned changes; external edits invalidate affected work.
- Report real counts from the frozen synthetic corpus. Publishing writes locally served content; verification reads the rendered asset and records any failed live recheck plainly.
- Evaluate pristine source against pinned post-change facts in isolated state. Preserve evaluation reports across reset. A missed gate remains a missed gate; report only demonstrated behavior.
