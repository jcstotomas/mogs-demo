import { hashRecord, sha256 } from '../hash';
import { CheckNameSchema, type Check } from '../types';
import { RemoteExportSchema, SubmissionSchema, type DeploymentObservation, type RemoteExport, type Submission } from '../runs/remote-types';
import { checkedPatchHash } from './candidate';

const same = (left: unknown, right: unknown) => hashRecord(left) === hashRecord(right);
const cell = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\\', '\\\\').replace(/([`*_\[\]{}])/g, '\\$1').replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');
const inlineCode = (value: string) => {
  const text = value.replace(/\r\n?|\n/g, ' '), fence = '`'.repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length)) + 1);
  const padded = text.startsWith('`') || text.endsWith('`') ? ' ' + text + ' ' : text;
  return fence + padded + fence;
};
const money = (cents: number) => '$' + (cents / 100).toFixed(2).replace(/\.00$/, '');
const checksText = (checks: Check[]) => `${checks.filter(check => check.pass).length}/${checks.length} passing (${checks.map(check => check.name).join(', ')})`;

/** A description is evidence presentation; it cannot authorize a status or merge. */
export function buildPullRequestDescription(input: RemoteExport, submitted: Submission, marker: string): string {
  const state = RemoteExportSchema.parse(input), submission = SubmissionSchema.parse(submitted), { candidate } = submission;
  const { attempt, run } = state;
  const expectedMarker = `<!-- mogs-operation:${submission.operationId};attempt:${submission.launchAttemptId};bundle:${candidate.bundleHash} -->`;
  if (marker !== expectedMarker || !state.submission || !same(state.submission, submission) || submission.runId !== run.id || submission.launchAttemptId !== attempt.id || run.launchAttemptId !== attempt.id || candidate.runId !== run.id || candidate.launchAttemptId !== attempt.id || candidate.purpose !== attempt.purpose || candidate.baselineHash !== attempt.baselineHash || candidate.baseSha !== attempt.baseline.baseSha || candidate.desiredFactsHash !== attempt.desiredFactsHash || !candidate.candidateSha) throw new Error('PR description requires the exact durable submission, attempt and candidate.');
  const before = state.facts.find(fact => fact.phase === 'before'), desired = state.facts.find(fact => fact.phase === 'desired');
  if (!before || !desired || before.launchAttemptId !== attempt.id || desired.launchAttemptId !== attempt.id || before.hash !== attempt.beforeFactsHash || desired.hash !== attempt.desiredFactsHash || hashRecord(before.snapshot) !== before.hash || hashRecord(desired.snapshot) !== desired.hash) throw new Error('PR description facts differ from the captured before/desired snapshots.');
  const groups = candidate.approvals.map(approval => {
    const group = state.groups.find(value => value.id === approval.groupId), recorded = state.approvals.find(value => value.id === approval.id);
    const patches = approval.eligibleIds.map(id => state.patches.find(value => value.id === id));
    if (!group || !recorded || !same(recorded, approval) || !['approved', 'submitted'].includes(group.status) || group.launchAttemptId !== attempt.id || group.runId !== run.id || group.approvalId !== approval.id || group.revision !== approval.revision || group.membershipHash !== approval.membershipHash || !same([...group.eligibleIds].sort(), [...approval.eligibleIds].sort()) || approval.desiredFactsHash !== desired.hash || patches.some(patch => !patch) || approval.checkedPatchHash !== checkedPatchHash(patches as NonNullable<typeof patches[number]>[])) throw new Error('PR description approvals differ from their complete checked groups.');
    return { group, approval, patches: patches as NonNullable<typeof patches[number]>[] };
  });
  const approvedIds = groups.flatMap(value => value.approval.eligibleIds), patches = groups.flatMap(value => value.patches);
  if (candidate.purpose === 'correction') {
    if (run.status !== 'ready' || run.errors.length || !groups.length || new Set(approvedIds).size !== approvedIds.length || !same(state.groups.filter(group => group.eligibleIds.length).map(group => group.id).sort(), groups.map(value => value.group.id).sort()) || !state.candidateChecks || !same(Object.keys(state.candidateChecks).sort(), [...approvedIds].sort())) throw new Error('PR description requires the complete checked correction bundle.');
    for (const patch of patches) {
      const proof = state.candidateChecks[patch.id], original = state.judgments.find(value => value.passageId === patch.passageId);
      const asset = attempt.baseline.assets.find(value => value.assetId === patch.assetId);
      if (patch.runId !== run.id || patch.launchAttemptId !== attempt.id || patch.status !== 'drafted' || !patch.replacement || !original || original.label !== 'contradicting' || !asset?.editable || !asset.path || !candidate.files.some(file => file.path === asset.path) || !proof || new Set(proof.map(check => check.name)).size !== proof.length || proof.some(check => !check.pass) || CheckNameSchema.options.filter(name => name !== 'tokens_kept' || patch.surface === 'email').some(name => !proof.some(check => check.name === name && check.pass))) throw new Error('PR description lacks an approved location or complete combined checks.');
    }
  } else if (!attempt.seedRevision || groups.length || state.groups.length || state.patches.length || Object.keys(state.candidateChecks ?? {}).length) throw new Error('Restoration description requires an exact seed attempt with zero correction credit.');

  const fixture = run.mode !== 'live' || candidate.approvals.some(approval => approval.actor === 'test') ? '**Fixture/test evidence. This description supplies no live repair or human review credit.**\n\n' : '';
  const sketch = `\`\`\`diff\n- Starter monthly: ${money(before.snapshot.plans.starter.monthlyCents)}\n+ Starter monthly: ${money(desired.snapshot.plans.starter.monthlyCents)}\n\`\`\``;
  const lines = ['## Summary', '', fixture + sketch, '', candidate.purpose === 'restoration'
    ? `Restore the exact frozen seed at \`${attempt.seedRevision}\` in ${candidate.files.length} mapped source/fact files. Restoration contributes zero correction repairs.`
    : `${groups.length} approved complete correction groups combine ${patches.length} checked edits with the deterministic \`data/facts.json\` update in one candidate.`, '', '## Evidence', '',
    `- **Before:** deployed Starter monthly ${money(before.snapshot.plans.starter.monthlyCents)}, fact version ${before.version}; base \`${candidate.baseSha}\`, deployment ${inlineCode(attempt.baseline.deploymentId)}.`,
    `  **After:** checked candidate Starter monthly ${money(desired.snapshot.plans.starter.monthlyCents)}, fact version ${desired.version}; candidate \`${candidate.candidateSha}\`. Public publication follows a separate human GitHub merge.`, '',
    `Run: ${inlineCode(run.id)} · attempt: ${inlineCode(attempt.id)} · ${attempt.baseline.assets.filter(asset => asset.surface === 'web').length} web assets including canonical pricing + ${attempt.baseline.assets.filter(asset => asset.surface === 'email').length} email previews.`,
    `Judge: ${cell(run.config.adapter ?? 'unavailable')}/${cell(run.config.judgeModel)} · prompt ${cell(run.config.promptVersion)}. Original Confirm: ${run.confirmedAt}. First complete group: ${run.stats.firstSealedGroupMs ?? 'unavailable'} ms; all results ready: ${run.stats.allResultsReadyMs ?? 'unavailable'} ms.`, '',
    `Facts: \`${before.hash}\` → \`${desired.hash}\`. Bundle: \`${candidate.bundleHash}\`. Mapped tree: \`${candidate.treeHash}\`.`, ''];

  for (const { group, approval, patches: members } of groups) {
    lines.push(`### ${cell(group.title)}`, '', `Approval: ${approval.actor} · revision ${group.revision} · ${approval.at}. Excluded members: ${group.excludedIds.length}.`, '', '| Location | Before | After | Combined checks | Factual rationale |', '|---|---|---|---|---|');
    for (const patch of members) {
      const asset = attempt.baseline.assets.find(value => value.assetId === patch.assetId)!;
      lines.push(`| ${cell(asset.path! + '#' + patch.sourceId)} (${patch.surface}) | ${cell(patch.original)} | ${cell(patch.replacement!)} | ${cell(checksText(state.candidateChecks![patch.id]))} | ${cell(patch.rationale!)} |`);
    }
    for (const id of group.excludedIds) {
      const excluded = state.patches.find(patch => patch.id === id);
      lines.push(`Excluded: ${cell(excluded ? excluded.assetId + '#' + excluded.sourceId + ' — ' + (excluded.withholdReason ?? excluded.status) : id)}.`);
    }
    lines.push('');
  }

  lines.push('### Exclusions and preservation', '');
  const excluded = state.patches.filter(patch => !approvedIds.includes(patch.id));
  if (excluded.length) for (const patch of excluded) lines.push(`- ${cell(patch.assetId + '#' + patch.sourceId)}: ${cell(patch.status)} — ${cell(patch.withholdReason ?? patch.rationale ?? 'Excluded from this checked candidate')}.`);
  else lines.push('- No excluded correction patches.');
  const labels = ['consistent', 'valid_exception', 'unrelated', 'insufficient_context'] as const;
  lines.push(`- Classified exclusions: ${labels.map(label => `${state.judgments.filter(value => value.label === label).length} ${label}`).join('; ')}. Lexically excluded blocks: ${run.filteredPassageIds.length}.`);
  if (candidate.purpose === 'correction') lines.push('- Applicable paired source/context, numeric, qualifier, fact and email-token checks passed for every included edit. Protected blocks remain unchanged; email preview publication does not send messages.');
  for (const asset of attempt.baseline.assets.filter(asset => asset.path && !candidate.files.some(file => file.path === asset.path))) lines.push(`- Unchanged source: ${cell(asset.path!)} · SHA-256 \`${asset.sourceHash}\`.`);
  if (candidate.purpose === 'restoration') lines.push(`- Exact seed/preservation checks bind the mapped sources and canonical facts to \`${attempt.seedRevision}\`; no model classification, correction approval or repair metric is credited.`);

  const preview = matchingVerifiedPreview(state, submission);
  lines.push('', '### Deployment evidence', '', preview
    ? `- **${fixture ? 'Fixture' : 'Verified'} preview:** [matching candidate preview](${new URL(preview.url).href}) · deployment ${inlineCode(preview.deploymentId)} · observed ${preview.observedAt}; ${preview.blocks.length} changed blocks passed fresh rendered checks, complete source preservation and canonical pricing.`
    : '- Matching verified preview is not recorded. A PR or successful build alone supplies no rendered verification.');
  const production = state.observations.filter(observation => observation.environment === 'production' && observation.launchAttemptId === attempt.id && observation.submissionId === submission.id && observation.candidateSha === candidate.candidateSha).at(-1);
  if (production) lines.push(`- Recorded production: deployment ${inlineCode(production.deploymentId)}, merged commit \`${production.mergedSha ?? 'unavailable'}\`; build ${production.readiness}, rendered verification ${production.verification}, observed ${production.observedAt}.`);
  else lines.push('- Human GitHub merge and matching public deployment verification are separate publication steps.');
  lines.push('', '## Merge Danger', '', '**Door:** two-way', '', 'Publication can be reversed through a separately checked, human-merged seed-restoration PR.', '', '**Blast Radius:** Content', '', 'Controlled fictional web pages, canonical pricing and repository-backed email previews.', '', marker, '');
  const body = lines.join('\n');
  if (Buffer.byteLength(body, 'utf8') > 65_536) throw new Error('Complete PR evidence exceeds the GitHub description limit.');
  return body;
}

function matchingVerifiedPreview(state: RemoteExport, submission: Submission): DeploymentObservation | null {
  const { candidate } = submission, { attempt } = state;
  const preview = state.observations.filter(observation => observation.environment === 'preview' && observation.launchAttemptId === attempt.id && observation.submissionId === submission.id && observation.candidateSha === candidate.candidateSha).at(-1);
  if (!preview || preview.readiness !== 'ready' || preview.verification !== 'passed' || preview.failures.length || preview.deployedSha !== candidate.candidateSha || preview.mergedSha !== null || !preview.publishedFacts || preview.factsHash !== candidate.desiredFactsHash || hashRecord(preview.publishedFacts) !== candidate.desiredFactsHash) return null;
  const url = new URL(preview.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
  const assets = attempt.baseline.assets.map(asset => ({ ...asset, sourceHash: asset.path ? candidate.files.find(file => file.path === asset.path)?.afterHash ?? asset.sourceHash : candidate.desiredFactsHash }));
  if (!same(preview.sourceHashes, Object.fromEntries(assets.map(asset => [asset.assetId, asset.sourceHash]))) || preview.inventoryHash !== hashRecord(assets)) return null;
  const patches = candidate.approvals.flatMap(approval => approval.eligibleIds).map(id => state.patches.find(patch => patch.id === id)!);
  if (!same(preview.blocks.map(block => block.passageId).sort(), patches.map(patch => patch.passageId).sort())) return null;
  for (const patch of patches) {
    const block = preview.blocks.find(value => value.passageId === patch.passageId)!, judgment = block.judgment;
    if (!block.pass || !block.sourceObserved || block.observedHash !== sha256(patch.replacement!) || !judgment || judgment.runId !== state.run.id || judgment.passageId !== patch.passageId || judgment.factVersion !== state.run.desiredFactVersion || judgment.kind !== patch.kind || judgment.adapter !== state.run.config.adapter || judgment.model !== state.run.config.judgeModel || judgment.escalatedBy !== null || !['consistent', 'valid_exception'].includes(judgment.label) || (judgment.adapter === 'jev' && (judgment.confidence === null || judgment.confidence < state.run.config.tLabel))) return null;
  }
  return preview;
}
