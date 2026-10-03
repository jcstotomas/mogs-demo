# Required-page presentation follow-up

The user reported that the new deployed pages had not inherited the approved public design. The five original presentation files were present in production at `863999fdce74c3e6c53e49ab2ad61c8d20263e73`; the gap was in the expansion. Existing claim-card CSS selected only the original launch page's four source IDs. The 18 supporting pages used different IDs and retained the plain document treatment.

## Change

| Before | After | Why |
|---|---|---|
| Short supporting pages showed plain paragraphs. | Forest/white claim panels use the approved typography and spacing. | Extend the original launch presentation to the added pages. |
| Heading-context examples lacked visual grouping. | Headings and their following claims share a readable section. | Keep the context beside the claim. |
| Longer account/help pages were unstructured. | One document panel contains the longer article. | Keep prose readable without a separate card for every sentence. |

The change adds an outer `public-page--article` class and styles existing block roles/sibling structure. It preserves exact source main HTML, claim text, IDs, roles, contexts, facts and public chrome copy. Homepage, canonical pricing, original launch page and email presentation retain their existing rules. No motion was added.

Files: `apps/public/app/globals.css` and `apps/public/components/public-asset.tsx`. Primary code commit: `2557545635f64ffd920796999e0c6382b4a1c9df`. The isolated build's equivalent cherry-pick is `c545b57459a363b754f5316a99c8b38fed75b4e5`.

## Concrete preview

- [Public Starter offer preview](https://mogs-demo-ot0fkms78-jcstotomas-projects.vercel.app/site/starter-offer).
- [Draft presentation PR #8](https://github.com/jcstotomas/mogs-demo/pull/8), branch `codex/required-22-presentation`.
- Exact public candidate: `bbaca360be0bdadea14379262cb6ba7ed9e2db73`; base `863999fdce74c3e6c53e49ab2ad61c8d20263e73`.
- Ready preview deployment: `dpl_EfW1CWV9VCu9Ja7FavCEWc9W7SrU`.
- Only the two presentation files differ from the public base tree. All other files were preserved by exact tree comparison. Main and production remain unchanged.
- Preview readback passed for all 22 assets/110 passages, including all 18 article layouts and private-route exclusion. The trusted App preview status passed; candidate status remains pending for the merge hold.

## Merge sequence

The current live correction `097e9332-aa63-428c-8c81-5e2b462a69bf` is pinned to production/base `863999f`. Merging a presentation revision now would invalidate that baseline and the collected results under SPEC section 7. This presentation PR stays draft until that correction completes human group approval, correction submission/preview, human merge and corrected public verification.

Then refresh the presentation branch against the corrected main, preserving its current content/facts and applying only these two presentation files. Verify the new candidate preview and checks before a separate human merge. The earlier preview does not authorize a different candidate or bypass source checks. No launch repair or human approval credit belongs to this design update.

## Focused checks

- Primary typecheck passed.
- One isolated public build passed, including core/public UI source checks and Next.js type validation. Existing demo servers and their static artifacts were preserved.
- Local built output preserved all 22 assets/110 passages, source/fact hashes, exact main HTML, source IDs/text/roles/contexts and chrome copy. Each asset retained one main heading and one main.
- A single walkthrough covered short claims, heading-context sections and a longer article at 1440px and 375px. No horizontal overflow; keyboard skip-link focus had a visible 3px outline. Existing motion/control evidence was reused.
- The actual public preview was inspected at the exact candidate revision: green/white panels, 23px text and 32px desktop padding were present. No broad test suite, provider rerun, evaluation or recovery drill was added.

Evidence: [local preservation](../data/evidence/public-design-22/local-preservation.json), [public preview readback](../data/evidence/public-design-22/preview-readback.json), [PR journal](../data/evidence/public-design-22/presentation-pr.json), [browser measurements](ui/required-page-design/browser-checks.json).

Screenshots: [before](ui/required-page-design/before-starter-offer-desktop.png), [short page desktop](ui/required-page-design/after-starter-offer-desktop.png), [short page mobile](ui/required-page-design/after-starter-offer-mobile.png), [context page desktop](ui/required-page-design/after-annual-overview-desktop.png), [context page mobile](ui/required-page-design/after-annual-overview-mobile.png), [long page desktop](ui/required-page-design/after-account-rules-desktop.png), [long page mobile](ui/required-page-design/after-account-rules-mobile.png), [public preview](ui/required-page-design/public-preview-starter-offer.png).
