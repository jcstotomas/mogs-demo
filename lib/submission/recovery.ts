import { randomUUID } from 'node:crypto';
import { hashRecord } from '../hash';
import { RemoteDatabase, RemoteStateError } from '../runs/remote-db';
import { AbandonRequestSchema, ReconcileRequestSchema, RecoverySchema, StatusEvidenceSchema, type DeploymentObservation, type LaunchAttempt, type Recovery, type Submission } from '../runs/remote-types';

export interface PullRequestState { number: number; url: string; headSha: string; baseSha: string; state: 'open' | 'closed'; mergedSha: string | null }
export interface RecoveryRemote {
  readPullRequest(submission: Submission): Promise<PullRequestState>;
  postFailure(submission: Submission, sha: string, context: 'mogs/candidate' | 'mogs/preview', evidenceHash: string): Promise<ReturnType<typeof StatusEvidenceSchema.parse>>;
  readStatuses(submission: Submission, sha: string): Promise<ReturnType<typeof StatusEvidenceSchema.parse>[]>;
  closePullRequest(submission: Submission): Promise<void>;
  observeProduction(submission: Submission, deploymentId: string): Promise<DeploymentObservation>;
}

const message = (error: unknown) => error instanceof RemoteStateError ? error.message : 'Remote recovery failed; state remains locked until observed.';

/** Journal first; a lost response leaves a recoverable operation and the slot locked. */
export class RemoteRecovery {
  constructor(readonly db: RemoteDatabase, readonly remote: RecoveryRemote, private readonly clock = () => new Date(), private readonly actor: 'human' | 'test' = 'human') {}
  async abandon(input: unknown): Promise<Recovery> {
    const request = AbandonRequestSchema.parse(input), fingerprint = hashRecord(request);
    const operation = this.db.transaction(() => {
      this.assertActor(request.runId);
      const replay = this.db.replay('v2.abandon', request.idempotencyKey, fingerprint) as { recoveryId: string } | null;
      if (replay) return this.db.getRecovery(replay.recoveryId)!;
      const attempt = this.requireAttempt(request.launchAttemptId, request.runId, request.expectedAttemptRevision);
      const submission = this.db.getSubmission(request.runId);
      if ((submission?.revision ?? null) !== request.expectedSubmissionRevision) throw new RemoteStateError('stale', 'Submission revision changed.');
      if (!['active', 'abandoning'].includes(attempt.state)) throw new RemoteStateError('stale', 'This attempt requires deployed-state reconciliation.');
      const now = this.clock().toISOString(), id = randomUUID();
      const recovery = RecoverySchema.parse({ id, launchAttemptId: attempt.id, submissionId: submission?.id ?? null, action: 'abandon', status: 'planned', expectedAttemptRevision: request.expectedAttemptRevision, expectedSubmissionRevision: request.expectedSubmissionRevision, requestFingerprint: fingerprint, retiredShas: [], statuses: [], prClosed: false, mergedSha: null, observedDeploymentId: null, failure: null, createdAt: now, updatedAt: now });
      this.db.putRecovery(recovery);
      this.db.putAttempt({ ...attempt, state: 'abandoning', revision: attempt.revision + 1, recoveryId: id });
      this.db.addReviewEvent({ contractVersion: 2, id, launchAttemptId: attempt.id, runId: attempt.runId, groupId: null, patchId: null, action: 'abandon', actor: this.actor, at: now, detail: request.reason });
      this.db.remember('v2.abandon', request.idempotencyKey, fingerprint, { recoveryId: id }, now);
      return recovery;
    });
    return this.resumeAbandon(operation);
  }
  private async resumeAbandon(initial: Recovery): Promise<Recovery> {
    if (['reconciled', 'merged_observed'].includes(initial.status)) return initial;
    let recovery = initial;
    const save = (changes: Partial<Recovery>) => { recovery = RecoverySchema.parse({ ...recovery, ...changes, updatedAt: this.clock().toISOString() }); this.db.putRecovery(recovery); };
    const attempt = this.db.getAttempt(initial.launchAttemptId)!, submission = this.db.getSubmission(attempt.runId);
    try {
      if (!submission?.prNumber) {
        if (submission && (submission.journal !== 'planned' || submission.candidate.candidateSha)) throw new RemoteStateError('stale', 'Unknown branch/PR creation must be reconciled before abandonment.');
        this.db.transaction(() => {
          save({ status: 'reconciled', prClosed: true });
          this.finish(attempt, 'abandoned', 'Abandoned before remote writes.');
        });
        return recovery;
      }
      let pr = await this.remote.readPullRequest(submission);
      this.validatePr(submission, pr);
      const shas = [...new Set([submission.candidate.candidateSha!, pr.headSha])];
      for (const sha of shas) for (const context of ['mogs/candidate', 'mogs/preview'] as const) await this.remote.postFailure(submission, sha, context, recovery.requestFingerprint);
      const statuses = (await Promise.all(shas.map(sha => this.remote.readStatuses(submission, sha)))).flat();
      const trustedAppId = attempt.baseline.target.statusProducerAppId;
      for (const sha of shas) for (const context of ['mogs/candidate', 'mogs/preview'] as const) {
        const latest = statuses.find(s => s.sha === sha && s.context === context);
        if (!latest || latest.state !== 'failure' || latest.producerAppId !== trustedAppId) throw new Error('Retirement statuses are unconfirmed.');
      }
      save({ status: 'statuses_revoked', retiredShas: shas, statuses, failure: null });
      pr = await this.remote.readPullRequest(submission);
      this.validatePr(submission, pr);
      if (!shas.includes(pr.headSha)) throw new Error('PR head changed during retirement; reconcile again.');
      if (pr.mergedSha) {
        this.db.transaction(() => {
          save({ status: 'merged_observed', mergedSha: pr.mergedSha, prClosed: false });
          const current = this.db.getAttempt(attempt.id)!;
          this.db.putAttempt({ ...current, state: 'merged_failure', revision: current.revision + 1 });
        });
        return recovery;
      }
      if (pr.state === 'open') await this.remote.closePullRequest(submission);
      pr = await this.remote.readPullRequest(submission);
      this.validatePr(submission, pr);
      if (pr.mergedSha) {
        this.db.transaction(() => {
          save({ status: 'merged_observed', mergedSha: pr.mergedSha });
          const current = this.db.getAttempt(attempt.id)!;
          this.db.putAttempt({ ...current, state: 'merged_failure', revision: current.revision + 1 });
        });
        return recovery;
      }
      if (pr.state !== 'closed' || !shas.includes(pr.headSha)) throw new Error('PR closure/head is unconfirmed.');
      this.db.transaction(() => {
        save({ status: 'reconciled', prClosed: true });
        const currentSubmission = this.db.getSubmission(attempt.runId)!;
        this.db.putSubmission({ ...currentSubmission, status: 'closed', journal: 'closed', revision: currentSubmission.revision + 1, updatedAt: this.clock().toISOString() });
        this.finish(this.db.getAttempt(attempt.id)!, 'abandoned', 'Required statuses retired and unmerged PR closure observed.');
      });
    } catch (error) { save({ status: 'unknown', failure: message(error) }); }
    return recovery;
  }
  async reconcile(input: unknown): Promise<Recovery> {
    const request = ReconcileRequestSchema.parse(input), fingerprint = hashRecord(request);
    const operation = this.db.transaction(() => {
      this.assertActor(request.runId);
      const replay = this.db.replay('v2.reconcile', request.idempotencyKey, fingerprint) as { recoveryId: string } | null;
      if (replay) return this.db.getRecovery(replay.recoveryId)!;
      const attempt = this.requireAttempt(request.launchAttemptId, request.runId, request.expectedAttemptRevision);
      if (attempt.state !== 'merged_failure') throw new RemoteStateError('stale', 'Only a merged failure can reconcile the deployed state.');
      const submission = this.db.getSubmission(request.runId);
      if (!submission?.prNumber) throw new RemoteStateError('stale', 'Merged submission is unknown.');
      const now = this.clock().toISOString(), id = randomUUID();
      const recovery = RecoverySchema.parse({ id, launchAttemptId: attempt.id, submissionId: submission.id, action: 'reconcile', status: 'planned', expectedAttemptRevision: attempt.revision, expectedSubmissionRevision: submission.revision, requestFingerprint: fingerprint, retiredShas: [], statuses: [], prClosed: false, mergedSha: null, observedDeploymentId: request.observedDeploymentId, failure: null, createdAt: now, updatedAt: now });
      this.db.putRecovery(recovery);
      this.db.putAttempt({ ...attempt, revision: attempt.revision + 1, recoveryId: id });
      this.db.addReviewEvent({ contractVersion: 2, id, launchAttemptId: attempt.id, runId: attempt.runId, groupId: null, patchId: null, action: 'reconcile', actor: this.actor, at: now, detail: request.reason });
      this.db.remember('v2.reconcile', request.idempotencyKey, fingerprint, { recoveryId: id }, now);
      return recovery;
    });
    if (operation.status === 'reconciled') return operation;
    let recovery = operation;
    try {
      const attempt = this.db.getAttempt(operation.launchAttemptId)!, submission = this.db.getSubmission(attempt.runId)!;
      const pr = await this.remote.readPullRequest(submission);
      this.validatePr(submission, pr);
      if (!pr.mergedSha) throw new Error('Merge is unconfirmed.');
      const observation = await this.remote.observeProduction(submission, request.observedDeploymentId);
      if (observation.deploymentId !== request.observedDeploymentId || observation.environment !== 'production' || observation.readiness !== 'ready' || observation.mergedSha !== pr.mergedSha || observation.deployedSha !== pr.mergedSha || !observation.publishedFacts || attempt.baseline.assets.some(a => !observation.sourceHashes[a.assetId]) || Object.keys(observation.sourceHashes).length !== attempt.baseline.assets.length || hashRecord(observation.publishedFacts) !== observation.factsHash) throw new Error('Actual public deployment/facts are unconfirmed.');
      this.db.transaction(() => {
        this.db.putObservation(observation);
        recovery = { ...operation, status: 'reconciled', mergedSha: pr.mergedSha, observedDeploymentId: observation.deploymentId, failure: null, updatedAt: this.clock().toISOString() };
        this.db.putRecovery(recovery);
        this.finish(this.db.getAttempt(attempt.id)!, 'reconciled_failure', request.reason);
      });
    } catch (error) { recovery = { ...operation, status: 'unknown', failure: message(error), updatedAt: this.clock().toISOString() }; this.db.putRecovery(recovery); }
    return recovery;
  }
  private assertActor(runId: string): void {
    if (this.actor === 'test' && this.db.getRun(runId)?.mode === 'live') throw new RemoteStateError('validation', 'Test recovery cannot act on a live run.');
  }
  private validatePr(s: Submission, pr: PullRequestState): void { if (pr.number !== s.prNumber || pr.url !== s.prUrl || !/^[a-f0-9]{40}$/.test(pr.headSha) || !/^[a-f0-9]{40}$/.test(pr.baseSha)) throw new Error('Remote PR identity mismatch.'); }
  private requireAttempt(id: string, runId: string, revision: number): LaunchAttempt { const a = this.db.getAttempt(id); if (!a || a.runId !== runId) throw new RemoteStateError('not_found', 'Attempt/run not found.'); if (a.revision !== revision) throw new RemoteStateError('stale', 'Attempt revision changed.'); return a; }
  private finish(attempt: LaunchAttempt, state: 'abandoned' | 'reconciled_failure', reason: string): void { const current = this.db.getAttempt(attempt.id)!; this.db.putAttempt({ ...current, state, revision: current.revision + 1, closedAt: this.clock().toISOString(), closureReason: reason }); }
}
