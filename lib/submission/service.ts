import { randomUUID } from 'node:crypto';
import { hashRecord } from '../hash';
import { RemoteDatabase, RemoteStateError } from '../runs/remote-db';
import { CheckNameSchema, CheckSchema, type Check } from '../types';
import { z } from 'zod';
import { SubmitRequestSchema, SubmissionSchema, type Submission } from '../runs/remote-types';
import { type CandidateBundle } from './candidate';
import { type GitHubRemote } from './github';

export type SubmissionRemote = Pick<GitHubRemote, 'target' | 'assertBase' | 'readEnforcementSettings' | 'assertEnforcementSettings' | 'createCommit' | 'ensureBranch' | 'findPullRequest' | 'createPullRequest'>;
const same = (a: unknown, b: unknown) => hashRecord(a) === hashRecord(b);
const queues = new Map<string, Promise<unknown>>();

/** Checked images and operation identity are durable before any GitHub write. */
export class RemoteSubmission {
  constructor(readonly db: RemoteDatabase, readonly remote: SubmissionRemote, private readonly clock = () => new Date(), private readonly actor: 'human' | 'test' = 'human') {}
  async submit(input: unknown, bundle?: CandidateBundle): Promise<Submission> {
    const request = SubmitRequestSchema.parse(input), fingerprint = hashRecord(request);
    const operation = this.db.transaction(() => {
      const replay = this.db.replay('v2.submit', request.idempotencyKey, fingerprint) as { submissionId: string; runId: string } | null;
      if (replay) {
        const existing = this.db.getSubmission(replay.runId);
        if (!existing || existing.id !== replay.submissionId) throw new Error('Submission replay has no matching durable operation.');
        if (bundle && (!same(bundle.images, this.db.getCandidateImages(existing.runId)) || !same(bundle.checks, this.db.getCandidateChecks(existing.runId)))) throw new RemoteStateError('idempotency_conflict', 'Retry images or checks differ from the original checked bundle.');
        return existing;
      }
      const attempt = this.db.getAttempt(request.launchAttemptId), run = this.db.getRun(request.runId);
      if (!attempt || !run || attempt.runId !== run.id || run.launchAttemptId !== attempt.id) throw new RemoteStateError('not_found', 'Submission attempt/run does not exist.');
      if (!same(attempt.baseline.target, this.remote.target)) throw new RemoteStateError('stale', 'Configured GitHub target differs from the pinned attempt.');
      if (attempt.state !== 'active' || attempt.revision !== request.expectedAttemptRevision || attempt.baseline.baseSha !== request.baseSha) throw new RemoteStateError('stale', 'Attempt or pinned base changed.');
      const existing = this.db.getSubmission(run.id);
      if (existing) throw new RemoteStateError('idempotency_conflict', 'This run already owns a submission; retry its original operation key.');
      if (!bundle || bundle.candidate.candidateSha !== null || bundle.candidate.runId !== run.id || bundle.candidate.launchAttemptId !== attempt.id || bundle.candidate.bundleHash !== request.bundleHash) throw new RemoteStateError('validation', 'First submission requires the exact checked candidate bundle.');
      const expectedApprovals = bundle.candidate.approvals.map(a => ({ groupId: a.groupId, revision: a.revision, membershipHash: a.membershipHash })).sort((a, b) => a.groupId.localeCompare(b.groupId));
      if (!same([...request.approvals].sort((a, b) => a.groupId.localeCompare(b.groupId)), expectedApprovals) || (attempt.purpose === 'correction' && !expectedApprovals.length) || (attempt.purpose === 'restoration' && expectedApprovals.length)) throw new RemoteStateError('stale', 'Submit must bind every current approval, or the separate restoration intent.');
      this.assertCombinedChecks(run.id, bundle.candidate.purpose, bundle.candidate.approvals.flatMap(approval => approval.eligibleIds), bundle.checks);
      const at = this.clock().toISOString();
      const submission = SubmissionSchema.parse({ id: 'submission-' + attempt.id, launchAttemptId: attempt.id, runId: run.id, candidate: bundle.candidate, revision: 0, status: 'preparing', journal: 'planned', operationId: randomUUID(), requestFingerprint: fingerprint, prNumber: null, prUrl: null, observedHeadSha: null, failure: null, createdAt: at, updatedAt: at });
      this.db.putSubmission(submission); this.db.putCandidateImages(run.id, bundle.images, bundle.checks);
      this.db.addReviewEvent({ contractVersion: 2, id: submission.operationId, launchAttemptId: attempt.id, runId: run.id, groupId: null, patchId: null, action: 'submit', actor: this.actor, at, detail: 'Submitted the complete checked ' + attempt.purpose + ' bundle for one PR; human GitHub merge remains separate.' });
      this.db.remember('v2.submit', request.idempotencyKey, fingerprint, { submissionId: submission.id, runId: run.id }, at);
      return submission;
    });
    const key = this.db.file + '\0' + operation.runId, previous = queues.get(key) ?? Promise.resolve();
    const work = previous.catch(() => undefined).then(() => this.resume(operation.runId));
    queues.set(key, work);
    try { return await work; } finally { if (queues.get(key) === work) queues.delete(key); }
  }
  private current(runId: string): Submission {
    const submission = this.db.getSubmission(runId), attempt = submission && this.db.getAttempt(submission.launchAttemptId);
    if (!submission || !attempt) throw new RemoteStateError('not_found', 'Submission journal is missing.');
    if (attempt.state !== 'active' || submission.status === 'closed') throw new RemoteStateError('stale', 'This attempt no longer accepts submission work.');
    return submission;
  }
  private save(runId: string, changes: Partial<Submission>): Submission {
    return this.db.transaction(() => {
      const current = this.current(runId);
      if (current.status === 'submitted' && changes.status !== 'submitted') return current;
      const next = SubmissionSchema.parse({ ...current, ...changes, revision: current.revision + 1, updatedAt: this.clock().toISOString() });
      this.db.putSubmission(next); return next;
    });
  }
  private async resume(runId: string): Promise<Submission> {
    let submission = this.current(runId);
    if (submission.status === 'submitted') return submission;
    try {
      const images = this.db.getCandidateImages(runId);
      if (!images) throw new Error('Durable checked images are missing.');
      const checks = this.db.getCandidateChecks(runId);
      if (!checks) throw new Error('Durable final combined checks are missing.');
      this.assertCombinedChecks(runId, submission.candidate.purpose, submission.candidate.approvals.flatMap(approval => approval.eligibleIds), checks);
      // Discover a previously created PR before attempting any second remote effect.
      if (submission.candidate.candidateSha) {
        const existing = await this.remote.findPullRequest(submission);
        if (existing) {
          if (existing.state === 'closed' && !existing.mergedSha) throw new RemoteStateError('stale', 'The original PR is closed; abandon the attempt instead of opening another.');
          return this.save(runId, { status: 'submitted', journal: 'pr_opened', prNumber: existing.number, prUrl: existing.url, observedHeadSha: existing.headSha, failure: null });
        }
      }
      this.remote.assertEnforcementSettings(await this.remote.readEnforcementSettings());
      await this.remote.assertBase(submission.candidate);
      if (!submission.candidate.candidateSha) {
        const candidateSha = await this.remote.createCommit(submission, images);
        submission = this.save(runId, { candidate: { ...submission.candidate, candidateSha }, status: 'preparing', journal: 'commit_written', failure: null });
      }
      // Unknown records intention before branch/PR writes; a crash cannot look untouched.
      submission = this.save(runId, { journal: 'unknown', status: 'preparing', failure: null });
      await this.remote.ensureBranch(submission);
      submission = this.save(runId, { journal: 'branch_written' });
      const pr = await this.remote.createPullRequest(submission);
      if (pr.state === 'closed' && !pr.mergedSha) throw new RemoteStateError('stale', 'Original PR was closed during submission.');
      return this.save(runId, { status: 'submitted', journal: 'pr_opened', prNumber: pr.number, prUrl: pr.url, observedHeadSha: pr.headSha, failure: null });
    } catch (error) {
      const current = this.db.getSubmission(runId), attempt = current && this.db.getAttempt(current.launchAttemptId);
      if (!current || !attempt || attempt.state !== 'active' || current.status === 'closed') throw error;
      // Never erase an observed effect or create a new operation after a timeout.
      return this.save(runId, { status: error instanceof RemoteStateError ? 'blocked' : 'failed', journal: current.candidate.candidateSha ? 'unknown' : 'planned', failure: error instanceof RemoteStateError ? error.message : 'Submission outcome is unresolved; retry observes the original branch and PR.' });
    }
  }
  private assertCombinedChecks(runId: string, purpose: 'correction' | 'restoration', eligibleIds: string[], input: Record<string, Check[]>): void {
    const checks = z.record(z.string(), z.array(CheckSchema)).parse(input);
    if (purpose === 'restoration') { if (Object.keys(checks).length) throw new RemoteStateError('validation', 'Restoration has exact-seed verification, not correction patch checks.'); return; }
    if (!eligibleIds.length || new Set(eligibleIds).size !== eligibleIds.length || !same(Object.keys(checks).sort(), [...eligibleIds].sort())) throw new RemoteStateError('validation', 'Final combined checks must cover each eligible correction exactly once.');
    for (const id of eligibleIds) {
      const patch = this.db.getPatch(runId, id), proof = checks[id];
      const required = CheckNameSchema.options.filter(name => name !== 'tokens_kept' || patch?.surface === 'email');
      if (!patch || new Set(proof.map(check => check.name)).size !== proof.length || proof.some(check => !check.pass) || required.some(name => !proof.some(check => check.name === name && check.pass))) throw new RemoteStateError('validation', 'An eligible correction lacks complete passing combined checks.');
    }
  }
}
