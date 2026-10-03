# MOGS parallel multichannel build plan

Build an isolated experiment for email templates, sales decks, and static creative while the required deployed demo proceeds. Its first deliverable is a working import → contextual claim check → source preview → suggested correction flow for all three surfaces. Development can start independently; integration into the main application has a separate gate.

**Status:** implementation exists on `codex/multichannel-lab` at `b3e9404`. On October 3, 2026 the user authorized early integration for the local demo MVP and minimum viable development checks. Named lab evidence stays with the package; this document does not pass the broader release gates.

[SPEC.md](../SPEC.md) remains authoritative for the required deployed demo. [BUILD_PLAN.md](../BUILD_PLAN.md) owns core lane dispatch and links this independent lane. The experiment contributes no assets, approvals, timings, or results to the required 20 web pages plus two emails or the subsequent 180 web pages plus 20 emails. Existing evidence and gate status remain unchanged.

## First deliverable

A reviewer imports an asset and supplies its audience context, chooses an immutable before/desired fact snapshot, and receives findings attached to exact source locations. The reviewer can inspect the original content, rationale, proposed copy, checks, and unresolved issues, then export a report. Original files remain unchanged. Reports identify themselves as experimental suggestions, with no publication or approval-for-launch status.

| Surface | First supported input | Source location and review | Explicit boundary |
|---|---|---|---|
| Email | UTF-8 HTML export with a metadata sidecar for subject, preheader, audience, and eligibility; optional plain-text variant | Subject/preheader field or DOM text block, with surrounding copy and a sandboxed preview | Preserve literal template tokens and URLs. Unresolved conditional branches withhold definitive corrections. Importing a template never sends or activates email. |
| Sales deck | Text-bearing PDF exported from a deck | Page, text region, bounding box, and full-page preview, including visible headings and footnotes | Location refers to the PDF revision. Native slide objects, speaker notes absent from the export, embedded chart data, and PowerPoint editing are outside this adapter. |
| Static creative | PNG or JPEG with optional campaign/audience metadata | Extracted text region over the original image, with the entire creative available for context | Real OCR or vision extraction is required. Blurry or unsupported regions remain unresolved. Output is annotated suggestions, without image regeneration or native layer edits. |

A format is advertised as supported only after its real parser/extractor and end-to-end gate pass. Scanned PDF pages and visual claims without reliable extraction produce partial coverage; an empty extraction is not a clean audit. Video, arbitrary websites, mailbox ingestion, automated sending, ad activation, and continuous monitoring are outside this first deliverable.

## Parallel ownership and isolation

Keep the existing A/B/C core builders and coordinator. Assign one independent **L lab builder** initially, with one bounded review at each milestone. This is a separate product experiment, not another required-demo builder. Additional delegation must divide L's owned paths explicitly.

| Owner | Assigned paths and responsibilities |
|---|---|
| L lab builder | `experiments/multichannel-lab/**` in a separate worktree: package and lockfile, local configuration, versioned contracts, adapters, worker, review UI, fixtures, tests, and redacted evidence. |
| Coordinator | `SPEC.md`, `BUILD_PLAN.md`, this plan, and any eventual root configuration, shared contract, API, database, dependency, or deployment changes. Approves the integration boundary after reviewing executable evidence. |
| Existing A/B/C builders | Existing paths in the core build plan. The lab creates no new dependency for their milestones. |

At implementation kickoff, reuse a suitable isolated worktree or create one from the current committed development baseline containing this plan; record its exact SHA. Use `codex/multichannel-lab` if a new branch is needed. Keep the worktree outside the primary checkout so the root TypeScript glob cannot discover its files. Preserve the primary checkout's uncommitted work and the separate public source checkout.

The lab is a self-contained package with its own build, tests, local server port, and worker. Its runtime files live under its ignored `.runtime/` directory, with separate originals, previews, SQLite database, index, and report exports. Only synthetic fixtures and redacted gate evidence belong in Git. Resolve storage paths within that root and reject paths or symlinks that escape it or point at core data. Lab reset operates only on this root and preserves named evidence exports.

Use an explicit, immutable copy of the existing fact fixtures or a coordinator-provided fact export. Record origin and hash; the lab never reads mutable desired/deployed state. Use lab-specific contract and run identifiers. Avoid imports of the live coordinator, database, worker, publication, submission, or deployment services. Reuse behavior through documented contracts and parity fixtures until the coordinator extracts any shared pure code.

The current root TypeScript configuration includes nested TypeScript files, and the content catalog discovers active source directories. For the approved local MVP integration, root TypeScript excludes `experiments/**`; the lab runs in a separate local Node process with its own state, and root/public artifacts exclude lab files. Lab fixtures stay inside the lab package. A disabled flag alone does not isolate compilation, dependency resolution, corpus discovery, or state.

Run fixture work freely in the lab. Live model/OCR work uses explicit lab configuration, a separate bounded queue, concurrency one initially, and recorded call/token/cost caps. Suspend lab calls while core timing runs use the same provider quota, unless separate capacity has been established. Provider errors remain errors. No launch GitHub or deployment credentials are loaded by the lab.

## Feature flag behavior

Use one server-side flag: `MOGS_MULTICHANNEL_ENABLED`. Only the exact value `1` enables the experiment; missing, empty, `0`, and unknown values disable it. The flag is a capability switch, not authentication. The first lab server binds to loopback and follows the existing local-request restrictions; hosting it for other users requires a separate access-control design.

Check the flag before body parsing or file persistence, database/index creation, provider initialization, queue dispatch, and every worker job. Disabled UI/API routes return 404; disabled CLI commands exit with a clear disabled result. A navigation-only flag or browser environment variable does not satisfy this boundary. A worker cannot accept jobs through a route that bypasses the gate.

Environment changes take effect on process restart. To disable the lab, stop its server and worker, cancel/drain pending work, and restart with the flag off. A provider request already sent may finish; discard late results after cancellation and prevent further calls or result writes. Preserve existing evidence. Do not describe a deployment-time environment switch as an instantaneous kill switch.

## Experimental contracts

Freeze executable schemas and fixtures within the lab before implementing consumers. These are separate from the core `web | email` surface enum and the existing v2 launch records.

| Record | Required fields or behavior |
|---|---|
| AssetRevision | Lab asset identity, original filename, detected media type, original bytes hash, revision, import timestamp, extractor/version, source provenance, and supported capabilities. Reimporting identical bytes and metadata is idempotent. Changed bytes or metadata create a new revision. |
| ContentUnit | Asset revision, unique unit ID, exact extracted text, typed locator, neighboring text/full-page context, text/context hashes, extraction method, and nullable provider-reported confidence. Identical sentences in different locations remain distinct units. |
| Context | Audience, eligibility, journey/campaign, date and region where supplied, with provenance such as user-supplied, extracted, or unknown. Preserve explicit passage scope; conflicts or missing eligibility remain unresolved. |
| Coverage | Planned and processed assets/pages/variants, located units, warnings, unsupported regions, typed failures, and partial/complete status. Every imported item receives a terminal accounting record. Missing content cannot disappear from denominators. |
| LabRun | Frozen input revisions, fact snapshot hash, extraction/model/prompt/configuration versions, mode, timings, usage, errors, and lab-only status. Test-provider output is explicitly fixture evidence. |
| Finding | Source unit and locator, fact dependency, contextual label, rationale, optional suggested copy, applicable check results, and withholding reason. Findings bind source, context, facts, and run revisions. |

Locators are revision-bound: email field/DOM path plus text span; PDF page/bounding box plus text span; image region coordinates. Use extracted text hashes to validate each occurrence. OCR output is an observation, not an editable source layer. Changed content, extraction configuration, context, or facts invalidates affected findings and review readiness.

Classify against approved structured facts and deterministic derived values. Preserve the existing five semantic outcomes and uncertainty behavior. Import content supplies evidence only; instructions found inside a document cannot change facts, permissions, or workflow. Suggest copy only for unambiguous contradictions with supported repair targets. Validate numbers/units, qualifiers, source/context freshness, token/link preservation, and contextual consistency before marking a suggestion checked. Unsupported repair kinds remain withheld.

Start with a complete scan of the small frozen lab corpus. Embeddings are optional candidate retrieval infrastructure and never the fact source, edit address, or evidence of complete coverage. Any prefilter accounts for excluded units; final audit readiness cannot depend only on a top-k search result.

## Milestones and completion gates

All gates below start **not run**. Each milestone ends with focused checks, its applicable integrated checks, and one bounded implementation review. Fix concrete findings and rerun affected checks. The lab can advance independently of the core; its gate results neither satisfy nor block a core Remote gate.

| Gate | Deliverable | Completion evidence |
|---|---|---|
| L0 isolation and contracts | Separate worktree/package, scoped runtime paths, feature gate, fact import, schemas, and adapter interfaces | Record base SHA and owned paths. With the flag off, UI/API/CLI/worker probes cause zero asset reads/writes, DB/index initialization, model calls, or jobs. Prove path confinement, no live-service imports, and no primary-checkout changes. |
| L1 real extraction | Implement email, then PDF, then static image adapters and original previews | Actual HTML/PDF/image files pass through real parsers. Record deterministic locations, context, source hashes, and full coverage accounting. Error fixtures produce explicit failures. A real OCR/vision smoke run is mandatory for creative support; mocks pass only fixture checks. |
| L2 contextual analysis | Full scan, contextual classification, checked suggestions, and immutable reports | On the frozen supported fixture set, locate every planted in-scope claim and produce all expected classifications; all deterministic repair examples have correct checked suggestions. Zero suggestions on protected or unresolved ambiguous cases, including later-withheld drafts. Record every failure and per-surface denominator. |
| L3 review and export | Local review UI showing original location, context, proposed copy, rationale, checks, and partial/failure states | One end-to-end real extraction/analysis/review/export flow per supported format. Source bytes stay unchanged. Browser evidence proves correct highlighted occurrences and truthful states. Changed revisions invalidate findings. Exported reports contain provenance, counts, omissions, and a lab-only label. |
| L4 retrieval experiment | Optional full-scan versus lexical versus hybrid comparison | Freeze labels and configurations before comparison. Report detection/repair outcomes, protected proposals, false negatives, coverage, latency, and cost on the same inputs. Adopt embeddings only for a demonstrated benefit with no regression in the frozen checks. This gate is optional and does not delay L3. |
| L5 main application integration | Coordinator-owned integration proposal and tested default-off patch | For the user-approved local MVP, integration may precede deferred Remote 3 release checks. Preserve the core attempt and inventories; run root typecheck, the changed app/lab build, one focused flag/proxy/import check and one changed UI walkthrough. Keep existing broader evidence separate, record the exact integration and enable only the local opt-in entry point. Full release acceptance remains deferred. |

L0 must establish an available PDF parser/renderer and OCR/vision path, including dependencies and provider configuration. If a capability is unavailable, retain its blocker and continue independent formats; do not label the three-format milestone complete. Record estimates after this dependency spike rather than inventing a delivery date now.

The user’s October 3 MVP instruction is the coordinated sequencing change permitting early local integration. It preserves the in-progress launch attempt and does not change its publication controls. Further shared semantic contracts and native write-back still require a separate coordinated update.

## Frozen lab fixtures and verification

Use a proposed initial workload of **12 synthetic assets: four email exports, four PDF decks, and four static creatives**, plus separately counted malformed/unsupported inputs. These are planned counts until generated and frozen. Record real files, page/region/unit counts, expected labels, deterministic repairs, protected spans, template families, and hashes before tuning. Include nonzero protection and ambiguity cases on every surface; repeated copy cannot inflate independent coverage.

The fixtures must demonstrate:

- Identical email prices with different explicit eligibility; subject/preheader and plain-text variants; literal template tokens, URLs, Unicode, and an unresolved conditional branch.
- Repeated claims on different PDF pages; multiline text, a price table, a visible footnote exception, and an annual/historical statement that remains correct. Scanned/unsupported pages appear in partial coverage.
- Creative text regions with their qualifiers, a derived pricing claim, and an ambiguous or blurry region that cannot produce a confident correction.
- Deterministic reimport, duplicate identity rejection, changed source/context/facts, and late provider responses after a run was superseded or cancelled.
- Malformed/encrypted files, mismatched media types, explicit file/page/pixel limits, parser/provider timeouts, and restart/retry behavior with no missing accounting records.

Email previews sanitize active content and run in a sandbox with scripts, forms, navigation, and remote network/tracking disabled. Preserve the original separately; preview sanitization must not silently remove extracted claims from the audit. Test the preview boundary and any asset-serving endpoints. Render PDF pages from the actual imported bytes, and retain the original image behind creative overlays.

For UI work, read and apply [FRONTEND_UI.md](FRONTEND_UI.md). Before editing, provide the small file/component plan. Run the UI checker against lab styles with a coordinator-reviewed lab-local configuration or equivalent invocation; keep root guardrails unchanged. Capture populated email/deck/creative findings, empty/importing, partial/ambiguous, stale, provider/parser failure, and disabled states. Verify desktop/mobile layout, keyboard/focus, reduced motion, long text, and the correct occurrence under overlays. UI review uses the required Before | After | Why table.

Successful fixture gates establish synthetic regression coverage, not customer accuracy or native edit support. Lab latency is measured separately and has no inherited 90/180-second target. Live model and OCR results, fixture results, extraction evidence, and browser observations retain distinct labels.

## Later native sources and editing

After L3, the same isolated lane can take one source at a time through a capability spike and a complete slice:

1. Add a read-only connector for one actual email-template provider and one native deck source. Select the provider from the user's real source system when needed; exported files allow earlier work to proceed. Native Slides/PowerPoint adapters must preserve slide/object identity, notes, tables, revision checks, and rendered context before claiming those capabilities.
2. Produce revised local copies or provider drafts for supported native fields. Compare before/after content and renderings; check token/link preservation, overflow, layout, and untouched regions. A checked text suggestion alone is not a verified edited asset.
3. Design destination-specific approval, write-back, readback, retry, and recovery contracts with the coordinator. A website deployment, template update, and deck revision have independent outcomes; they are not one atomic Git PR. Changed source or candidate invalidates affected approval. Preserve previous failures and attempts.

Native source writes, template activation, ad publication, and email sending remain outside the lab MVP and the current launch authorization. They require explicit product scope and the applicable human publication decision. Embeddings and a connector directory are not prerequisites for the first useful review flow.

## Integration and handoff

Before L5, list each proposed shared change and its caller/fixture impact. The coordinator owns the synchronized contract update; L continues against the lab schema until that handoff exists. Integration must explicitly exclude lab-only source/data/dependencies from public output and handle the root TypeScript/build globs. No experimental migration runs merely because the main app starts.

Flag-off evidence must show unchanged core API behavior, active corpus/sitemap, fact/source hashes, public routes, and asset counts; no lab storage creation, import jobs, provider traffic, or navigation entry appears. Flag-on evidence reruns the supported lab flows in isolated state. Reuse evidence only when its code, source, facts, and configuration bindings remain valid. A lab merge does not retroactively validate a core deployment.

At every handoff provide the worktree/branch and base/current SHA, changed files, schema/fixture hashes, checks and outcomes, real run IDs/counts/timings/costs, sample report and screenshots, and remaining gaps. Preserve failed runs. Describe results as imported, extracted, partially checked, suggested, withheld, or stale as supported by evidence; publication language belongs only to a future observed publication record.

**First dispatch when implementation begins:** assign L to L0, with ownership restricted to `experiments/multichannel-lab/**`. Require executable isolation probes and a schema fixture for each format before moving to parsers. Creating this plan starts no builder implementation and advances no gate.
