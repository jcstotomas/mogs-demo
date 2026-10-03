# MOGS

Launch Correction Agent for fictional MOGS. The v2 target is a controlled deployed site and repository-backed email templates: show old content → confirm desired facts → crawl/classify/draft/check → approve groups → submit one real GitHub PR → verify its preview → human merge → verify the public deployment. The pristine miniature is deployed at [mogs-demo.vercel.app](https://mogs-demo.vercel.app) from the private `jcstotomas/mogs-demo` repository. Trusted GitHub status production and enforced merge checks remain pending.

Read [SPEC.md](SPEC.md) for behavior and [BUILD_PLAN.md](BUILD_PLAN.md) for sequence/ownership. These describe the v2 target, not implemented remote capabilities. [docs/STEP_0.md](docs/STEP_0.md) and [docs/GATE_1.md](docs/GATE_1.md) preserve the actual v1 local evidence.

```sh
npm ci
cp -n .env.example .env.local
# Configure TYPESAFE_API_KEY and ANTHROPIC_API_KEY in .env.local.
npm run contracts
npm test
npm run typecheck
npm run dev
```

Use Node >=22.13. The Step 0 gate selected the Anthropic frontier judge; Jev did not pass the eligibility and derived-savings cases. Frontier confidence is unavailable. `npm run provider:smoke` runs live, billed provider calls and records redacted evidence.

The local miniature completed Gate 1 with four human approvals and five verified repairs. The deployed v2 foundation now includes a static public app, separate desired-state database, versioned fixtures, combined candidate checks and recovery contracts. [Remote 0](docs/REMOTE_0.md) records the current checks and blockers; implementation lanes remain paused until that gate passes. The full 22-asset workload, isolated evaluation and remote rehearsals remain pending. The existing unversioned console/API still runs the v1 local publication flow.

The first remote demo keeps the worker/console local with durable SQLite and deploys only content. The required workload remains 20 web pages plus two email templates. A separate 180-web/20-email scale benchmark follows the complete remote path; no scale or general-agent advantage is demonstrated yet.

Remote foundation checks: `npm run remote:check`, `npm run remote:audit`, and `npm test`. The audit prints configuration presence and provider identities; it never prints keys. `npm run remote:migrate` archives v1 history through an online backup into the separate ignored v2 database. Run it before the first v2 operation. It leaves the original local database in place.

The public build consumes exact committed source. In an isolated pristine checkout, run `npm run public:build` and `npm run public:start` for a static verification server on port 3100. `npm run public:seed` generates the frozen seed for local fixture inspection; a deployable baseline also needs those exact seed files committed as `content/**` and `data/facts.json`. The coordinator's `vercel.json` deploys only `apps/public/out`. `npm run public:verify` reads every current public asset against the exact source commit recorded in `docs/remote0/public-deployment.json`; it uses the separate checkout configured by `MOGS_REMOTE_SOURCE_ROOT`.

The primary local checkout and GitHub `main` currently have different histories. Keep the repaired v1 working content local. The pristine remote source is in the ignored `data/remote/source` checkout; do not push the primary branch over the public baseline. See [Remote 0](docs/REMOTE_0.md) for the current source/deployment identifiers and next gate.
