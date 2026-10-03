# Brutalist console theme

October 3, 2026. Preview: [campaign workspace](http://localhost:3111/console/campaign) and [website review fixture](http://localhost:3111/console/remote?fixture=sealed).

| Before | After | Why |
|---|---|---|
| Small wordmark, light headings, and pale dividers | Geometric MOGS mark, heavy typography, and dark structural rules | Give the workspace a clear brutalist identity and stronger hierarchy. |
| Rounded panels and controls | Square review groups and buttons on warm paper surfaces | Make the visual language consistent across the parent app and embedded campaign panel. |
| Subtle selection and low-emphasis review boundaries | Solid selection borders and distinct current/suggested blocks | Keep the original, proposed correction, and review decision easy to locate. |

## Scope

Five stylesheets: `app/globals.css`, `components/campaign-console.module.css`, `components/launch-console.module.css`, `components/remote-console.module.css`, and `experiments/multichannel-lab/public/styles.css`. Existing UI copy, runtime behavior, source formats, publication rules, and imported creative remain unchanged. No new motion. Existing pointer press feedback remains gated for reduced motion and keyboard focus.

The task began on `8135debf4ca8834bdb6f7269cd66d3e9ef04e2dc` with existing clarity edits. Those edits were committed separately as `9d9cd52` during this task. The theme delta is separate from that work and unrelated pending source/fact/plan changes.

## Verification

- Root `npm run ui:check` and `npm run typecheck`: passed.
- Root production build with `MOGS_BUILD_DIR=.next/brutalist-preview`: passed. It reported 16 filesystem tracing warnings in unchanged runtime modules.
- Lab `npm run build`: passed, including typecheck and its UI checker.
- Browser: populated campaign and sealed website review at 1440px and 375px; 320px overflow spot-check passed in the root document and campaign iframe. A 200% text-size simulation at 375px also had no horizontal overflow.
- Keyboard: both skip links received a visible 3px outline and moved focus to their main regions; the campaign detail disclosure toggled with Enter. The main action is 48px high and its pointer-hover state was checked.
- Computed text contrast in the inspected populated states: campaign minimum 6.18:1, embedded lab 5.92:1, website review 4.84:1; no failures in the visible-text scan. Original embedded artwork was excluded. This focused check is not a full accessibility audit.
- Reduced motion: sampled review button has 0s transition duration and no transform.
- All eight isolated remote UI fixture states were captured: initial, collecting, sealed, withheld, failed submission, failed preview, failed public verification, and verified. No enabled mutation controls and no page overflow were observed in these fixture states.
- No new model run, group approval, PR submission, merge, or publication was performed. Saved campaign observations remain eight suggestions, five items needing a decision, six assets, and explicit partial coverage. Fixtures are synthetic UI evidence, not publication proof. Release evaluation, recovery, timing, and rehearsal gates remain separate.

## Browser evidence

- Campaign: [before desktop](before-campaign-desktop.png), [after desktop](after-campaign-desktop.png), [before mobile](before-campaign-mobile.png), [after mobile](after-campaign-mobile.png), [populated findings](after-campaign-findings.png).
- Website: [before desktop](before-website-desktop.png), [after desktop](after-website-desktop.png), [before mobile](before-website-mobile.png), [after mobile](after-website-mobile.png), [review groups](after-website-groups.png).
- Status captures use `state-*.png`; [measurements](verification.json) record responsive, contrast, keyboard, and fixture checks.

The before-mobile campaign capture uses the saved pretask iframe stylesheet in the browser because the local lab serves CSS directly from disk. It does not change source or saved campaign state.

The local preview uses port 3111, separate build output `.next/brutalist-preview`, and a separate lab process on port 3221. It reads the existing `main-campaign-demo` saved campaign. The preview is local and has not been deployed.
