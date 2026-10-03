# Previous numeric-workflow browser observations

These screenshots preserve the earlier frontend, before the user requested a natural-language agent workflow. They are historical source-review evidence, not final agent-UI evidence.

Browser: Codex in-app browser. Server: port 3211, isolated `ui-review-final` storage; stopped after the workflow changed. Synthetic demo imported all 12 real files (four HTML emails, four PDFs, four creatives). The run completed with partial coverage: 112 extracted/checked units, 18 suggested copies, and 18 unresolved units. Real HTML extraction, PDF text/rendering, and local image OCR supplied the previews.

Observed:

- Empty and importing desktop states captured at 1440px.
- Email finding selected the exact body occurrence `Hello {{ first_name }}, Starter is $30 a month.`; the sandboxed preview highlighted that occurrence, and the suggestion retained the literal template token.
- The repeated direct-price claim on PDF page 2 selected page 2 and its correct bounding box.
- Creative per-day claim selected its correct OCR image region.
- Eligible legacy email claims showed protected-exception status without proposed copy; unknown-eligibility creative showed an unresolved label and explicit withholding reason.
- Measured document width equaled viewport width at 1440, 375, and 320px; no horizontal document overflow occurred. Narrow layout screenshots are included.
- Browser error/warning log was empty in the initial/importing checks.

Limitations: a browser download-event wait stalled and was interrupted. Export download UI completion is not claimed. Keyboard, reduced-motion preference emulation, stale, parser failure, and disabled-state browser checks were not completed for this previous version. None of these observations establish production verification or complete content coverage.

| Before | After | Why |
|---|---|---|
| No lab screen | Source import, complete extracted-unit scan, original preview, and findings | Establish the first local review flow |
| Paired emails shared the same visible title | Original filenames accompany titles | Distinguish context-dependent email decisions |
| Deep findings scrolled away from the source | Desktop source panel stays beside the active finding | Compare the reviewed copy and exact occurrence |
| Bounding-box border covered small rendered text | Outward outline marks image regions | Preserve legibility of the underlying source |

The natural-language composer and final agent evidence are recorded separately in the parent browser evidence directory.
