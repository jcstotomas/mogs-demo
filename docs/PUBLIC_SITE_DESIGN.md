# Public MOGS website design

Local presentation update requested in a side conversation on 2026-10-03. Started from `48d1d6c00bb1421961922998899184ed3156d216` in an isolated checkout; the main build and its active content edits were not changed. This is a local design preview, not publication or a passed remote gate.

## Design review

| Before | After | Why |
| --- | --- | --- |
| Homepage contained a title and four document links. | SaaS homepage with a scheduling illustration, product story, and working navigation. | Makes the fictional product and its purpose recognizable. |
| Pricing and launch content appeared as a plain document. | Plan cards, a two-column launch highlights grid, and clearer page hierarchy. | Helps readers scan the existing content. |
| Email previews shared the generic document layout. | Narrow message panels with distinct subject, preheader, and body styles. | Makes the previews resemble email while keeping template tokens visible. |

Warm neutral surfaces, forest green, system typography, and reusable navigation/brand components apply throughout. The homepage illustration is explicitly labeled “Sample workspace.” The fictional-company and no-email-sending labels remain visible. The new homepage is outside the frozen miniature asset inventory.

## Files

- `apps/public/app/globals.css`: responsive public design tokens and page layouts.
- `apps/public/app/page.tsx`: homepage and static scheduling illustration.
- `apps/public/components/brand.tsx`: decorative mark, arrows, and calendar artwork.
- `apps/public/components/site-header.tsx`: shared navigation with current-page state.
- `apps/public/components/public-asset.tsx`: page composition around unchanged source HTML.
- This report and `docs/ui/public-site-design/`: local verification evidence.

No content, facts, source IDs, renderer, API, console, environment, database, or dependency contracts changed. The full source `<main>` HTML and the existing public chrome text still pass the exact production verifier for each of the four miniature assets. Pricing remains derived from the committed fact file. This preview intentionally renders the isolated checkout's original corpus, not the main checkout's newer edits.

## Verification

- `npm run ui:check`: pass.
- `node --import tsx scripts/check-ui.ts apps/public`: pass.
- `npm run typecheck`: pass.
- `npm --prefix apps/public run typecheck`: pass.
- `npm --prefix apps/public run build -- --webpack`: pass; static export only.
- `node --import tsx --test tests/public-artifact.test.ts tests/remote-verification.test.ts tests/remote-submission.test.ts tests/ui-guardrails.test.ts`: 35 passed, zero failed.
- Built HTML checked against `renderedSourceBody`, `assertPublicChrome(..., true)`, and `extractDeploymentMetadata`: all four assets passed. Each asset retains one h1 and one main.
- Browser checks: homepage, pricing, launch, onboarding email, and legacy email at 1440px, 375px, and 320px. No horizontal overflow; navigation targets at least 44px; no visible text below 12px. Desktop source pages and mobile layouts were visually inspected.
- Homepage computed text contrast: 70 samples passed the applicable 4.5:1 or 3:1 threshold.
- Keyboard: visible skip link, 3px focus outline, Enter moves focus to `#content`, Tab reaches the primary action, Enter follows its actual route. Pricing skip navigation also passed.
- Reduced motion was active in the verification browser; action transitions computed to `0s`. No page entrance animations exist. The optional pointer press uses 140ms scale feedback only for fine pointers without reduced motion and excludes keyboard focus and disabled states.
- Browser console: no warning or error entries during the verified pages.
- `git diff --check`: pass.

A bounded manual review found and fixed a CSS specificity issue that prevented the launch highlights from using two columns. The affected desktop and mobile views were checked again.

### Remaining verification limits

The in-app browser did not apply zoom shortcuts, so actual 200% text/browser zoom is **unverified**. Motion with reduced motion disabled and physical pointer press feedback were source-reviewed, not exercised in that environment. There are no disabled controls in this public surface. These limits do not imply a complete accessibility audit. Public deployment and full 22-asset expansion are outside this change.

## Preview and integration

Local preview: `http://127.0.0.1:3105/`.

The preview serves `apps/public/out` from this isolated checkout. To restart after integration:

```sh
npm --prefix apps/public run build -- --webpack
MOGS_PUBLIC_TEST_PORT=3105 npm run public:start
```

The design branch is `codex/mogs-public-design`, with presentation commit `6fdf3c1411ccf7820d00701ff23a770668a67148`. At the user's request, the coordinator integrated it into the primary local checkout as `79524bffea2b8108ebcfdda0b3ad623d6d63f2af`, preserving the working content/fact and planning edits. Fresh integrated checks passed: 35 focused tests, public typecheck, static UI guardrails, and the public export build. All four exported assets retained exact source HTML, public chrome and deployment metadata, with one h1 and one main each. [Integration evidence](ui/public-site-design/integration-checks.json) records that commit and artifact identity. Existing unchanged design browser evidence and the verification limits above still apply.

The design remains local and has not been pushed or deployed. A later remote candidate must rebuild against its own commit before verification. This design does not replace or bypass preview, merge, production, or rendered-content checks.

## Screenshots

- [Homepage preview](ui/public-site-design/homepage-preview.jpg)
- [Before pricing](ui/public-site-design/before-pricing-desktop.jpg) / [after pricing](ui/public-site-design/after-pricing-desktop.jpg)
- [Desktop homepage](ui/public-site-design/after-home-desktop.jpg) / [mobile homepage](ui/public-site-design/after-home-mobile.jpg)
- [Desktop launch guide](ui/public-site-design/after-launch-desktop.jpg) / [mobile launch guide](ui/public-site-design/after-launch-mobile.jpg)
- [Desktop onboarding email](ui/public-site-design/after-onboarding-desktop.jpg) / [mobile onboarding email](ui/public-site-design/after-onboarding-mobile.jpg)
- [Desktop legacy email](ui/public-site-design/after-eligible-desktop.jpg) / [mobile legacy email](ui/public-site-design/after-eligible-mobile.jpg)
- [Keyboard skip link](ui/public-site-design/keyboard-skip-link.jpg)
- [Browser measurements](ui/public-site-design/browser-checks.json)
