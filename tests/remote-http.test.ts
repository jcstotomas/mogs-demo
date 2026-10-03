import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { buildRemoteApiFixtures } from '../lib/runs/remote-fixtures';
import { BaselineSchema, CandidateSchema, RemoteErrorSchema, RemoteExportSchema } from '../lib/runs/remote-types';
import { CheckSchema, FactSnapshotSchema, HashSchema } from '../lib/types';
import { RemoteStateError } from '../lib/runs/remote-db';
import { createRemoteHttpHandlers, type RemoteHttpRuntime } from '../app/api/v2/_lib/dispatch';
import { remoteApiError } from '../app/api/v2/_lib/http';

const fixtures = await buildRemoteApiFixtures();
const baselineSchema = z.object({ contractVersion: z.literal(2), baseline: BaselineSchema, baselineHash: HashSchema, beforeFacts: FactSnapshotSchema, desiredFacts: FactSnapshotSchema, enforcement: z.object({ available: z.boolean(), message: z.string() }).strict(), activeRunId: z.string().nullable() }).strict();
const observeSchema = z.object({ contractVersion: z.literal(2), launchAttemptId: z.string().min(1).max(200), runId: z.string().min(1).max(200) }).strict();
const candidateSchema = z.object({ candidate: CandidateSchema, checks: z.record(z.string(), z.array(CheckSchema)) }).strict();
const request = (route: string, body?: unknown, origin?: string) => new Request('http://localhost:3000/api/v2/' + route, { ...(body === undefined ? {} : { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) } }) });
const context = (field: string, value: string) => ({ params: Promise.resolve({ [field]: value }) });
function harness() {
  const calls: string[] = [], scheduled: string[] = [];
  const runtime: RemoteHttpRuntime = {
    baseline: async () => ({ contractVersion: 2, baseline: fixtures.export.attempt.baseline, baselineHash: fixtures.export.attempt.baselineHash, beforeFacts: fixtures.export.facts[0].snapshot, desiredFacts: fixtures.export.facts[1].snapshot, enforcement: { available: false, message: 'Fixture enforcement unavailable.' }, activeRunId: fixtures.export.run.id }),
    confirm: async () => { calls.push('confirm'); return fixtures.responses.confirm; },
    approve: () => { calls.push('approve'); return fixtures.responses.approve; },
    run: () => { calls.push('run'); return fixtures.export; },
    candidate: async () => { calls.push('candidate'); return { candidate: fixtures.responses.submit.submission.candidate, checks: {} }; },
    submit: async () => { calls.push('submit'); return fixtures.responses.submit; },
    abandon: async () => { calls.push('abandon'); return fixtures.responses.abandon; },
    reconcile: async () => { calls.push('reconcile'); return fixtures.responses.reconcile; },
    restore: async () => { calls.push('restore'); return fixtures.responses.restore; },
    observe: async () => { calls.push('observe'); return fixtures.export; },
  };
  const handlers = createRemoteHttpHandlers(runtime, { baseline: baselineSchema, candidate: candidateSchema, observe: observeSchema }, runId => scheduled.push(runId));
  return { runtime, handlers, calls, scheduled };
}

test('v2 handlers return exact frozen fixture DTOs and only schedule correction analysis after Confirm', async () => {
  const h = harness(), runId = fixtures.export.run.id;
  const confirmation = await h.handlers.postFacts(request('facts', fixtures.requests.confirm));
  assert.equal(confirmation.status, 200); assert.deepEqual(await confirmation.json(), fixtures.responses.confirm); assert.deepEqual(h.scheduled, [runId]);
  const approve = await h.handlers.postApprove(request('groups/x/approve', fixtures.requests.approve), context('groupId', fixtures.export.groups[0].id));
  assert.deepEqual(await approve.json(), fixtures.responses.approve);
  for (const [name, route, input, response] of [
    ['postSubmit', 'submit', fixtures.requests.submit, fixtures.responses.submit],
    ['postAbandon', 'abandon', fixtures.requests.abandon, fixtures.responses.abandon],
    ['postReconcile', 'reconcile', fixtures.requests.reconcile, fixtures.responses.reconcile],
  ] as const) {
    const result = await h.handlers[name](request('runs/' + runId + '/' + route, input), context('runId', runId));
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), response);
  }
  const restoration = await h.handlers.postRestoration(request('restorations', fixtures.requests.restore));
  assert.deepEqual(await restoration.json(), fixtures.responses.restore); assert.deepEqual(h.scheduled, [runId]);
});
test('read handlers use complete exports, typed baseline/candidate DTOs and no-store responses', async () => {
  const h = harness(), runId = fixtures.export.run.id;
  for (const name of ['getRun', 'getExport'] as const) {
    const response = await h.handlers[name](request('runs/' + runId), context('runId', runId));
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.deepEqual(RemoteExportSchema.parse(await response.json()), fixtures.export);
  }
  assert.equal((await h.handlers.getBaseline(request('baseline'))).status, 200);
  const candidate = await h.handlers.getCandidate(request('runs/' + runId + '/candidate'), context('runId', runId));
  assert.equal(candidate.status, 200); assert.equal(candidateSchema.parse(await candidate.json()).candidate.runId, runId);
});
test('malformed JSON, old-version bodies and unknown fields never dispatch mutations', async () => {
  for (const body of ['{broken', { ...fixtures.requests.confirm, contractVersion: 1 }, { ...fixtures.requests.confirm, optionalControl: true }]) {
    const h = harness(), response = await h.handlers.postFacts(request('facts', body));
    assert.equal(response.status, 400); assert.equal(RemoteErrorSchema.parse(await response.json()).error.code, 'validation'); assert.deepEqual(h.calls, []); assert.deepEqual(h.scheduled, []);
  }
});
test('run path/body mismatch blocks every run mutation before coordinator effects', async () => {
  const h = harness();
  for (const [name, body] of [['postSubmit', fixtures.requests.submit], ['postAbandon', fixtures.requests.abandon], ['postReconcile', fixtures.requests.reconcile]] as const) {
    const response = await h.handlers[name](request('runs/wrong/mutate', body), context('runId', 'wrong-run'));
    assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'validation');
  }
  assert.deepEqual(h.calls, []);
});
test('local console origin, localhost target, required path ID and request size are enforced', async () => {
  const h = harness();
  const crossOrigin = await h.handlers.postFacts(request('facts', fixtures.requests.confirm, 'https://hostile.invalid')); assert.equal(crossOrigin.status, 400);
  const remoteHost = await h.handlers.getBaseline(new Request('https://mogs-demo.vercel.app/api/v2/baseline')); assert.equal(remoteHost.status, 400);
  const missingId = await h.handlers.getRun(request('runs/x'), { params: Promise.resolve({}) }); assert.equal(missingId.status, 400);
  const largeBody = await h.handlers.postFacts(request('facts', JSON.stringify({ ...fixtures.requests.confirm, padding: 'x'.repeat(33_000) }))); assert.equal(largeBody.status, 400);
  assert.deepEqual(h.calls, []);
});
test('state and enforcement errors follow frozen status/retry shapes without leaking raw transport secrets', async () => {
  for (const fixture of fixtures.errors) {
    const { code } = fixture.body.error;
    const error = ['validation', 'not_found', 'stale', 'busy', 'idempotency_conflict'].includes(code) ? new RemoteStateError(code as ConstructorParameters<typeof RemoteStateError>[0], 'Safe state message.') : Object.assign(new Error('Bearer secret-token: raw provider response'), { code });
    const response = remoteApiError(error), body = RemoteErrorSchema.parse(await response.json());
    assert.equal(response.status, fixture.httpStatus); assert.equal(body.error.code, code); assert.equal(body.error.retryable, fixture.body.error.retryable); assert.ok(!body.error.message.includes('secret-token'));
  }
  const generic = remoteApiError(new Error('Credential secret-token'));
  assert.equal(generic.status, 502); assert.equal((await generic.json()).error.code, 'remote_failure');
});
test('invalid coordinator output fails safe without returning partial state', async () => {
  const h = harness(); h.runtime.confirm = async () => ({ attempt: fixtures.responses.confirm.attempt, run: { ...fixtures.responses.confirm.run, extra: 'secret-token' } });
  const response = await h.handlers.postFacts(request('facts', fixtures.requests.confirm));
  assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('secret-token')); assert.deepEqual(h.scheduled, []);
});

test('deployment observation requires explicit POST plus matching run/attempt, while ordinary GET stays read-only', async () => {
  const h = harness(), runId = fixtures.export.run.id;
  await h.handlers.getRun(request('runs/' + runId), context('runId', runId)); assert.deepEqual(h.calls, ['run']);
  const body = { contractVersion: 2, launchAttemptId: fixtures.export.attempt.id, runId };
  const wrongPath = await h.handlers.postObserve(request('runs/wrong/observe', body), context('runId', 'wrong')); assert.equal(wrongPath.status, 400);
  const wrongAttempt = await h.handlers.postObserve(request('runs/' + runId + '/observe', { ...body, launchAttemptId: 'wrong-attempt' }), context('runId', runId)); assert.equal(wrongAttempt.status, 400);
  assert.ok(!h.calls.includes('observe'));
  const observed = await h.handlers.postObserve(request('runs/' + runId + '/observe', body), context('runId', runId));
  assert.equal(observed.status, 200); assert.deepEqual(await observed.json(), fixtures.export); assert.equal(h.calls.filter(call => call === 'observe').length, 1);
});
