import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hashRecord } from '../hash';
import { initialFacts, confirmedFacts } from '../facts/derive';
import { FactSnapshotSchema, ProviderConfigSchema, type FactSnapshot, type Page, type Passage, type ProviderConfig } from '../types';
import { emptyStats } from './contracts';
import { RemoteDatabase, RemoteStateError, checkedPatchHash } from './remote-db';
import {
  BaselineSchema, ConfirmRequestSchema, RestoreRequestSchema, ApproveRequestSchema,
  LaunchAttemptSchema, RemoteRunSchema, ApprovalSchema,
  type Baseline, type LaunchAttempt, type RemoteRun, type Approval,
} from './remote-types';

const equal = (a: unknown, b: unknown) => hashRecord(a) === hashRecord(b);
const FULL_RUN_DEADLINE_MS = 180_000;
export interface RemoteStartInput {
  baseline: Baseline;
  beforeFacts: FactSnapshot;
  desiredFacts: FactSnapshot;
  config: ProviderConfig;
  pages?: Page[];
  passages?: Passage[];
  mode?: RemoteRun['mode'];
}
export interface RemoteStartResult { attempt: LaunchAttempt; run: RemoteRun }
/** Local desired state and approval authorization only; no source or remote writes. */
export class RemoteCoordinator {
  private readonly clock: () => Date;
  private readonly actor: 'human' | 'test';
  constructor(private readonly options: { databasePath?: string; legacyPath?: string; clock?: () => Date; actor?: 'human' | 'test' } = {}) {
    this.clock = options.clock ?? (() => new Date()); this.actor = options.actor ?? 'human';
  }
  private database<T>(operation: (db: RemoteDatabase) => T): T {
    const db = new RemoteDatabase(this.options.databasePath, { legacyPath: this.options.legacyPath, clock: this.clock });
    try { return db.transaction(() => operation(db)); } finally { db.close(); }
  }
  confirm(request: z.input<typeof ConfirmRequestSchema>, input: RemoteStartInput): RemoteStartResult {
    const body = ConfirmRequestSchema.parse(request);
    return this.start(body, input, 'correction', null);
  }
  startRestoration(request: z.input<typeof RestoreRequestSchema>, input: RemoteStartInput): RemoteStartResult {
    const body = RestoreRequestSchema.parse(request);
    return this.start(body, input, 'restoration', body.seedRevision);
  }
  private start(body: z.infer<typeof ConfirmRequestSchema> | z.infer<typeof RestoreRequestSchema>, input: RemoteStartInput, purpose: LaunchAttempt['purpose'], seedRevision: string | null): RemoteStartResult {
    const namespace = 'v2:' + purpose + ':confirm', fingerprint = hashRecord(body);
    return this.database(db => {
      const replay = db.replay(namespace, body.idempotencyKey, fingerprint) as RemoteStartResult | null;
      if (replay) return replay;
      if (db.getAttempt(body.launchAttemptId)) throw new RemoteStateError('idempotency_conflict', 'Attempt identity has already been confirmed; retry the original request.');
      const baseline = BaselineSchema.parse(input.baseline), beforeFacts = FactSnapshotSchema.parse(input.beforeFacts), desiredFacts = FactSnapshotSchema.parse(input.desiredFacts), config = ProviderConfigSchema.parse(input.config);
      if (body.baselineHash !== hashRecord(baseline) || baseline.inventoryHash !== hashRecord(baseline.assets) || baseline.factsHash !== hashRecord(beforeFacts)) throw new RemoteStateError('stale', 'Observed production baseline, facts and inventory must match Confirm.');
      if (beforeFacts.version !== body.expectedFactVersion) throw new RemoteStateError('stale', 'Observed public fact version changed.');
      if (purpose === 'correction' && (!equal(beforeFacts, initialFacts()) || !equal(desiredFacts, confirmedFacts(beforeFacts)))) throw new RemoteStateError('validation', 'Correction requires the frozen $30 seed and its deterministic $40 desired facts.');
      if (purpose === 'restoration' && (!equal(desiredFacts, initialFacts()) || beforeFacts.version === desiredFacts.version)) throw new RemoteStateError('validation', 'Restoration requires observed changed facts and the frozen seed.');
      if (db.activeAttempt(baseline.target)) throw new RemoteStateError('busy', 'An active launch or restoration already owns this target.');
      const confirmedAt = this.clock().toISOString(), runId = randomUUID();
      const attempt = LaunchAttemptSchema.parse({ contractVersion: 2, id: body.launchAttemptId, runId, purpose, seedRevision, baseline, baselineHash: body.baselineHash, beforeFactsHash: hashRecord(beforeFacts), desiredFactsHash: hashRecord(desiredFacts), state: 'active', revision: 0, confirmedAt, recoveryId: null, closedAt: null, closureReason: null });
      const stats = emptyStats();
      stats.assetsIndexed = input.pages?.length ?? 0; stats.passagesIndexed = input.passages?.length ?? 0;
      for (const page of input.pages ?? []) stats.bySurface[page.surface].assets++;
      for (const passage of input.passages ?? []) stats.bySurface[passage.surface].passages++;
      const run = RemoteRunSchema.parse({ contractVersion: 2, id: runId, launchAttemptId: attempt.id, changeId: beforeFacts.change.id, desiredFactVersion: desiredFacts.version, mode: input.mode ?? 'live', baselineHash: attempt.baselineHash, scope: { assetIds: baseline.assets.map(a => a.assetId), urls: baseline.assets.map(a => new URL(a.pathname, baseline.target.productionOrigin).href), corpusHash: baseline.corpusHash, inventoryHash: baseline.inventoryHash }, config, confirmedAt, deadlineAt: new Date(Date.parse(confirmedAt) + FULL_RUN_DEADLINE_MS).toISOString(), fullRunDeadlineMs: FULL_RUN_DEADLINE_MS, status: 'collecting', filteredPassageIds: [], stats, errors: [], updatedAt: confirmedAt });
      db.putAttempt(attempt);
      db.putFacts({ launchAttemptId: attempt.id, phase: 'before', version: beforeFacts.version, hash: attempt.beforeFactsHash, snapshot: beforeFacts });
      db.putFacts({ launchAttemptId: attempt.id, phase: 'desired', version: desiredFacts.version, hash: attempt.desiredFactsHash, snapshot: desiredFacts });
      db.putRun(run);
      for (const page of input.pages ?? []) db.putPage(run.id, page);
      for (const passage of input.passages ?? []) db.putPassage(run.id, passage);
      if (purpose === 'restoration') db.addReviewEvent({ contractVersion: 2, id: 'restore-' + attempt.id, launchAttemptId: attempt.id, runId: run.id, groupId: null, patchId: null, actor: this.actor, action: 'restore', at: confirmedAt, detail: 'Started a separate seed-restoration attempt at revision ' + seedRevision + '; no remote content changed.' });
      const response = { attempt, run };
      db.remember(namespace, body.idempotencyKey, fingerprint, response, confirmedAt);
      return response;
    });
  }
  approve(groupId: string, request: z.input<typeof ApproveRequestSchema>): { approval: Approval } {
    const body = ApproveRequestSchema.parse(request), fingerprint = hashRecord({ groupId, ...body }), namespace = 'v2:approve';
    return this.database(db => {
      const replay = db.replay(namespace, body.idempotencyKey, fingerprint) as { approval: Approval } | null;
      if (replay) return replay;
      const run = db.getRun(body.runId), attempt = db.getAttempt(body.launchAttemptId), group = db.getGroup(body.runId, groupId);
      if (!run || !attempt || !group || run.launchAttemptId !== attempt.id || attempt.runId !== run.id) throw new RemoteStateError('not_found', 'Group, run and attempt must match.');
      if (attempt.state !== 'active' || run.status === 'failed' || db.getSubmission(run.id)) throw new RemoteStateError('stale', 'This run no longer accepts group approvals.');
      if (!['sealed', 'approved'].includes(group.status) || group.revision !== body.expectedRevision || group.membershipHash !== body.membershipHash) throw new RemoteStateError('stale', 'Review the complete current checked group revision.');
      db.assertSealable(group);
      if (group.approvalId) {
        const approval = db.getApproval(run.id, group.approvalId)!;
        db.assertApproval(group, approval);
        const response = { approval }; db.remember(namespace, body.idempotencyKey, fingerprint, response, approval.at); return response;
      }
      const at = this.clock().toISOString();
      const approval = ApprovalSchema.parse({ id: randomUUID(), launchAttemptId: attempt.id, runId: run.id, groupId, revision: group.revision, membershipHash: group.membershipHash, eligibleIds: group.eligibleIds, desiredFactsHash: attempt.desiredFactsHash, checkedPatchHash: checkedPatchHash(group.eligibleIds.map(id => db.getPatch(run.id, id)!)), actor: this.actor, at, requestFingerprint: fingerprint });
      db.putApproval(approval); db.putGroup({ ...group, status: 'approved', approvalId: approval.id });
      db.addReviewEvent({ contractVersion: 2, id: randomUUID(), launchAttemptId: attempt.id, runId: run.id, groupId, patchId: null, actor: this.actor, action: 'approve', at, detail: 'Approved the checked group for inclusion in the combined candidate; no content published.' });
      const response = { approval }; db.remember(namespace, body.idempotencyKey, fingerprint, response, at); return response;
    });
  }
  /** Called by the worker before committing a late result; failure remains terminal. */
  expireRun(runId: string): RemoteRun {
    return this.database(db => {
      const run = db.getRun(runId);
      if (!run) throw new RemoteStateError('not_found', 'Run not found.');
      if (run.status === 'failed' || run.status === 'ready' || this.clock().getTime() <= Date.parse(run.deadlineAt)) return run;
      const failed: RemoteRun = { ...run, status: 'failed', updatedAt: this.clock().toISOString(), errors: [...run.errors, { code: 'deadline', message: 'The 180-second all-results deadline expired.' }] };
      db.putRun(failed); return failed;
    });
  }
  getRun(runId: string) { return this.database(db => db.export(runId)); }
  export(runId: string) { return this.getRun(runId); }
}
