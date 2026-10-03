# Remote 0 deployment readiness audit

**Observed:** 2026-10-03 20:20 UTC. **Scope:** read-only inspection of the primary checkout, target GitHub repository, and accessible Vercel account. No repository, hosting, protection, or deployment settings were changed. This is setup evidence, not a Remote 0 gate pass.

## Contract to prove

`SPEC.md` §§1, 6–7 and `BUILD_PLAN.md` Remote 0 require a separate content-only `apps/public/` build; pristine source and facts at one seed revision; a real repository, pinned base branch and deployed commit; an isolated preview for the candidate commit; and protected merge requiring `mogs/candidate` and `mogs/preview` from a trusted producer, strict current-base checks, and no administrator bypass or automatic merge. The console/API and runtime state must stay local.

## Verified inventory

| Item | Observation |
|---|---|
| Target named in plan | `jcstotomas/mogs-demo`. GitHub owner `jcstotomas` returned HTTP 200 through the unauthenticated API. |
| GitHub repository access | `git ls-remote` returned **Repository not found**. The unauthenticated repository API returned HTTP 404. This means the target is absent **or inaccessible to the credentials available for this check**; it does not establish which. No default branch, repository ID, or permission level was verified. |
| Local Git checkout | Branch `main`, HEAD `3fa841a`, no configured remote. The primary checkout had 19 modified/untracked entries at audit time; preserve them. This local HEAD is not a remote or deployed baseline. |
| GitHub CLI/credential route | `gh` is not installed. `GH_TOKEN` and `GITHUB_TOKEN` were absent from this process, and no `~/.config/gh/hosts.yml` was present. Git credential helpers are configured, but the target access check failed. No authenticated GitHub API identity or status-writing permission was verified. |
| Hosting identity | Vercel CLI 44.7.2 authenticated as `jcstotomas`; the only listed accessible scope was `jcstotomas-projects`. |
| Hosting project | Both pages of that scope's project listing were checked (23 projects); none was named MOGS or `mogs-demo`. No MOGS project ID, Git connection, production branch, public origin, or preview origin was verified. |
| Local deployment target | No `apps/public/`, `.vercel/`, or `.github/` directory exists in this checkout. The current root package is a single Next.js app with local console/API routes, so it is not evidence of the required isolated public artifact. |

## Readiness and blockers

1. **Repository identity/access blocks binding work.** Establish or grant access to the intended repository, record its actual repository ID/default branch, and configure this checkout's remote only after the target is resolved. Until then, branch protection, required contexts, producer/source restrictions, and commit/PR permissions cannot be inspected or proven.
2. **Hosting target and preview are not configured.** Establish the Vercel project/Git connection for the content-only app, record its project ID, production branch, production URL and commit-specific preview URL, then prove the routes and artifact isolation. Vercel documents Git-linked PR previews and a configurable monorepo root directory; neither is evidence that this project has them yet. [Vercel Git deployments](https://vercel.com/docs/git), [monorepo root directory](https://vercel.com/docs/monorepos).
3. **Protected merge capability is unproven.** GitHub documents required commit statuses, strict up-to-date checks, administrator enforcement, and selection of a specific GitHub App as the expected status source. The coordinator's status credential and expected-source choice must be tested on the actual repository; a user token must not be assumed equivalent to GitHub App source binding. GitHub lists branch protection for public repositories on Free and private repositories on Pro/Team or higher, so repository visibility/account plan may affect setup. [Protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [commit-status API](https://docs.github.com/en/rest/commits/statuses).
4. **Public app bootstrap is pending implementation.** The coordinator still needs the isolated seed checkout and `apps/public/` target before any first deployment or lane handoff. This is a planned Remote 0 deliverable, not a failed deployed check.

## Commands and results

| Read-only check | Result |
|---|---|
| `git remote -v`, `git status --short --branch`, `git rev-parse --short HEAD` | No remote; local `main` at `3fa841a`; 19 modified/untracked entries. |
| `GIT_TERMINAL_PROMPT=0 git ls-remote --exit-code https://github.com/jcstotomas/mogs-demo.git HEAD` | Exit 128, `Repository not found`. |
| Unauthenticated `GET https://api.github.com/users/jcstotomas` and `/repos/jcstotomas/mogs-demo` | HTTP 200 and 404, respectively. |
| `vercel whoami`, `vercel teams ls` | `jcstotomas`; sole scope `jcstotomas-projects`. |
| `vercel project ls` and its next page | 23 accessible projects listed; no MOGS target. |
| Local directory/config and credential-presence checks | No `apps/public/`, `.vercel/`, `.github/`, `gh`, process GitHub token variables, or GitHub CLI host file. No secret values were read or recorded. |

**Next verification after setup:** query the actual repo/branch rules and trusted status source; prove pending/failure/wrong-head rejection and current-head eligibility; link a public-only Vercel project; deploy the exact pristine seed; resolve its production commit and rendered hashes; then verify a candidate's commit-specific preview. None of these outcomes is claimed here.

## Bootstrap update — 2026-10-03 20:44 UTC

The earlier inventory above is a timestamped pre-setup snapshot. The coordinator created the new demo repository and Vercel project. Bootstrap work then ran in an isolated clone at `/private/tmp/mogs-remote-bootstrap-20261003`, leaving the primary checkout's modified content, facts, and local history untouched. The isolated clone started at public bootstrap commit `328ffb1`; its checked-out source files were already byte-for-byte equal to the committed miniature seed, so no source or fact restoration diff was necessary. An empty seed-baseline audit commit `0cdfcbf` established remote `main`; an empty commit `e2dca9a` triggered the first Git deployment. The coordinator's `cleanUrls` fix was cherry-picked as `e573c26` and pushed normally. Current remote `main` resolves to full SHA `e573c2608ce3fa54f51cab67594355448aa1059b`.

| Check | Verified result |
|---|---|
| Seed source and facts | Three source files exactly match `content/seed.json`, with 33 `source-id` blocks total (13 launch, 10 onboarding, 10 eligible). `data/facts.json` is byte-for-byte equal to `data/seed/facts.json`; Starter monthly is 3000 cents. Facts file SHA-256: `d9e8c25d0f432ec21b3c80317203236d74518b65f3a88a8d44c1fd82dfe137ee`. |
| Target repository | `jcstotomas/mogs-demo`; Vercel's Git link reports GitHub repository ID `1403606624`, production branch `main`. `git ls-remote --heads origin main` returned the exact current deployment commit above. The unauthenticated GitHub repository API returned HTTP 404, consistent with a private repository but not independent proof of its visibility setting. |
| Vercel project | Scope `jcstotomas-projects`, team `team_tTySQ8aRrx08Ma0X2AMFm40d`, project `mogs-demo`, ID `prj_hT55y9ozmq67qLkneP8csBNUuVTr`. `vercel git connect` linked the target repository. No environment file, local database, credential, or provider secret was uploaded. |
| Current Git production deployment | `dpl_FKWya3GuHsFvnDBCSQ2vDQdH3V1m` is **Ready** at [mogs-demo.vercel.app](https://mogs-demo.vercel.app). Build logs explicitly show Git cloning `main` commit `e573c26`, running the public artifact generator against full SHA `e573c2608ce3fa54f51cab67594355448aa1059b`, and completing the static build. The immutable deployment URL is `https://mogs-demo-pn3xww0x8-jcstotomas-projects.vercel.app`. |
| Artifact identity | Embedded metadata on all four public asset routes reports the exact deployed Git SHA, facts hash `a0512f91ade4e8dfc3e73df89d2661eddcf409dbfb8cecf0f0ac71c987767664`, and inventory hash `e2a7a3f6835759dadd8881f87f1eeeef73a88c7e62d2873647924d53e74e5605`. Deployed source hashes match the three seed files. Full identifiers and hashes are in [public-deployment.json](public-deployment.json). |
| Public routes | `/`, `/site/pricing`, `/site/launch`, `/assets/email/onboarding`, `/assets/email/eligible`, and `/sitemap.xml` each return HTTP 200 on the production alias. The three source-backed assets render all 33 source IDs in seed order. Canonical pricing renders Starter at $30 and does not show the desired $40. `/console` and `/api/facts` return HTTP 404. |
| Initial routing failure and fix | The first Ready deployment at `e2dca9a` returned HTTP 404 for `/site/pricing`, while `/site/pricing.html` returned HTTP 200. The current deployment includes `cleanUrls: true`: `/site/pricing` now returns 200 and the `.html` URL redirects 308 to the clean path. This failed check remains recorded as evidence. |
| Preview protection | Project API readback reports `ssoProtection.deploymentType = all_except_custom_domains`, with no password protection. The immutable URL returns HTTP 302 toward `vercel.com/sso-api` to an unauthenticated request. A project API change to set `ssoProtection` to `null` was rejected by automatic approval review before execution. The review said that this persistent change would broadly expose previews without direct human approval for the security-setting change. No alternative bypass was attempted. |
| Sitemap issue | The sitemap's four links use the protected immutable deployment URL, so an unauthenticated visitor who follows them reaches Vercel SSO. Set a stable public production origin (`MOGS_PUBLIC_ORIGIN=https://mogs-demo.vercel.app`, a nonsecret value) or change the production sitemap fallback in committed code, then redeploy and recheck all sitemap links. |

The public seed deployment is real and commit-bound, but **Remote 0 is not passed**: preview access is blocked by project protection and its sitemap links are inaccessible to public visitors. GitHub App status ownership, required `mogs/candidate` and `mogs/preview` contexts, strict current-base checks, no-administrator-bypass protection, and a candidate PR's commit-specific preview remain unverified. The project protection change must await direct human approval; the coordinator can fix the sitemap independently.

## Public preview and sitemap follow-up — 2026-10-03 20:48 UTC

The human explicitly approved, “Yes, make MOGS previews public.” The previously rejected project change was then made through the Vercel project API for **only** `prj_hT55y9ozmq67qLkneP8csBNUuVTr`; PATCH returned HTTP 200 and a fresh project GET read back `ssoProtection: null` and `passwordProtection: null`. The repository remains Git-connected to `jcstotomas/mogs-demo` on `main`. No `public:true` deployment option was used, and no project other than `mogs-demo` was changed.

The nonsecret production-only Vercel variable `MOGS_PUBLIC_ORIGIN=https://mogs-demo.vercel.app` was added to set the sitemap's canonical origin. A production redeploy rebuilt from Git `main` at the **same** full SHA `e573c2608ce3fa54f51cab67594355448aa1059b` (the build log shows the Git clone and exact metadata); `git ls-remote` still returned that SHA. Current Ready deployment `dpl_J4vVHRyNZC5QfB9BafiaaeurmzDJ` has immutable URL [mogs-demo-pmrmogsx4-jcstotomas-projects.vercel.app](https://mogs-demo-pmrmogsx4-jcstotomas-projects.vercel.app) and production alias [mogs-demo.vercel.app](https://mogs-demo.vercel.app).

Unauthenticated requests to **both** origins returned HTTP 200 for the root, four expected content assets, and sitemap, and HTTP 404 for `/console` and `/api/facts`. Embedded metadata on all four assets matched the exact Git SHA and the same fact/inventory/source hashes from the prior deployment. The sitemap now lists four production-alias URLs, each tested anonymously at HTTP 200. The repository's read-only `observeBaseline` function passed for all four assets against both production and immutable origins, including rendered text and deployment metadata. That probe used an in-memory placeholder `statusProducerAppId: 1` solely to satisfy the schema while GitHub App configuration remains unproven; it did not persist an attempt or establish trusted status ownership.

The earlier failed `/site/pricing` 404 and protected immutable URL/sitemap observations remain above as historical evidence and are resolved for this new deployment. **Remote 0 remains open** until a candidate PR's commit-specific preview and the required GitHub App status/branch protection gates are exercised. Exact current identifiers are in [public-deployment.json](public-deployment.json).
