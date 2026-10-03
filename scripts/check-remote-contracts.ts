import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { hashRecord } from '../lib/hash';
import { RemoteDatabase } from '../lib/runs/remote-db';
import { buildRemoteFixtures, buildRemoteApiFixtures, seedRemoteFixtureDatabase, fixtureCombinedJudge, RemoteApiFixtureSchema, REMOTE_FIXTURE_TIME } from '../lib/runs/remote-fixtures';
import { assembleCandidate } from '../lib/submission/candidate';
import { CoverageRegistrySchema, scoreCoverage } from '../lib/metrics/coverage-contract';

const saved = RemoteApiFixtureSchema.parse(JSON.parse(readFileSync('fixtures/remote/api.json', 'utf8')));
assert.equal(hashRecord(saved), hashRecord(await buildRemoteApiFixtures()), 'Frozen API DTO fixture drifted from the executable harness.');
const fixture = buildRemoteFixtures(), db = new RemoteDatabase(':memory:', { clock: () => new Date(REMOTE_FIXTURE_TIME) });
try {
  seedRemoteFixtureDatabase(db, fixture);
  const state = db.export(fixture.state.run.id);
  assert.equal(state.pages.length, 4);
  assert.equal(state.passages.length, state.judgments.length + state.run.filteredPassageIds.length);
  assert.equal(state.groups.length, 4);
  assert.equal(state.approvals.length, 4);
  assert.equal(db.reviewActionCount(state.run.id), 0, 'Test fixture approvals must not appear as human actions.');
  const bundle = await assembleCandidate(state, fixture.baseSources, state.attempt.baseline, fixtureCombinedJudge(fixture), REMOTE_FIXTURE_TIME);
  assert.deepEqual(bundle.candidate.files.map(file => file.path), ['content/email/onboarding.md', 'content/site/launch.md', 'data/facts.json']);
  const coverage = CoverageRegistrySchema.parse(JSON.parse(readFileSync('fixtures/remote/coverage-miniature.json', 'utf8'))), score = scoreCoverage(coverage, []);
  assert.equal(score.independentGateEligibility, 'not_eligible');
  const testOutput = execFileSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', 'tests/remote-submission.test.ts'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  const tests = Number(/tests (\d+)/.exec(testOutput)?.[1] ?? 0);
  assert.ok(tests >= 8);
  console.log(JSON.stringify({ contractVersion: 2, evidenceKind: 'fixture', schema: 'passed', assets: state.pages.length, passages: state.passages.length, fabricatedJudgments: state.judgments.length, lexicalPrefilterMisses: state.run.filteredPassageIds.length, completeGroups: state.groups.length, testApprovals: state.approvals.length, candidateMappedFiles: bundle.candidate.files.length, recoveryAndSubmissionTests: tests, independentHeldoutGate: 'not_eligible', liveDatabaseOpened: false, providerCalls: 0, remoteWrites: 0, remote0Gate: 'not_claimed' }));
} finally { db.close(); }
