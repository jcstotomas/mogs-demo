# MOGS campaign deck

Five slides for the fictional MOGS team scheduling campaign. The editable presentation and importable PDF are in `files/`. The new campaign is separate from the frozen regression fixtures and provides no production launch gate credit.

The deck uses an original generated campaign scene, Georgia headlines, Arial supporting text, and forest, ivory and citrus colors. All slide copy remains editable. The PDF retains a selectable text layer. Original image: `../campaign-hero.png`; generation provenance is maintained by the campaign coordinator.

Pricing intentionally represents the source offer before the Starter monthly change. Four supported claims should receive checked suggestions: direct monthly price, monthly plan gap, annual savings, and per-day price. Annual price remains unchanged. Standalone Team price and the large `20%` display numeral are intentionally withheld by the current narrow rule engine. Their context appears on the slide, but line-based extraction does not establish a supported repair for those individual text blocks. These are declared expectations, not a claim of complete semantic analysis.

`manifest.fragment.json` records all seven pricing occurrences, expected labels, and the PDF byte hash. Expectations were set from the explicit rule contract before the showcase evaluation. The PDF is five pages and 379,108 bytes. A cover image is rendered but not interpreted by the PDF text extractor; the normal partial-coverage warning remains applicable.

## Build and verification

Builder: `../../scripts/build-showcase-deck.mjs`. It uses the bundled `@oai/artifact-tool` for PPTX and the bundled office binary for PDF conversion. It intentionally refuses to overwrite an existing finalized PPTX. Revise the destination before producing a new version, then freeze the new bytes and expectations independently.

Bundled office path: `/Users/jeremy/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/soffice`. Do not substitute the user's installed desktop LibreOffice.

Package integrity, geometry, chosen-font policy and first-party PPTX re-import passed without findings. Native text rendering and final PDF pages were inspected individually at 1280 x 720. PDF extraction preserved each complete pricing sentence on its own line. The PDF contains a harmless text-layer duplication in the word “little” on page two; the visible slide renders correctly and pricing text is unaffected. PowerPoint itself was not used for verification.

Private validation receipts and draft are under `.build/`. Final PDF renders and contact sheet are under `rendered/` for visual evidence.
