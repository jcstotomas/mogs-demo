# Frontend UI guardrails

MOGS is a review tool. Its visual priority is the claim, its proposed correction, the evidence, and the approval decision. Use Emil Kowalski's design engineering principles: cohesive defaults, immediate feedback, purposeful motion, and invisible accessibility details. Product behavior and evidence claims remain governed by [SPEC.md](../SPEC.md); ownership and build gates remain in [BUILD_PLAN.md](../BUILD_PLAN.md).

The initial styling and browser evidence cover the existing local v1 console. The planned deployed v2 workflow remains subject to its separate contract gate; this UI work does not implement or validate it.

## Visual direction

- Use the shared `--font-ui` stack from `app/globals.css` for the application and controls. Keep source text readable as prose and diagnostic identifiers in the existing expandable evidence area.
- Use warm neutral surfaces, dark text, and the existing green action color. Amber and red communicate attention and failure; accompany every status color with a word. Keep foreground/background contrast at least 4.5:1 for normal text and 3:1 for large text and meaningful control boundaries.
- Use spacing and alignment to establish hierarchy. A bordered container should group one review decision; avoid wrapping every text fragment in another card. Keep shadows for actual elevation, such as an overlay. Gradients, glass blur, glow, decorative text shadows, and ornamental backgrounds have no role in this console.
- Keep main copy at least 14px and supporting labels at least 12px. Use sentence case except for short existing section labels. Keep one h1 per screen and a clear h2/h3 outline. Use tabular numerals for prices, counts, and timings.
- Reuse existing surfaces, buttons, badges, and CSS variables. Extend the shared tokens when a repeated need appears. Prefer the 4/8/12/16/24/32/48px spacing rhythm for new work; keep exceptions tied to content and alignment.
- Write concrete action labels such as “Confirm price change” and “Open review console.” Describe only the action authorized by the active contract: v2 group inclusion, PR submission, merge, and public deployment are separate events. Empty states explain what is missing or what happens next. Preserve exact reviewed source copy; UI copy edits never rewrite corpus claims.

## Interaction and motion

Default to immediate state changes. Reviewing many claims is frequent work; polling counts, correction rows, keyboard navigation, focus changes, and disclosure toggles stay instant. Do not add row entrance staggers, bouncing cards, animated counters, or artificial loading delays.

Before adding motion, name its purpose, frequency, trigger, and reduced-motion behavior in the change description. Use CSS transitions with explicit properties for interruptible feedback. Movement uses transform or opacity rather than layout properties; ordinary color feedback may use color/background-color. Keep durations at or below 300ms, generally 100–160ms for press feedback and 125–200ms for occasional overlays. Use `--ease-out` for entry/press feedback; avoid `ease-in` and `transition: all`.

Gate movement with `prefers-reduced-motion: no-preference`. Gate hover styling with both `hover: hover` and `pointer: fine`. The existing pointer press pattern also excludes disabled and `:focus-visible` controls so keyboard activation remains instant. If adding a new interaction, explicitly verify its input modality rather than assuming `:active` means a mouse.

Use a small press scale (0.97), never an entrance from zero scale. Anchored overlays scale from their trigger; centered dialogs stay centered. A new dialog or popover needs keyboard dismissal, focus placement/return, and reduced-motion verification before it is complete. Additional motion libraries require a concrete interaction that CSS cannot serve.

## Review clarity and accessibility

- Keep the current/proposed text pair, rationale, checks, surface, and group action together. Narrow layouts stack the two text blocks in that order. Wrap long claim text, URLs, and evidence IDs without horizontal page scrolling.
- Primary buttons and standalone navigation/disclosure targets should offer at least 44px of height. Inline prose links retain normal text flow. Keep native button, anchor, details/summary, and progress semantics; use accessible names for icon-only controls.
- Keep visible focus outlines and the skip link. Disabled controls also have a nearby explanation when the reason is not evident. Errors use an alert; asynchronous status messages use a bounded polite region, not the whole changing console.
- Preserve separate collecting, reviewable, publishing, verified, and failure states for the local console. The deployed workflow additionally distinguishes submission, preview verification, merge, and public verification as defined by the spec. A success treatment must follow the recorded result. Existing approval checks and revision handling remain intact; styling never implies a group is approved or verified early.
- Reserve space for updating values and keep review items stable while reading. Put diagnostic identifiers in the existing expandable evidence area. Fictional/local and fixture/evaluation labels remain visible.

## Required verification

Follow the demo-priority cadence in [BUILD_PLAN.md](../BUILD_PLAN.md). During demo development, check the changed desktop/mobile view, focus and overflow once, and reuse unchanged evidence. The full checklist below is for release acceptance or a concrete regression affecting those states. Repeat only checks invalidated by a fix; documentation-only edits use diff/link checks.

1. Run `npm run ui:check`, `npm run typecheck`, and the relevant tests. `npm test` and `npm run build` also run the static UI check automatically. A newly added lint rule needs a failing example and a passing counterexample.
2. Inspect the affected screen at 1440px and 375px widths; spot-check 320px and text zoom when text/layout changes. Check long content and actual populated groups, not only the empty screen. Save before/after screenshots for visual changes.
3. Tab through the changed controls, verify the skip link and visible focus, and activate keyboard controls without motion. Check pointer hover/press, disabled controls, and reduced motion. Confirm page overflow is absent and targets remain usable on touch.
4. For changes to shared console styles, inspect initial, collecting, sealed, withheld/ambiguous, failed publication, failed verification, and verified states. Use isolated API fixtures for visual states; do not approve live groups or count fixture observations as publication proof.
5. Report changed files, checks/results, screenshots or fixture states, and remaining gaps. UI reviews use an actual `Before | After | Why` Markdown table. Visual verification does not satisfy any provider, publication, timing, or rehearsal gate.

`scripts/check-ui.ts` is a focused CSS regression check, not a taste or accessibility certificate. It catches source patterns for broad/layout transitions, slow or unresolved timing, zero-scale entries, ungated motion/hover, unsafe press selectors, font drift, tiny literal type, removed outlines, and decorative gradients/blur/text shadows. Browser inspection must still establish computed contrast, cascade/layout, focus behavior, accessible names, and truthful state presentation. Inline styles, generated utilities, and animation libraries also need review. Keep future styles in the scanned CSS files rather than using another styling channel to evade the check.

The source check deliberately requires a transition property in the same rule as a duration override and explicit full selectors for press exclusions; it does not resolve selector inheritance through native CSS nesting. Keep visible outlines even when adding another focus treatment. The font-size floor detects literal px/rem values (assuming the default root size); computed sizes need browser review.
