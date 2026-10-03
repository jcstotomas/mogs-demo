# Frozen synthetic multichannel corpus

This is an agent-authored regression corpus for fictional MOGS. It contains actual HTML files, text-bearing PDF exports, and PNG/JPEG images. These assets have never been deployed, activated, or sent. Results establish only the implemented narrow rules on this synthetic corpus; they are not customer accuracy, general semantic judgment, or core launch-gate evidence.

The manifest and twelve input assets were frozen before the first real extraction/analysis evaluation on October 3, 2026. Expected labels and bytes have not been changed to accommodate extraction misses. The manifest SHA-256 is `1d48d9a5c3a1307caead6a3a461dce352fcdc04a3ab31d40ef81266abf845e10`. Each asset hash is stored in `manifest.json`. Re-running the fixture command verifies existing bytes rather than regenerating them.

| Surface | Assets | Pages/images | Expected claim occurrences | Deterministic repairs |
|---|---:|---:|---:|---:|
| HTML emails | 4 | 4 documents | 28 | 8 |
| PDF decks | 4 | 5 pages | 21 | 6 |
| Static creative | 4 | 4 images | 16 | 4 |
| Total | 12 | 13 | 65 | 18 |

There are 19 expected contradictions: 18 amount substitutions and one threshold contradiction with no safe replacement. The other 46 expected occurrences comprise 9 consistent, 11 valid-exception, 10 unrelated, and 16 insufficient-context outcomes. Every surface includes protected and ambiguous cases. Repeated sentences and template duplicates are occurrence coverage, not independent accuracy samples.

`email-new.html` and `email-legacy.html` have byte-identical bodies but opposite explicit eligibility in their sidecars. Subject, preheader, plain text, and body are distinct locations. Match manifest fields to corresponding locator fields; unqualified body expectations must not consume sidecar occurrences. `deck-new.pdf` repeats a direct claim on two pages; both must be accounted for separately. The PDF table is a simple printed price row, not embedded editable chart data. Visible legacy footnotes, historical pricing, annual prices, unknown eligibility, a withheld threshold, unresolved template branches, Unicode, template tokens, and URLs exercise their respective boundaries.

Creative extraction uses real OCR. OCR can omit a terminal period even with otherwise correct claim text; the evaluation separately records exact text equality and permits only whitespace/terminal sentence punctuation normalization for OCR claim matching. It must not invent missing prices or rewrite the frozen source. Images also retain the limitation that undetected text and non-text visual claims cannot be certified as fully audited. Email tracking images remain excluded preview regions with explicit coverage warnings.

`faults/` contains four separately counted bad or unsupported inputs: invalid PDF bytes, HTML bytes disguised with a PNG extension, a blank image, and intentionally unreadable text. They are not part of the twelve-asset/65-occurrence denominator. Further byte/file/page/pixel-limit, encrypted/scanned PDF, cancellation, stale-revision, and parser failure tests are executable adapter/service tests; they must not silently enlarge or replace this corpus.

## Fact provenance

`facts/facts.initial.json` and `facts/facts.confirmed.json` are byte-for-byte copies of the corresponding root fixture files from commit `b9d167987747b1ff171c0ae368e0f98c02f9b2fa`. `facts/provenance.json` records each SHA-256. The lab maps those snapshots to its smaller explicit fact contract and tests parity. It never imports mutable core desired/deployed state.

The canonical cutoff is **2026-10-03T07:00:00.000Z**. The legacy PDF footnote identifies active subscriptions begun before **2026-09-01**, a narrower subset that still qualifies under the canonical cutoff. The original lab default used September 1 before parity validation caught the mismatch; failed/earlier run evidence retains its own actual fact hash. Fresh evaluation uses the aligned immutable facts. The historical fixture explicitly refers to the 2023 launch.

## Authoring and verification

Four PDFs were generated with ReportLab after the PDF skill's required operation marker. Their five real Poppler-rendered pages were visually inspected for readable text, unclipped claims, intact footnotes, and correct page numbers. Source hashes remain unchanged after inspection. Creative originals use large rasterized type and real image bytes; they are not OCR mocks. Fixtures are suggestions-only content and contain no live credentials or customer data.

Set `MOGS_MULTICHANNEL_ENABLED=1` to run the fixture verifier. The generator checks that switch before any asset read/write. Python can be selected with `MOGS_LAB_PYTHON`; otherwise the bundled Codex runtime is used when present, then `python3`. Existing frozen bytes are the reproducible artifact and do not require generation dependencies to verify.
