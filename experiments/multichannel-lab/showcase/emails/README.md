# MOGS campaign emails

Two designed HTML sources for the separate multichannel showcase, authored October 3, 2026. These files do not replace any asset in the frozen regression corpus.

| Before | After | Why |
| --- | --- | --- |
| Unstyled heading and pricing paragraphs | Fluid 640px editorial layouts, forest/ivory/citrus palette, serif headings and readable body type | Make the imported sources resemble an actual coordinated campaign |
| Repeated regression copy without a visual story | A welcome email with the original generated campaign photograph and a contrasting subscriber reassurance email | Give the two audience contexts distinct intent while retaining paired price semantics |
| Large fixture labels dominating source assets | Quiet fictional campaign footer | Preserve honest provenance without turning each asset into a test card |

`manifest.fragment.json` freezes six pricing occurrences before evaluation: the welcome email has two contradicting monthly-price occurrences and two consistent annual-price occurrences across HTML and plain text; the subscriber email has two protected monthly-price occurrences. Its `filename` fields are safe basenames; `file` fields are relative to the `showcase/` root.

`../campaign-hero.png` is an original generated image provided by the coordinating agent, embedded unchanged as a data URL in the welcome email. It contains no visible text. Its presence still produces the extractor's explicit partial visual-text-coverage warning. The subscriber email contains no image and has complete extraction coverage.

Generate the same source files and hash-bound manifest fragment with `node scripts/build-showcase-emails.mjs` from the lab package root. Do not regenerate after a parent showcase freeze without recording a new revision and rerunning affected checks.

Verification saved under `evidence/`:

- Real local extraction and deterministic pricing checks: 6/6 expected occurrences passed, 45 total text units extracted.
- Browser screenshots at 1440px desktop and 375px mobile for both sources.
- Both sources also checked at 320px: document width equals viewport width, with no overflowing elements. The embedded photograph loaded successfully at 296px wide.
- Generator syntax check passed.

The screenshots show the standalone HTML source. Integrated sandboxed preview, application text zoom, source highlighting, and overall lab typecheck/build remain the coordinator's verification responsibility. No email was sent and no source was published.
