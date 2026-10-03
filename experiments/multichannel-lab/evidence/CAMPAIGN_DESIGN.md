# Designed campaign verification - 2026-10-03

Scope: isolated multichannel lab only. Six new fictional campaign assets replace the bare fixtures as the built-in visual demo. The frozen regression corpus and core launch sources are unchanged. No publication or live-agent claim is made.

| Before | After | Why |
|---|---|---|
| Plain fixture text and a prominent synthetic-fixture banner | Coordinated forest/ivory/citrus campaign, original imagery, editorial typography | Assets resemble usable marketing work while retaining a small fictional label |
| Email styling and imagery stripped from every preview | Allowlisted inline formatting and validated embedded raster images | Users can inspect a recognizable design with scripts and external requests disabled |
| Opening an email implicitly selected its subject and jumped to metadata | Opening an asset shows the design; explicit finding selection jumps to its location | Review begins with the actual asset |
| Long lists of technical OCR warnings above the source | Visible partial-coverage notice plus accessible coverage disclosure | Keep limitations available without burying the design |
| 28px-wide asset-selection targets | 44px-wide targets | Improve touch selection |

## Executed checks

- `npm run build`: passed typechecking and existing UI guardrails, including the final touch-target change.
- `npm test`: 66/66 passed. Includes three new safe-formatting and embedded-raster tests, original extraction tests, isolation, freshness, agent contracts, and launch handoff checks.
- Original regression: `lab_18bc0294-fed2-4f5c-9d16-1953bf68d785`, 12 assets, 65/65 expected occurrences.
- Final campaign evaluation: `lab_e4cb1f1c-dfd9-498f-9cce-0725087e79a0`, 6 assets, 17/17 expected occurrences, 123 accounted blocks. Initial passing run `lab_ea664185-d8cb-41bf-bb99-cf8ad6900b89` retained.
- Live local deterministic scan: `lab_0ceefe60-14da-4f9a-95e6-efe3e66d19cf`, 6 assets, 123 checked blocks, 8 suggestions, 5 unresolved. No provider/model call was made for this scan.
- Original fixture manifest SHA-256 remains `1d48d9a5c3a1307caead6a3a461dce352fcdc04a3ab31d40ef81266abf845e10`; the unchanged-source fixture test passes.
- Deck package integrity, geometry, chosen fonts, and PPTX re-import passed. All five PDF pages inspected. PowerPoint itself was not used.

## Bounded implementation review

Independent review identified highlight contrast and evaluation path confinement. Both were resolved: highlighted source spans receive a dark foreground; evaluation reads pass through the same path/symlink confinement as the importer. The final build and both evaluations were rerun. Browser inspection subsequently found implicit metadata selection; this was fixed and the affected source-opening and finding-selection states rechecked. Mobile inspection then found that `overflow-wrap:anywhere` shrank the email wordmark table cell and wrapped its period. Changing the preview to `break-word` fixes both 341px and 286px inner widths without changing frozen asset bytes. The extractor was versioned to v4 and assets were reimported into `campaign-review-final`. One test initially failed because it still asserted the v3 version string; that assertion was updated and the full 66-test suite passed. Both corpus evaluations were rerun after the rendering change. Earlier runs and before screenshots remain retained. No active-content/CSP bypass was identified.

## Browser evidence

The actual local lab imported all six assets through the **Load designed campaign** button. Desktop checks use a 1440px viewport. Source opening, deck slide navigation, source-location selection, and protected legacy copy were exercised against real imports and the local scan. Screenshots are in [campaign-design](campaign-design/), including the original plain email, designed emails, deck, and highlighted source. Separate native-email screenshots and width checks are in `../showcase/emails/evidence/`.

Final mobile and accessibility results are recorded in `campaign-design/mobile-checks-final.json`: both emails at 375px and 320px show intact wordmarks and no horizontal page overflow; all six selection targets are 44px square. Skip-link focus, keyboard coverage disclosure, and reduced motion pass. The 200% text check covers console reflow only; fixed-pixel email iframe typography and raster text were not enlarged. Before/final screenshots are retained. The final source-opening change leaves all locations and counts intact and does not invoke a model. CSP continues to block scripts, forms, navigation, and network-loaded email images. Allowed embedded imagery remains explicitly outside complete text coverage.

## Remaining limitations

Both named evaluations and the UI scan correctly report partial coverage. Five campaign assets have visual/OCR omissions; the plain legacy email has complete text extraction. Two deck pricing blocks (standalone Team price and the display “20%”), two general pricing phrases, and a spurious OCR region are withheld/unresolved. These are not repaired by inference. The demo does not provide native creative write-back or send/publish any asset. No core launch, timing, scale, deployment, or rehearsal gate credit is claimed.
