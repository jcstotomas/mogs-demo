import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { buildRemoteFixtures, fixtureCombinedJudge, REMOTE_FIXTURE_TIME } from '../lib/runs/remote-fixtures';
import { BaselineSchema, SubmissionSchema, type RemoteExport } from '../lib/runs/remote-types';
import { assembleCandidate, type CandidateJudge } from '../lib/submission/candidate';
import { assembleRestoration } from '../lib/submission/restoration';
import { createDeploymentMetadata, createPublicArtifact } from '../lib/deployment/public-artifact';
import { finalizeVerifiedAttempt, verifyDeployment, type DeploymentVerificationOptions } from '../lib/deployment/verify';
import { hashRecord, sha256 } from '../lib/hash';

const seedManifestText = readFileSync('fixtures/remote/miniature/seed.json', 'utf8');
const clock = () => new Date(REMOTE_FIXTURE_TIME);
const candidateSha = 'b'.repeat(40), mergedSha = 'c'.repeat(40);
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture() {
  const f = buildRemoteFixtures();
  const bundle = await assembleCandidate(f.state, f.baseSources, f.state.attempt.baseline, fixtureCombinedJudge(f), REMOTE_FIXTURE_TIME);
  const candidate = { ...bundle.candidate, candidateSha };
  const submission = SubmissionSchema.parse({ id: 'verification-submission-' + f.state.attempt.id, launchAttemptId: f.state.attempt.id, runId: f.state.run.id, candidate, revision: 0, status: 'submitted', journal: 'pr_opened', operationId: 'fixture-verification-operation', requestFingerprint: hashRecord({ fixture: candidate.id }), prNumber: 1, prUrl: 'https://github.com/jcstotomas/mogs-demo/pull/1', observedHeadSha: candidateSha, failure: null, createdAt: REMOTE_FIXTURE_TIME, updatedAt: REMOTE_FIXTURE_TIME });
  const mappedImages = { ...Object.fromEntries(Object.entries(f.baseSources).map(([file, source]) => ['content/' + file, source])), ...bundle.images };
  return { f, bundle, state: { ...f.state, submission } as RemoteExport, mappedImages };
}
function options(f: Fixture, overrides: Partial<DeploymentVerificationOptions> = {}, mutateHtml?: (html: string, pathname: string) => string) {
  const environment = overrides.environment ?? 'preview', sha = environment === 'preview' ? candidateSha : overrides.mergedSha ?? mergedSha;
  const origin = environment === 'preview' ? 'https://preview.mogs-fixture.invalid' : f.state.attempt.baseline.target.productionOrigin;
  const mappedImages = overrides.mappedImages ?? f.mappedImages;
  const artifact = createPublicArtifact({ sourceCommit: sha, mode: 'commit', seedManifestText, factText: mappedImages['data/facts.json'], sourceTexts: Object.fromEntries(Object.entries(mappedImages).filter(([file]) => file.startsWith('content/')).map(([file, source]) => [file.slice('content/'.length), source])) });
  const artifactText = JSON.stringify(artifact, null, 2) + '\n', metadata = createDeploymentMetadata(artifactText), requests: string[] = [];
  const fakeFetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(String(input)); requests.push(url.href);
    assert.equal(init?.redirect, 'manual'); assert.equal(init?.cache, 'no-store');
    const route = artifact.routes.find(route => route.pathname === url.pathname)!;
    const html = route.html + '<script type="application/json" id="deployment-meta">' + JSON.stringify(metadata) + '</script>';
    const response = new Response(mutateHtml?.(html, url.pathname) ?? html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    Object.defineProperty(response, 'url', { value: url.href });
    return response;
  };
  const value: DeploymentVerificationOptions = { environment, mergedSha: environment === 'production' ? sha : null, readPullRequest: async submission => ({ number: submission.prNumber!, url: submission.prUrl!, headSha: submission.candidate.candidateSha!, baseSha: submission.candidate.baseSha, state: 'closed', mergedSha: sha }), readSeed: async () => ({ seedManifestText, seedFactsText: f.f.seedFactsText }), host: { resolve: async () => ({ deploymentId: 'fixture-' + environment + '-deployment', url: origin, deployedSha: sha, readiness: 'ready' }) }, allowedOrigins: [origin], mappedImages, seedManifestText, artifactText, judge: fixtureCombinedJudge(f.f), fetch: fakeFetch as typeof fetch, clock, ...overrides };
  return { value, artifact, requests };
}

test('preview verifies all four assets and every protected block, with five rejudgments in final combined context', async () => {
  const f = await fixture(), seen: string[] = [];
  const { value, requests, artifact } = options(f, { judge: fixtureCombinedJudge(f.f, passage => {
    seen.push(passage.id);
    if (passage.id === 'web:site/launch.md#starter-price') assert.equal(passage.after, 'Save 40% on Starter with annual billing.');
    if (passage.sourceId === 'annual-savings') assert.equal(passage.before, 'Starter is $40 a month.');
  }) });
  const result = await verifyDeployment(f.state, value);
  assert.equal(result.observation.environment, 'preview'); assert.equal(result.observation.mergedSha, null);
  assert.equal(result.observation.verification, 'passed'); assert.equal(result.observation.blocks.length, 5);
  assert.equal(requests.length, 4); assert.equal(seen.length, 5);
  assert.deepEqual(result.observation.sourceHashes, Object.fromEntries(artifact.assets.map(asset => [asset.assetId, asset.sourceHash])));
  assert.equal(result.evidence.observedAssetIds.length, 4); assert.equal(result.evidence.kind, 'fixture');
  assert.equal(result.evidence.factsFileHash, sha256(f.mappedImages['data/facts.json']));
  assert.equal(result.observation.publishedFacts!.plans.starter.monthlyCents, 4000);
  assert.ok(Object.values(result.checks).every(checks => checks.every(check => check.pass)));
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.observation.blocks[0]));
  assert.throws(() => finalizeVerifiedAttempt(f.state, result, { allowFixture: true }), /production evidence/);
});

test('production binds the distinct merge commit; completion rejects fixture promotion and arbitrary observations', async () => {
  const f = await fixture(), { value } = options(f, { environment: 'production' });
  const result = await verifyDeployment(f.state, value);
  assert.equal(result.observation.verification, 'passed'); assert.equal(result.observation.deployedSha, mergedSha);
  assert.equal(result.observation.candidateSha, candidateSha);
  assert.throws(() => finalizeVerifiedAttempt(f.state, result), /Fixture/);
  assert.throws(() => finalizeVerifiedAttempt(f.state, structuredClone(result), { allowFixture: true }), /fresh verifier result/);
  const next = finalizeVerifiedAttempt(f.state, result, { allowFixture: true });
  assert.equal(next.state, 'verified'); assert.equal(next.revision, 1); assert.match(next.closureReason!, /^Fixture only:/);
  assert.equal(f.state.attempt.state, 'active');
  const changed = structuredClone(f.state); changed.submission!.revision++;
  assert.throws(() => finalizeVerifiedAttempt(changed, result, { allowFixture: true }), /unchanged attempt/);
  const mutations: ((state: RemoteExport) => void)[] = [
    state => { state.run.status = 'failed'; },
    state => { state.patches[0].replacement += ' unreviewed'; },
    state => { state.groups[0].revision++; },
    state => { state.approvals[0].checkedPatchHash = 'a'.repeat(64); },
    state => { state.facts[0].snapshot.plans.starter.monthlyCents++; },
  ];
  for (const mutate of mutations) { const drifted = structuredClone(f.state); mutate(drifted); assert.throws(() => finalizeVerifiedAttempt(drifted, result, { allowFixture: true }), /unchanged attempt/); }
});

test('verification refuses a candidate that omits an otherwise eligible approved group', async () => {
  const f = await fixture(), state = structuredClone(f.state);
  state.submission!.candidate.approvals.pop();
  const result = await verifyDeployment(state, options(f, { environment: 'production' }).value);
  assert.equal(result.observation.verification, 'failed');
  assert.ok(result.observation.failures.some(failure => failure.includes('omits or adds an eligible')));
});

test('live records cannot promote scripted fetch or judge evidence into production verification', async () => {
  const f = await fixture(), state = structuredClone(f.state);
  state.run.mode = 'live';
  for (const approval of state.approvals) approval.actor = 'human';
  for (const approval of state.submission!.candidate.approvals) approval.actor = 'human';
  const { value } = options(f, { environment: 'production' });
  await assert.rejects(verifyDeployment(state, value), /injected adapters are fixture-only/);
  await assert.rejects(verifyDeployment(state, { ...value, judge: undefined }), /injected adapters are fixture-only/);
  await assert.rejects(verifyDeployment(state, { ...value, fetch: undefined }), /injected adapters are fixture-only/);
});

test('production requires a real merge observation of the recorded PR and exact head', async () => {
  const f = await fixture(), { value } = options(f, { environment: 'production' });
  const good = await value.readPullRequest!(f.state.submission!);
  for (const changed of [{ state: 'open' as const, mergedSha: null }, { headSha: 'd'.repeat(40) }, { mergedSha: 'd'.repeat(40) }, { number: 99 }]) {
    await assert.rejects(verifyDeployment(f.state, { ...value, readPullRequest: async () => ({ ...good, ...changed }) }), /recorded PR actually merged/);
  }
  const preparing = structuredClone(f.state);
  preparing.submission!.status = 'preparing'; preparing.submission!.journal = 'commit_written';
  await assert.rejects(verifyDeployment(preparing, value), /immutable submitted candidate/);
});

test('hosting identity mismatch remains failed even when page metadata repeats the expected candidate SHA', async () => {
  const f = await fixture(), { value } = options(f, { host: { resolve: async () => ({ deploymentId: 'fixture-wrong-host-sha', url: 'https://preview.mogs-fixture.invalid', deployedSha: 'd'.repeat(40), readiness: 'ready' }) } });
  // The exact artifact read from that Git commit has the actual host identity;
  // page responses still claim the expected candidate identity.
  const artifact = createPublicArtifact({ sourceCommit: 'd'.repeat(40), mode: 'commit', seedManifestText, factText: f.mappedImages['data/facts.json'], sourceTexts: { ...f.f.baseSources, 'site/launch.md': f.bundle.images['content/site/launch.md'], 'email/onboarding.md': f.bundle.images['content/email/onboarding.md'] } });
  value.artifactText = JSON.stringify(artifact, null, 2) + '\n';
  const result = await verifyDeployment(f.state, value);
  assert.equal(result.observation.deployedSha, 'd'.repeat(40)); assert.equal(result.observation.verification, 'failed');
  assert.ok(result.observation.failures.some(failure => /Hosting deployment commit/.test(failure)));
  assert.ok(result.observation.failures.some(failure => /Rendered deployment/.test(failure)));
  assert.equal(result.observation.blocks.filter(block => block.judgment !== null).length, 0);
});

test('protected text changed under unchanged metadata fails full-asset verification and blocks rejudging', async () => {
  const f = await fixture(); let calls = 0;
  const { value, requests } = options(f, { judge: async (...args) => { calls++; return fixtureCombinedJudge(f.f)(...args); } }, (html, pathname) => pathname === '/assets/email/eligible' ? html.replace('Starter is $30 a month.', 'Starter is $999 a month.') : html);
  const result = await verifyDeployment(f.state, value);
  assert.equal(result.observation.verification, 'failed'); assert.equal(requests.length, 4); assert.equal(calls, 0);
  assert.ok(result.observation.failures.includes('Rendered deployment verification failed: /assets/email/eligible'));
  assert.equal(result.evidence.observedAssetIds.length, 3);
  assert.throws(() => finalizeVerifiedAttempt(f.state, result, { allowFixture: true }), /production evidence/);
});

test('missing or duplicate source IDs, changed metadata and exact facts-file identity are rejected', async () => {
  const f = await fixture();
  for (const change of [
    (html: string) => html.replace('data-source-id="starter-price"', 'data-source-id="unknown-price"'),
    (html: string) => html.replace('data-source-id="annual-savings"', 'data-source-id="starter-price"'),
    (html: string) => html.replace('"legacyStarterEligible":false', '"legacyStarterEligible":true'),
    (html: string) => html.replace(/("factsFileHash":")[a-f0-9]{64}/, '$1' + '0'.repeat(64)),
    (html: string) => html.replace('</main>', '<p>Unmarked extra price: $1.</p></main>'),
    (html: string) => html.replace('</main>', '</main><p data-source-id="external" data-role="body">Extra outside source body.</p>'),
  ]) {
    const { value } = options(f, {}, (html, pathname) => pathname === '/site/launch' ? change(html) : html);
    assert.equal((await verifyDeployment(f.state, value)).observation.verification, 'failed');
  }
});

test('whole mapped tree includes untouched files and exact facts bytes even when facts normalize identically', async () => {
  const f = await fixture();
  const compactFacts = { ...f.mappedImages, 'data/facts.json': JSON.stringify(JSON.parse(f.mappedImages['data/facts.json'])) };
  const compact = await verifyDeployment(f.state, options(f, { mappedImages: compactFacts }).value);
  assert.equal(compact.observation.verification, 'failed');
  assert.equal(compact.observation.factsHash, f.state.attempt.desiredFactsHash);
  assert.ok(compact.observation.failures.some(failure => /mapped tree/.test(failure)));
  const extra = await verifyDeployment(f.state, options(f, { mappedImages: { ...f.mappedImages, 'data/extra.json': '{}' } }).value);
  assert.equal(extra.observation.verification, 'failed');
  assert.ok(extra.observation.failures.some(failure => /missing or extra/.test(failure)));
  const untouched = { ...f.mappedImages, 'content/email/eligible.md': f.mappedImages['content/email/eligible.md'].replace('Starter is $30 a month.', 'Starter is $31 a month.') };
  assert.equal((await verifyDeployment(f.state, options(f, { mappedImages: untouched }).value)).observation.verification, 'failed');
});

test('failed deployment records actual old facts rather than replacing them with desired facts', async () => {
  const f = await fixture(), oldImages = { ...Object.fromEntries(Object.entries(f.f.baseSources).map(([file, source]) => ['content/' + file, source])), 'data/facts.json': f.f.seedFactsText };
  const result = await verifyDeployment(f.state, options(f, { environment: 'production', mappedImages: oldImages }).value);
  assert.equal(result.observation.verification, 'failed'); assert.equal(result.observation.publishedFacts!.plans.starter.monthlyCents, 3000);
  assert.equal(result.observation.factsHash, f.state.attempt.beforeFactsHash);
  assert.throws(() => finalizeVerifiedAttempt(f.state, result, { allowFixture: true }), /production evidence/);
});

test('wrong adapter/model/fact/kind and low Jev confidence cannot pass the pinned final-context judge', async () => {
  const f = await fixture(), fake = fixtureCombinedJudge(f.f);
  const variants: CandidateJudge[] = [
    async (...args) => ({ ...await fake(...args), model: 'different-model' }),
    async (...args) => ({ ...await fake(...args), factVersion: 1 }),
    async (...args) => ({ ...await fake(...args), kind: 'threshold' }),
    async (...args) => ({ ...await fake(...args), escalatedBy: 'low_confidence' }),
    async (...args) => ({ ...await fake(...args), adapter: 'jev', confidence: .9, confidenceSource: 'jev', probabilities: { contradicting: 0, consistent: .9, valid_exception: .1, unrelated: 0, insufficient_context: 0 } }),
  ];
  for (const judge of variants) {
    const result = await verifyDeployment(f.state, options(f, { judge }).value);
    assert.equal(result.observation.verification, 'failed'); assert.ok(result.observation.blocks.every(block => !block.pass));
  }
  const jevState = structuredClone(f.state); jevState.run.config.adapter = 'jev'; jevState.run.config.connection = 'typesafe_http'; jevState.run.config.judgeModel = 'fixture-jev';
  const lowJev: CandidateJudge = async (...args) => ({ ...await fake(...args), adapter: 'jev', model: 'fixture-jev', confidence: .69, confidenceSource: 'jev', probabilities: { contradicting: 0, consistent: .69, valid_exception: .31, unrelated: 0, insufficient_context: 0 } });
  const low = await verifyDeployment(jevState, options(f, { judge: lowJev }).value);
  assert.equal(low.observation.verification, 'failed'); assert.ok(low.observation.blocks.every(block => !block.pass));
});

test('provider errors remain failed checks with no fabricated semantic judgment', async () => {
  const f = await fixture(), { value } = options(f, { judge: async () => { throw new Error('Provider error fixture'); } });
  const result = await verifyDeployment(f.state, value);
  assert.equal(result.observation.verification, 'failed'); assert.equal(result.observation.publishedFacts!.plans.starter.monthlyCents, 4000);
  for (const block of result.observation.blocks) { assert.equal(block.sourceObserved, true); assert.equal(block.judgment, null); assert.equal(block.pass, false); assert.match(block.detail, /provider call/); }
});

test('exact HTTPS origins, redirect rejection, absent assets and pending deployment prevent passing evidence', async () => {
  const f = await fixture();
  await assert.rejects(verifyDeployment(f.state, options(f, { allowedOrigins: ['http://preview.mogs-fixture.invalid'] }).value), /configured origins/);
  await assert.rejects(verifyDeployment(f.state, options(f, { allowedOrigins: ['https://other.invalid'] }).value), /configured origins/);
  const redirected = await verifyDeployment(f.state, options(f, { fetch: (async () => new Response(null, { status: 302, headers: { Location: 'https://other.invalid' } })) as typeof fetch }).value);
  assert.equal(redirected.observation.verification, 'failed'); assert.equal(redirected.evidence.observedAssetIds.length, 0);
  const missing = await verifyDeployment(f.state, options(f, { fetch: (async () => new Response('not found', { status: 404 })) as typeof fetch }).value);
  assert.equal(missing.observation.verification, 'failed');
  const pending = await verifyDeployment(f.state, options(f, { host: { resolve: async () => ({ deploymentId: 'fixture-pending', url: 'https://preview.mogs-fixture.invalid', deployedSha: candidateSha, readiness: 'pending' }) } }).value);
  assert.equal(pending.observation.verification, 'pending'); assert.deepEqual(pending.observation.blocks, []);
});

test('restoration verifies exact seed source and facts with no provider calls, correction checks or repair credit', async () => {
  const f = await fixture(), desired = f.state.facts.find(value => value.phase === 'desired')!.snapshot;
  const correctedArtifact = createPublicArtifact({ sourceCommit: candidateSha, mode: 'commit', seedManifestText, sourceTexts: { ...f.f.baseSources, 'site/launch.md': f.bundle.images['content/site/launch.md'], 'email/onboarding.md': f.bundle.images['content/email/onboarding.md'] }, factText: f.mappedImages['data/facts.json'] });
  const baseline = BaselineSchema.parse({ ...f.state.attempt.baseline, baseSha: candidateSha, deployedSha: candidateSha, inventoryHash: correctedArtifact.inventoryHash, factsHash: correctedArtifact.factsHash, factsFileHash: correctedArtifact.factsFileHash, assets: correctedArtifact.assets });
  const id = randomUUID(), runId = 'fixture-restoration-verification', seedRevision = 'e'.repeat(40);
  const attempt = { ...f.state.attempt, id, runId, purpose: 'restoration' as const, seedRevision, baseline, baselineHash: hashRecord(baseline), beforeFactsHash: correctedArtifact.factsHash, desiredFactsHash: f.state.attempt.beforeFactsHash };
  const restored = assembleRestoration(attempt, baseline, Object.fromEntries(Object.entries(f.mappedImages).filter(([file]) => file.startsWith('content/')).map(([file, source]) => [file.slice('content/'.length), source])), f.f.seed, f.f.seedFactsText, REMOTE_FIXTURE_TIME);
  const candidate = { ...restored.candidate, candidateSha };
  const submission = SubmissionSchema.parse({ ...f.state.submission!, id: 'fixture-restoration-submission', launchAttemptId: id, runId, candidate });
  const state: RemoteExport = { ...f.state, attempt, run: { ...f.state.run, id: runId, launchAttemptId: id, baselineHash: attempt.baselineHash, desiredFactVersion: 1, scope: { ...f.state.run.scope, inventoryHash: baseline.inventoryHash } }, facts: [{ launchAttemptId: id, phase: 'before', version: desired.version, hash: hashRecord(desired), snapshot: desired }, { launchAttemptId: id, phase: 'desired', version: f.state.facts[0].version, hash: f.state.attempt.beforeFactsHash, snapshot: f.state.facts[0].snapshot }], pages: [], passages: [], groups: [], patches: [], judgments: [], approvals: [], submission, observations: [], recoveries: [], reviewEvents: [] };
  const mappedImages = { ...Object.fromEntries(Object.entries(f.f.baseSources).map(([file, source]) => ['content/' + file, source])), 'data/facts.json': f.f.seedFactsText };
  const value = options({ ...f, state }, { environment: 'production', mappedImages, seedRevision, judge: async () => { throw new Error('Restoration must never call the correction judge.'); } }).value;
  const result = await verifyDeployment(state, value);
  assert.equal(result.observation.verification, 'passed'); assert.deepEqual(result.observation.blocks, []); assert.deepEqual(result.checks, {});
  assert.equal(result.observation.publishedFacts!.plans.starter.monthlyCents, 3000);
  assert.equal(finalizeVerifiedAttempt(state, result, { allowFixture: true }).state, 'verified');
  assert.equal(state.run.stats.verified, f.state.run.stats.verified);
  const wrongSeed = await verifyDeployment(state, { ...value, seedRevision: 'f'.repeat(40) });
  assert.equal(wrongSeed.observation.verification, 'failed');
  const forgedSeed = JSON.parse(seedManifestText);
  forgedSeed.sources['site/launch.md'].source += '\n';
  forgedSeed.sources['site/launch.md'].hash = sha256(forgedSeed.sources['site/launch.md'].source);
  forgedSeed.corpusHash = hashRecord(Object.entries(forgedSeed.sources).map(([file, source]) => ({ file, hash: (source as { hash: string }).hash })));
  const forged = await verifyDeployment(state, { ...value, seedManifestText: JSON.stringify(forgedSeed) });
  assert.equal(forged.observation.verification, 'failed');
  assert.ok(forged.observation.failures.includes('Restoration seed source or fact provenance failed.'));
});
