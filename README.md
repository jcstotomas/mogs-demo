# MOGS

Local Launch Correction Agent demo for a fictional company. Read [SPEC.md](SPEC.md) for behavior, [BUILD_PLAN.md](BUILD_PLAN.md) for the build sequence and lane ownership, and [docs/STEP_0.md](docs/STEP_0.md) for the frozen foundation and actual provider results.

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

The scaffold has a root page. Corpus, console, API handlers, publication workflow, reset, and evaluation are subsequent phases. Their script entry points and contracts are present; no full demo gate has passed yet.
