import fixture from '../fixtures/remote/api.json';
import { RemoteExportSchema, SubmissionSchema, type DeploymentObservation, type RemoteExport } from '../lib/runs/remote-types';
import { RemoteBaselineViewSchema } from '../lib/runs/remote-api';

export const fixtureStates = ['initial', 'collecting', 'sealed', 'withheld', 'failedsubmission', 'failedpreview', 'mergedfailure', 'verified'] as const;
export type FixtureState = typeof fixtureStates[number];
export const fixtureNotice = 'Isolated UI fixture. Counts, checks, timings, approvals, PR and deployment identities are synthetic. Fixture controls cannot approve, submit, merge or publish.';
export function isFixtureState(value: string | undefined): value is FixtureState {
  return fixtureStates.some(state => state === value);
}
export function consoleFixture(state: FixtureState): RemoteExport | null {
  if (state === 'initial') return null;
  const evidence = RemoteExportSchema.parse(structuredClone(fixture.export));
  if (state === 'collecting') {
    evidence.run = structuredClone(fixture.responses.confirm.run) as RemoteExport['run'];
    evidence.pages = []; evidence.passages = []; evidence.groups = []; evidence.patches = []; evidence.judgments = []; evidence.approvals = [];
    return RemoteExportSchema.parse(evidence);
  }
  if (state === 'sealed' || state === 'withheld') {
    evidence.groups = evidence.groups.map(group => ({ ...group, status: 'sealed', approvalId: null }));
    evidence.approvals = [];
    return RemoteExportSchema.parse(evidence);
  }
  evidence.submission = SubmissionSchema.parse(structuredClone(fixture.responses.submit.submission));
  evidence.groups = evidence.groups.map(group => ({ ...group, status: 'submitted' }));
  if (state === 'failedsubmission') {
    evidence.submission.status = 'failed'; evidence.submission.journal = 'unknown';
    evidence.submission.failure = 'Synthetic lost PR response. Remote identity remains unknown; the target stays reserved.';
    evidence.submission.prNumber = null; evidence.submission.prUrl = null; evidence.submission.observedHeadSha = null;
    return RemoteExportSchema.parse(evidence);
  }
  const desired = evidence.facts.find(facts => facts.phase === 'desired')!;
  const base = evidence.attempt.baseline;
  const observation: DeploymentObservation = {
    id: 'fixture-preview', launchAttemptId: evidence.attempt.id, submissionId: evidence.submission.id,
    environment: 'preview', deploymentId: 'fixture-preview-deployment', url: 'https://mogs-preview-fixture.invalid',
    candidateSha: evidence.submission.candidate.candidateSha!, mergedSha: null, deployedSha: evidence.submission.candidate.candidateSha!,
    readiness: 'ready', verification: 'passed', inventoryHash: base.inventoryHash, factsHash: desired.hash, publishedFacts: desired.snapshot,
    sourceHashes: Object.fromEntries(base.assets.map(asset => [asset.assetId, asset.sourceHash])), blocks: [], failures: [], observedAt: '2026-10-03T19:02:00.000Z',
  };
  if (state === 'failedpreview') {
    observation.verification = 'failed'; observation.failures = ['Synthetic rendered check failed: the onboarding price still reads $30.'];
    evidence.observations = [observation];
    return RemoteExportSchema.parse(evidence);
  }
  evidence.observations = [observation, { ...observation, id: 'fixture-production', environment: 'production',
    deploymentId: 'fixture-production-deployment', url: 'https://mogs-fixture.invalid', mergedSha: 'c'.repeat(40), deployedSha: 'c'.repeat(40), observedAt: '2026-10-03T19:03:00.000Z' }];
  if (state === 'mergedfailure') {
    evidence.attempt.state = 'merged_failure'; evidence.attempt.revision = 2;
    const production = evidence.observations[1];
    production.verification = 'failed'; production.failures = ['Synthetic production verification failed: source hashes do not match the merged candidate.'];
    return RemoteExportSchema.parse(evidence);
  }
  evidence.attempt.state = 'verified'; evidence.attempt.revision = 2;
  evidence.attempt.closedAt = '2026-10-03T19:03:00.000Z'; evidence.attempt.closureReason = 'Synthetic matching production verification; UI fixture only.';
  return RemoteExportSchema.parse(evidence);
}
export const fixtureBaseline = RemoteBaselineViewSchema.parse({
  contractVersion: 2 as const, baseline: fixture.export.attempt.baseline, baselineHash: fixture.export.attempt.baselineHash,
  activeRunId: null,
  beforeFacts: fixture.export.facts.find(facts => facts.phase === 'before')!.snapshot,
  desiredFacts: fixture.export.facts.find(facts => facts.phase === 'desired')!.snapshot,
  enforcement: { available: false, message: 'Fixture mode: remote actions are disabled.' },
});
