# MOGS

Launch Correction Agent for fictional MOGS: confirm desired facts → crawl/classify/draft/check → approve groups → submit one real GitHub PR → verify its preview → human merge → verify the public deployment. The deployed miniature has completed this flow with four human group approvals and five verified content corrections. [PR #3](https://github.com/jcstotomas/mogs-demo/pull/3) was human-merged, and the matching corrected deployment is publicly verified at [mogs-demo.vercel.app](https://mogs-demo.vercel.app). Trusted App-bound checks and strict branch protection are verified.

Read [SPEC.md](SPEC.md) for behavior and [BUILD_PLAN.md](BUILD_PLAN.md) for sequence/ownership. [The miniature record](docs/REMOTE_1.md) preserves the live evidence and remaining gates; [Step 0](docs/STEP_0.md) and [local Gate 1](docs/GATE_1.md) preserve the earlier v1 evidence.

## Demo walkthrough

1. Open the [completed local review](http://localhost:3104/console/remote?runId=07c47d90-b32a-45cf-9b33-97571ca7819c). Review the four approved groups, their original/proposed text and rationale, the withheld threshold case, and the preserved eligible email.
2. Open [PR #3](https://github.com/jcstotomas/mogs-demo/pull/3) to show the combined content/fact changes, required checks, verified preview and separate human merge.
3. Show the public [launch guide](https://mogs-demo.vercel.app/site/launch), [canonical pricing](https://mogs-demo.vercel.app/site/pricing), [onboarding template](https://mogs-demo.vercel.app/assets/email/onboarding) and [eligible legacy template](https://mogs-demo.vercel.app/assets/email/eligible). The public offer is $40; the explicit eligible legacy claim remains $30. These are published templates, not sent emails.
4. Open the [local design preview](http://127.0.0.1:3105/) for the design integrated locally at `79524bf`. The preview serves the design checkout's original seed content; the actual corrected public result is in step 3. The design is local-only and has not been publicly deployed.

The review screen displays a **recorded, completed live run**, not a fresh analysis. A fixture replay must be clearly labeled as fixture evidence. To repeat the real $30→$40 story, create the separate checked seed-restoration PR, have a person merge it, verify the restored $30 production baseline, then confirm a new correction attempt. Local reset never restores the remote site.

## Developer quickstart

Use the running demo above when reviewing its recorded result. For a new local development session:

```sh
npm ci
cp -n .env.example .env.local
# Configure TYPESAFE_API_KEY and ANTHROPIC_API_KEY in .env.local.
npm run typecheck
npm run dev
```

Use Node >=22.13. After code changes, run typecheck and the relevant build/check for the affected path. Reserve the broad `npm test` suite for release acceptance or a concrete regression; demo milestones use one changed-path walkthrough. Documentation-only changes need no application tests or build.

The Step 0 gate selected the Anthropic frontier judge; Jev did not pass the eligibility and derived-savings cases. Frontier confidence is unavailable. `npm run provider:smoke` makes live, billed provider calls and records redacted evidence; it is an explicit provider gate, not a routine startup step.

## Evidence and remaining scope

The v2 miniature contains four assets: one editable web page, two paired emails and read-only canonical pricing. Its analysis, human approvals, combined candidate, real PR, preview, human merge and public verification are recorded. [Remote 0](docs/REMOTE_0.md) records the committed foundation, passing enforcement and preserved setup failures. The builders and coordinator are integrated. The existing unversioned `/console` and API retain the separate v1 local publication flow; `/console/remote` is the v2 review surface.

The worker/console stays local with durable SQLite; only content is publicly deployed. The required **20-web/two-email workload**, its **90/180-second timing gates**, isolated evaluation and remaining actual recovery drills/rehearsals are pending or deferred. They have not passed. The separate 180-web/20-email scale milestone also remains deferred; miniature success supplies no full-scope, scale or general-agent advantage claim.

For targeted setup work, `npm run remote:check` checks frozen contracts and `npm run remote:audit` inspects configuration/provider identity without printing keys. `npm run remote:migrate` archives v1 history through an online backup into the separate ignored v2 database for a fresh installation; it leaves the original database in place. These are setup tools, not a required demo startup checklist.

The public build consumes exact committed source. In an isolated checkout of the intended source revision, `npm run public:build` and `npm run public:start` build and serve the static target on port 3100. `npm run public:seed` generates the frozen seed for local fixture inspection; publishing it requires the separate restoration flow. The coordinator's `vercel.json` deploys only `apps/public/out`. Verification must use the intended deployment's recorded commit and source hashes; the historical Remote 0 seed record is not the current corrected production revision.

The primary local checkout and GitHub `main` have different histories. Keep the repaired v1 working content local. The ignored `data/remote/source` checkout provides pinned public source; do not push the primary branch over the public repository. See [Remote 1](docs/REMOTE_1.md) for the correction run and deployed identifiers.

`npm run github:check` is read-only authentication inspection. `npm run github:enforce` configures protection and creates disposable audit PRs; its durable journal refuses to overwrite a completed probe. Passing configuration checks alone never substitutes for recorded eligibility probes.
