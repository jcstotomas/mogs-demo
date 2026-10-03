# Console clarity review

The October 3 review simplifies the local console for sales and marketing readers. Open [campaign review](http://localhost:3110/console/campaign). The existing website approval workflow remains available from **Continue website review**.

| Before | After | Why |
|---|---|---|
| Source counts, implementation details, and the full agent response filled the initial screen. | A concise launch summary leads to the website review; the completed campaign check leads to flagged items. Supporting information is expandable. | Readers can find their next action quickly. |
| Corrected, protected, unrelated, and uncertain blocks all appeared in the findings list. | Suggested changes and items needing a decision appear first. Unchanged content is available through a labeled disclosure. | Focus attention on the copy that needs review. |
| Eligibility, revision, and PR inclusion terms dominated approval controls. | Current and suggested copy sit beside **Approve these changes**. GitHub review and human publication remain separate steps. | Explain the decision in familiar language while preserving its actual effect. |

## Current demo walkthrough

1. Use the saved completed campaign check. It contains eight suggested changes, five unresolved items, and six imported assets. Its **partial coverage** notice remains visible.
2. Select an asset with a flagged count. Compare **Current copy** and **Suggested copy**, then choose **View in original** to locate the claim.
3. Review **Needs your decision** items before changing the source. Open **Why this change?** for supporting checks and evidence.
4. Expand **Show unchanged content** to inspect protected legacy claims and other preserved content.
5. Use **New check** to enter another request. This starts a new provider request only after choosing **Check campaign**.
6. Continue the website review, compare its checked corrections, and approve the groups you want included. **Create GitHub review request** prepares the combined website update. A human merge and the live site check follow separately.

Imported campaign results are suggestions; this interface does not edit, approve, publish, or send those assets. Incoming-PR staging remains a separately planned extension.

## Verification

The UI pass reuses the saved campaign result and current website attempt. No provider request, group approval, submission, or merge was performed. Root typecheck, the campaign app build, the lab build/UI guardrails, and JavaScript syntax checks passed. The desktop walkthrough confirmed flagged findings, expandable unchanged content, source highlights, enabled website approval controls, visible 3px keyboard focus, and no horizontal overflow. The user explicitly cut mobile testing during this pass; it was not completed or counted. Existing filesystem tracing warnings remain non-blocking. This review does not establish release acceptance or public deployment.

Screenshots: [before campaign](ui/campaign-integration/before-clarity-desktop.png), [after flagged items](ui/campaign-integration/after-clarity-flags-desktop.png), [before website](ui/campaign-integration/before-clarity-website.png), [after website decision](ui/campaign-integration/after-clarity-website-decision.png). Measurements are recorded in [clarity checks](ui/campaign-integration/clarity-checks.json).
