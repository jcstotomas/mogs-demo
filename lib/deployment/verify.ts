import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { extractRenderedAsset } from '../assets/source';
import { confirmedFacts, targetForKind } from '../facts/derive';
import { hashRecord, sha256 } from '../hash';
import { checkTextChange } from '../pipeline/checks';
import { judge, runtimeProviderConfig } from '../providers';
import { checkedPatchHash, validateMergedTree, type CandidateJudge } from '../submission/candidate';
import { GitHubRemote } from '../submission/github';
import type { PullRequestState } from '../submission/recovery';
import { DeploymentObservationSchema, LaunchAttemptSchema, RemoteExportSchema, ShaSchema, type DeploymentObservation, type LaunchAttempt, type RemoteExport, type Submission } from '../runs/remote-types';
import { FactSnapshotSchema, JudgmentSchema, VerificationSchema, type Check, type FactSnapshot, type Page, type Passage } from '../types';
import { assertAllowedUrl, assertPublicChrome, extractDeploymentMetadata, renderedSourceBody } from './provenance';
import { createDeploymentMetadata, createPublicArtifact } from './public-artifact';
type Verification = z.infer<typeof VerificationSchema>;

/** The hosting adapter obtains this identity from the hosting provider, not page HTML. */
export interface HostedDeployment {
  deploymentId: string;
  url: string;
  deployedSha: string;
  readiness: DeploymentObservation['readiness'];
}
export interface DeploymentHost {
  resolve(input: { environment: DeploymentObservation['environment']; submission: Submission; mergedSha: string | null }): Promise<HostedDeployment>;
}
export interface DeploymentVerificationOptions {
  environment: DeploymentObservation['environment'];
  mergedSha?: string | null;
  host: DeploymentHost;
  /** Exact origins resolved and authorized by the coordinator's hosting adapter. */
  allowedOrigins: string[];
  /** Exact mapped bytes read from the resolved deployment commit, including untouched sources. */
  mappedImages: Record<string, string>;
  seedManifestText: string;
  /** The commit from which restoration's seed manifest and seed facts were read. */
  seedRevision?: string;
  /** Exact generated public-artifact bytes for that commit, including serialization whitespace. */
  artifactText: string;
  judge?: CandidateJudge;
  fetch?: typeof fetch;
  /** Fixture seam only. Live production reads the actual recorded PR from GitHub. */
  readPullRequest?: (submission: Submission) => Promise<PullRequestState>;
  /** Fixture seam only. Live restoration reads these bytes at the pinned Git revision. */
  readSeed?: (revision: string) => Promise<{ seedManifestText: string; seedFactsText: string }>;
  clock?: () => Date;
}
export interface DeploymentVerificationResult {
  observation: DeploymentObservation;
  checks: Record<string, Check[]>;
  evidence: {
    kind: 'live' | 'fixture';
    mappedTreeHash: string;
    factsFileHash: string;
    artifactHash: string;
    observedAssetIds: string[];
    seedRevision: string | null;
  };
}

// A persisted observation remains an audit record. Closing an attempt requires a
// fresh result from this verifier, rather than an arbitrary deserialized record.
const issued = new WeakMap<DeploymentVerificationResult, string>();
function binding(state: RemoteExport): string {
  const { observations: _observations, reviewEvents: _events, ...dependencies } = state;
  return hashRecord(dependencies);
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function withoutTime(page: Page) { const { crawledAt: _time, ...identity } = page; return identity; }

/** Read-only verification. Network and provider failures are recorded as failures, never labels. */
export async function verifyDeployment(input: RemoteExport, options: DeploymentVerificationOptions): Promise<DeploymentVerificationResult> {
  const state = freeze(RemoteExportSchema.parse(input)), { attempt, run } = state;
  if (run.mode === 'live' && (options.judge || options.fetch || options.readPullRequest || options.readSeed)) throw new Error('Live verification must use the real provider and network; injected adapters are fixture-only.');
  const submission = state.submission, candidate = submission?.candidate;
  if (!submission || submission.status !== 'submitted' || submission.journal !== 'pr_opened' || !submission.prNumber || !submission.prUrl || !candidate?.candidateSha || submission.launchAttemptId !== attempt.id || submission.runId !== run.id || candidate.launchAttemptId !== attempt.id || candidate.runId !== run.id || candidate.baselineHash !== attempt.baselineHash || candidate.desiredFactsHash !== attempt.desiredFactsHash || submission.observedHeadSha !== candidate.candidateSha) throw new Error('Verification requires the immutable submitted candidate identity.');
  if (run.mode === 'eval') throw new Error('Isolated evaluation cannot produce deployment evidence.');
  const mergedSha = options.environment === 'production' ? ShaSchema.parse(options.mergedSha) : null;
  if (options.environment === 'production') {
    const remote = new GitHubRemote({ target: attempt.baseline.target, readLocal: () => ({ attempt, submission }) });
    const pr = await (options.readPullRequest ?? (value => remote.readPullRequest(value)))(submission);
    if (pr.number !== submission.prNumber || pr.url !== submission.prUrl || pr.state !== 'closed' || pr.headSha !== candidate.candidateSha || pr.mergedSha !== mergedSha) throw new Error('Production verification requires the recorded PR actually merged with its immutable candidate head and observed merged SHA.');
  }
  const expectedSha = options.environment === 'preview' ? candidate.candidateSha : mergedSha!;
  const at = (options.clock?.() ?? new Date()).toISOString();
  let hosted: HostedDeployment;
  try { hosted = await options.host.resolve({ environment: options.environment, submission, mergedSha }); }
  catch { throw new Error('Hosting adapter could not establish deployment identity.'); }
  ShaSchema.parse(hosted.deployedSha);
  if (!hosted.deploymentId || !['pending', 'ready', 'failed'].includes(hosted.readiness)) throw new Error('Hosting adapter returned incomplete deployment identity.');
  const rootUrl = assertAllowedUrl(hosted.url, options.allowedOrigins);
  if (rootUrl.pathname !== '/') throw new Error('Hosting adapter must resolve an exact deployment origin.');
  if (options.allowedOrigins.some(origin => new URL(origin).origin !== origin || new URL(origin).protocol !== 'https:')) throw new Error('Allowed deployment origins must be exact HTTPS origins.');
  if (options.environment === 'production' && rootUrl.origin !== new URL(attempt.baseline.target.productionOrigin).origin) throw new Error('Production deployment is outside the pinned production origin.');

  const sourceTexts = Object.fromEntries(Object.entries(options.mappedImages).filter(([file]) => file.startsWith('content/')).map(([file, text]) => [file.slice('content/'.length), text]));
  const factsText = options.mappedImages['data/facts.json'];
  if (typeof factsText !== 'string') throw new Error('The exact deployed facts file is required.');
  const facts = FactSnapshotSchema.parse(JSON.parse(factsText));
  const mappedHashes = Object.fromEntries(Object.entries(options.mappedImages).map(([file, text]) => [file, sha256(text)]));
  const artifact = createPublicArtifact({ sourceCommit: hosted.deployedSha, mode: 'commit', seedManifestText: options.seedManifestText, sourceTexts, factText: factsText });
  if (hashRecord(JSON.parse(options.artifactText)) !== hashRecord(artifact)) throw new Error('Public artifact bytes do not describe the exact deployed mapped files.');
  const metadata = createDeploymentMetadata(options.artifactText);
  const failures: string[] = [], checks: Record<string, Check[]> = {};
  const fail = (detail: string) => { if (!failures.includes(detail)) failures.push(detail); };
  if (run.status !== 'ready' || run.errors.length || run.baselineHash !== attempt.baselineHash || run.scope.inventoryHash !== attempt.baseline.inventoryHash || hashRecord([...run.scope.assetIds].sort()) !== hashRecord(attempt.baseline.assets.map(asset => asset.assetId).sort())) fail('Run no longer has complete ready results for the pinned scope and baseline.');
  if (hosted.deployedSha !== expectedSha) fail('Hosting deployment commit differs from the expected candidate or merge commit.');
  try { validateMergedTree(candidate, mappedHashes, facts); } catch { fail('Deployed mapped tree or facts differ from the approved candidate.'); }
  const pinnedMapping = attempt.baseline.assets.map(({ sourceHash: _hash, ...asset }) => asset);
  const actualMapping = artifact.assets.map(({ sourceHash: _hash, ...asset }) => asset);
  if (hashRecord(pinnedMapping) !== hashRecord(actualMapping)) fail('Deployed inventory, metadata or source-ID mapping changed.');
  const expectedFiles = [...artifact.assets.filter(asset => asset.path !== null).map(asset => asset.path!), 'data/facts.json'].sort();
  if (hashRecord(Object.keys(options.mappedImages).sort()) !== hashRecord(expectedFiles)) fail('Mapped deployment contains missing or extra source/fact files.');
  if (candidate.purpose !== attempt.purpose) fail('Candidate purpose differs from its attempt.');
  if (candidate.purpose === 'restoration') {
    if (!attempt.seedRevision || options.seedRevision !== attempt.seedRevision || candidate.approvals.length || state.patches.length || state.groups.length) fail('Restoration requires its pinned seed revision and zero correction patches or groups.');
    try {
      const remote = new GitHubRemote({ target: attempt.baseline.target, readLocal: () => ({ attempt, submission }) });
      const trustedSeed = await (options.readSeed ?? (revision => remote.readSeed(revision)))(attempt.seedRevision!);
      if (trustedSeed.seedManifestText !== options.seedManifestText || trustedSeed.seedFactsText !== factsText) throw new Error('Seed bytes differ from the pinned Git revision.');
      const seedArtifact = createPublicArtifact({ sourceCommit: attempt.seedRevision!, mode: 'seed', seedManifestText: options.seedManifestText, factText: factsText });
      if (hashRecord(seedArtifact.sourceHashes) !== hashRecord(artifact.sourceHashes) || seedArtifact.factsFileHash !== artifact.factsFileHash || seedArtifact.factsHash !== artifact.factsHash) fail('Restoration source and facts do not match exact seed bytes.');
    } catch { fail('Restoration seed source or fact provenance failed.'); }
  }

  const approvedIds = candidate.approvals.flatMap(approval => approval.eligibleIds);
  const eligibleGroups = state.groups.filter(group => group.eligibleIds.length);
  if (hashRecord(eligibleGroups.map(group => group.id).sort()) !== hashRecord(candidate.approvals.map(approval => approval.groupId).sort()) || hashRecord(eligibleGroups.flatMap(group => group.eligibleIds).sort()) !== hashRecord([...approvedIds].sort())) fail('Candidate omits or adds an eligible correction group or patch.');
  const patches = approvedIds.map(id => state.patches.find(patch => patch.id === id));
  if (new Set(approvedIds).size !== approvedIds.length || patches.some(patch => !patch)) fail('Candidate approved patches do not resolve exactly once.');
  if (patches.some(patch => patch && (patch.launchAttemptId !== attempt.id || patch.runId !== run.id || patch.status !== 'drafted' || patch.checks.some(check => !check.pass)))) fail('Candidate contains an unready or foreign correction patch.');
  for (const approval of candidate.approvals) {
    const current = state.approvals.find(value => value.id === approval.id);
    const group = state.groups.find(value => value.id === approval.groupId);
    if (!current || hashRecord(current) !== hashRecord(approval) || !group || !['approved', 'submitted'].includes(group.status) || group.revision !== approval.revision || group.membershipHash !== approval.membershipHash || group.approvalId !== approval.id || hashRecord([...group.eligibleIds].sort()) !== hashRecord([...approval.eligibleIds].sort()) || approval.desiredFactsHash !== candidate.desiredFactsHash || approval.checkedPatchHash !== checkedPatchHash(patches.filter(patch => patch && approval.eligibleIds.includes(patch.id)) as NonNullable<typeof patches[number]>[])) fail('Candidate approval no longer binds the complete checked group.');
  }
  const before = state.facts.find(value => value.phase === 'before')?.snapshot, desired = state.facts.find(value => value.phase === 'desired')?.snapshot;
  if (!before || !desired || hashRecord(before) !== attempt.beforeFactsHash || hashRecord(desired) !== attempt.desiredFactsHash || run.desiredFactVersion !== desired.version) fail('Attempt facts do not match the pinned before and desired snapshots.');
  if (candidate.purpose === 'correction' && before && desired && hashRecord(confirmedFacts(before)) !== hashRecord(desired)) fail('Desired correction facts differ from the deterministic confirmed change.');
  if (!options.judge && candidate.purpose === 'correction' && hosted.readiness === 'ready') {
    try { if (hashRecord(runtimeProviderConfig()) !== hashRecord(run.config)) fail('Runtime provider configuration differs from the pinned run configuration.'); }
    catch { fail('Pinned provider configuration is unavailable.'); }
  }
  const sourceHashes: Record<string, string> = {}, observedAssetIds: string[] = [];
  const observed = new Map<string, { page: Page; passages: Passage[] }>();
  let publishedFacts: FactSnapshot | null = null;
  if (hosted.readiness === 'ready') {
    for (const route of artifact.routes) {
      const url = new URL(route.pathname, rootUrl.origin);
      try {
        assertAllowedUrl(url.href, [rootUrl.origin]);
        const response = await (options.fetch ?? fetch)(url, { redirect: 'manual', cache: 'no-store', headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
        if (!response.ok || response.redirected || response.status >= 300 || !response.headers.get('content-type')?.includes('text/html') || (response.url && response.url !== url.href)) throw new Error('Unsafe or failed asset response.');
        if (run.mode === 'live' && !response.url) throw new Error('Real fetch must record its response URL.');
        const html = await response.text();
        if (Buffer.byteLength(html) > 2_000_000) throw new Error('Asset exceeds the response limit.');
        const extracted = extractRenderedAsset(html, url.href, at), expected = extractRenderedAsset(route.html, url.href, at);
        sourceHashes[extracted.page.assetId] = extracted.page.sourceHash;
        if (hashRecord(extractDeploymentMetadata(html)) !== hashRecord(metadata)) throw new Error('Deployment metadata differs from the exact commit artifact.');
        if (hashRecord(withoutTime(extracted.page)) !== hashRecord(withoutTime(expected.page)) || hashRecord(extracted.passages) !== hashRecord(expected.passages) || renderedSourceBody(html) !== renderedSourceBody(route.html)) throw new Error('Rendered asset differs from the complete committed source.');
        assertPublicChrome(html, route.title, route.kind === 'email', hosted.deployedSha, run.mode === 'live');
        observed.set(extracted.page.assetId, extracted);
        observedAssetIds.push(extracted.page.assetId);
        if (route.kind === 'pricing') publishedFacts = facts;
      } catch { fail('Rendered deployment verification failed: ' + route.pathname); }
    }
  } else if (hosted.readiness === 'failed') fail('Hosting deployment failed to become ready.');

  const blocks: Verification[] = [];
  const prerequisitesPass = failures.length === 0 && observedAssetIds.length === artifact.assets.length && before && desired;
  for (const patch of hosted.readiness === 'pending' ? [] : patches) {
    if (!patch) continue;
    const asset = observed.get(patch.assetId), passage = asset?.passages.find(value => value.id === patch.passageId);
    const sourceObserved = !!passage && passage.sourceId === patch.sourceId && passage.text === patch.replacement;
    const patchChecks = checkTextChange(patch.original, patch.replacement ?? '', patch.target, patch.surface);
    patchChecks.push({ name: 'source_located', pass: sourceObserved, detail: 'Exact replacement and stable ID appear in the complete observed asset.' });
    patchChecks.push({ name: 'source_fresh', pass: !!asset && artifact.assets.some(value => value.assetId === patch.assetId && value.editable && value.sourceHash === asset.page.sourceHash), detail: 'Observed source matches the exact deployed commit image.' });
    patchChecks.push({ name: 'fact_fresh', pass: !!desired && patch.factVersion === desired.version && hashRecord(targetForKind(patch.kind, desired)) === hashRecord(patch.target), detail: 'Correction uses the pinned desired fact version and deterministic target.' });
    let verdict: Verification['judgment'] = null, pass = false, detail = 'Final-context rejudge withheld because a deployment or patch prerequisite failed.';
    if (prerequisitesPass && sourceObserved && asset && passage && patchChecks.every(check => check.pass)) {
      try {
        verdict = JudgmentSchema.parse(await (options.judge ?? judge)(run.id, passage, asset.page, before!, desired!));
        const pinnedIdentity = verdict.runId === run.id && verdict.passageId === patch.passageId && verdict.factVersion === desired!.version && verdict.kind === patch.kind && verdict.adapter === run.config.adapter && verdict.model === run.config.judgeModel;
        pass = pinnedIdentity && verdict.escalatedBy === null && ['consistent', 'valid_exception'].includes(verdict.label) && (verdict.adapter !== 'jev' || (verdict.confidence !== null && verdict.confidence >= run.config.tLabel));
        if (!pinnedIdentity) verdict = null;
        detail = pass ? 'Pinned judge passed the exact deployed passage in its final combined context.' : 'Final-context judgment failed the pinned identity, label or confidence requirements.';
      } catch { verdict = null; detail = 'Final-context provider call or structured result failed.'; }
    }
    patchChecks.push({ name: 'rejudge_consistent', pass, detail });
    checks[patch.id] = patchChecks;
    blocks.push({ passageId: patch.passageId, url: passage?.url ?? new URL(attempt.baseline.assets.find(asset => asset.assetId === patch.assetId)?.pathname ?? '/', rootUrl.origin).href, sourceObserved, observedHash: passage?.blockHash ?? null, judgment: verdict, pass: patchChecks.every(check => check.pass), detail, checkedAt: at });
    if (!blocks.at(-1)!.pass) fail('Changed-passage verification failed: ' + patch.passageId);
  }
  if (candidate.purpose === 'correction' && !patches.length) fail('Correction candidate has no immutable approved changed passages.');
  const observation = DeploymentObservationSchema.parse({ id: 'observation-' + randomUUID(), launchAttemptId: attempt.id, submissionId: submission.id, environment: options.environment, deploymentId: hosted.deploymentId, url: rootUrl.origin, candidateSha: candidate.candidateSha, mergedSha, deployedSha: hosted.deployedSha, readiness: hosted.readiness, verification: hosted.readiness === 'pending' ? 'pending' : failures.length === 0 ? 'passed' : 'failed', inventoryHash: artifact.inventoryHash, factsHash: artifact.factsHash, publishedFacts, sourceHashes, blocks, failures, observedAt: at });
  const result = freeze({ observation, checks, evidence: { kind: run.mode === 'fixture' || candidate.approvals.some(approval => approval.actor === 'test') ? 'fixture' as const : 'live' as const, mappedTreeHash: hashRecord(mappedHashes), factsFileHash: sha256(factsText), artifactHash: sha256(options.artifactText), observedAssetIds, seedRevision: candidate.purpose === 'restoration' ? options.seedRevision ?? null : null } });
  issued.set(result, binding(state));
  return result;
}

/** Pure closure guard. The coordinator persists this record with the observation atomically. */
export function finalizeVerifiedAttempt(input: RemoteExport, result: DeploymentVerificationResult, options: { allowFixture?: boolean } = {}): LaunchAttempt {
  const state = RemoteExportSchema.parse(input), observation = result.observation, candidate = state.submission?.candidate;
  if (issued.get(result) !== binding(state)) throw new Error('Finalization requires a fresh verifier result for the unchanged attempt and candidate.');
  if (result.evidence.kind !== 'live' && !options.allowFixture) throw new Error('Fixture verification cannot close a real deployment attempt.');
  const validPurpose = candidate && (candidate.purpose === 'correction'
    ? observation.blocks.length > 0 && observation.blocks.length === candidate.approvals.flatMap(value => value.eligibleIds).length && observation.blocks.every(block => block.pass)
    : observation.blocks.length === 0 && Object.keys(result.checks).length === 0 && candidate.approvals.length === 0 && state.patches.length === 0 && result.evidence.seedRevision === state.attempt.seedRevision);
  if (!['active', 'abandoning', 'merged_failure'].includes(state.attempt.state) || state.submission?.status !== 'submitted' || state.submission.journal !== 'pr_opened' || !candidate || !validPurpose || observation.environment !== 'production' || observation.verification !== 'passed' || observation.readiness !== 'ready' || observation.failures.length || !observation.publishedFacts || observation.launchAttemptId !== state.attempt.id || observation.submissionId !== state.submission.id || observation.candidateSha !== candidate.candidateSha || observation.deployedSha !== observation.mergedSha || result.evidence.mappedTreeHash !== candidate.treeHash || observation.factsHash !== candidate.desiredFactsHash || hashRecord(observation.publishedFacts) !== candidate.desiredFactsHash || result.evidence.observedAssetIds.length !== state.attempt.baseline.assets.length || hashRecord([...result.evidence.observedAssetIds].sort()) !== hashRecord(state.attempt.baseline.assets.map(asset => asset.assetId).sort()) || Object.keys(observation.sourceHashes).length !== result.evidence.observedAssetIds.length) throw new Error('Verified completion requires passing production evidence for the complete approved mapped tree and facts.');
  return freeze(LaunchAttemptSchema.parse({ ...state.attempt, state: 'verified', revision: state.attempt.revision + 1, closedAt: observation.observedAt, closureReason: (result.evidence.kind === 'fixture' ? 'Fixture only: ' : '') + 'Production deployment ' + observation.deploymentId + ' verified at ' + observation.deployedSha + '.' }));
}
