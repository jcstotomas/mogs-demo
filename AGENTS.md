# MOGS deployed launch correction demo: swarm instructions

Read [SPEC.md](SPEC.md) before changing behavior, source formats, or data contracts. Read [BUILD_PLAN.md](BUILD_PLAN.md) before claiming a lane, starting a phase, or reporting a gate. The spec defines product and acceptance rules; the plan defines sequence, path ownership, runtime dispatch, and cuts. Surface a conflict to the coordinator before implementing it.

For frontend layout, styling, copy, or interaction changes, read [docs/FRONTEND_UI.md](docs/FRONTEND_UI.md) before editing. Apply its design rules and verification checklist; the UI check is required, and browser evidence is required for affected visual states.

## Start and handoff

1. Preserve the v1 Step 0 and local Gate 1 evidence. The coordinator bootstraps the public target and completes Remote 0's migration, attempt identity, recovery and enforced merge checks before dependent v2 lanes start. Require the committed executable baseline and passing evidence in the build plan; a planning revision or partial commit with a blocker is not a dispatch baseline.
2. Claim only paths assigned in the build plan. Use a separate worktree when available; in a shared checkout, edit only owned paths and preserve existing changes. A/B/C use the three worker slots; D follows A's required corpus handoff.
3. Send shared contract changes and cross-lane impact to the coordinator; wait for the coordinated types/fixtures/callers update before implementing against it. The coordinator owns desired/deployed facts, Git submission, deployment observation and recovery.
4. At each gate, report changed files, checks run and results, sample output/run IDs, and unmet acceptance criteria. The coordinator integrates and evaluates the complete path.

## Demo truth and publication

- The required deployed scope is exactly 20 web pages including canonical pricing, plus two paired email templates. The separate subsequent scale milestone is 180 web pages plus 20 email templates. Keep their inventories, timings, evaluation and claims separate. Follow the remote miniature, full-scope, evaluation and rehearsal gates; deferred surfaces stay deferred.
- A group becomes approvable only after full-scope classification and complete group drafting/checking. For the required 22-asset workload, pass both first complete group ≤90 seconds and all results ready ≤180 seconds under spec section 7; report unresolved errors as failures.
- Every applicable check must pass. Failed checks withhold patches; manual edits and combined-file changes rerun applicable checks. Changed source, desired facts, group revision or candidate commit invalidates affected readiness/approval. Submission preflight covers the entire approved bundle.
- Confirm records desired facts without changing the public site. Human group approvals authorize inclusion in one PR per run, containing checked content and the deterministic canonical fact-file change. Human GitHub merge is a separate publication decision.
- Follow spec section 7's recovery boundary: checked edits/drops before submission require renewed affected approval; changed submitted candidates require abandonment/new attempt; merged failures require observed deployment reconciliation. Preserve every prior PR and failure record.
- Report real counts from the frozen synthetic corpus. Distinguish submitted PR, verified preview, merge, production deployment and rendered verification. Bind observations to actual commit/source hashes. Email preview publication is not email sending.
- Apply spec sections 8 and 10's independent per-kind repair gates and protected-block preservation rule. Evaluate pristine source in isolated state; production scoring reads immutable named-run evidence. Local reset never changes a remote deployment; rehearsal restoration records a fresh attempt and verified baseline. Only recorded v2 results satisfy v2 gates.
