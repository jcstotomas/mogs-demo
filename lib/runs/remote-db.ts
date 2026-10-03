import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { hashRecord, sha256 } from '../hash';
import { PageSchema, PassageSchema, CheckNameSchema, CheckSchema, type Check, type Page, type Passage } from '../types';
import { assertRunTransition } from './contracts';
import { prefilter } from '../pipeline';
import { checkedPatchHash } from '../submission/candidate';
export { checkedPatchHash } from '../submission/candidate';
import {
  LaunchAttemptSchema, AttemptFactsSchema, RemoteRunSchema, RemoteGroupSchema, RemotePatchSchema,
  RemoteJudgmentSchema, ApprovalSchema, CandidateSchema, SubmissionSchema, RecoverySchema,
  DeploymentObservationSchema, RemoteExportSchema, RemoteReviewEventSchema, type RemoteReviewEvent, type LaunchAttempt, type AttemptFacts,
  type RemoteRun, type RemoteGroup, type Approval, type Candidate, type Submission,
  type Recovery, type DeploymentObservation, type Baseline,
} from './remote-types';

type RemotePatch = z.infer<typeof RemotePatchSchema>;
type RemoteJudgment = z.infer<typeof RemoteJudgmentSchema>;
type JsonRow = Record<string, string | number | null>;
export class RemoteStateError extends Error {
  constructor(readonly code: 'stale' | 'busy' | 'idempotency_conflict' | 'validation' | 'not_found', message: string) { super(message); }
}
function fail(message: string): never { throw new RemoteStateError('stale', message); }
const same = (a: unknown, b: unknown) => hashRecord(a) === hashRecord(b);
const terminal = (state: LaunchAttempt['state']) => ['verified', 'abandoned', 'reconciled_failure'].includes(state);
export const targetKey = (target: Baseline['target']) => hashRecord([target.repository.toLowerCase(), target.baseRef, new URL(target.productionOrigin).origin, target.vercelProjectId, target.vercelTeamId]);

function canonical(file: string): string {
  if (existsSync(file)) return realpathSync(file);
  const parent = path.dirname(path.resolve(file));
  return path.join(existsSync(parent) ? realpathSync(parent) : canonical(parent), path.basename(file));
}
function sameFile(a: string, b: string): boolean {
  if (a === ':memory:' || b === ':memory:') return false;
  if (canonical(a) === canonical(b)) return true;
  if (!existsSync(a) || !existsSync(b)) return false;
  const first = statSync(a), second = statSync(b);
  return first.dev === second.dev && first.ino === second.ino;
}
const tables = ['pages', 'passages', 'judgments', 'groups', 'patches', 'approvals', 'candidates', 'submissions', 'recoveries', 'observations', 'review_events'] as const;
const DDL = `
CREATE TABLE IF NOT EXISTS remote_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO remote_meta VALUES ('schema_version','2');
CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, target_key TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE UNIQUE INDEX IF NOT EXISTS one_active_target ON attempts(target_key) WHERE state NOT IN ('verified','abandoned','reconciled_failure');
CREATE TABLE IF NOT EXISTS facts (attempt_id TEXT NOT NULL REFERENCES attempts(id), phase TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(attempt_id,phase), UNIQUE(attempt_id,version));
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id), fact_version INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), UNIQUE(id,attempt_id), FOREIGN KEY(attempt_id,fact_version) REFERENCES facts(attempt_id,version));
${tables.map(table => `CREATE TABLE IF NOT EXISTS ${table} (id TEXT NOT NULL, run_id TEXT NOT NULL, attempt_id TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(run_id,id), FOREIGN KEY(run_id,attempt_id) REFERENCES runs(id,attempt_id));`).join('\n')}
CREATE UNIQUE INDEX IF NOT EXISTS one_candidate_per_run ON candidates(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS unique_candidate_commit ON candidates(json_extract(payload,'$.candidateSha')) WHERE json_extract(payload,'$.candidateSha') IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_submission_per_run ON submissions(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS unique_recovery_id ON recoveries(id);
CREATE TABLE IF NOT EXISTS candidate_images (run_id TEXT PRIMARY KEY REFERENCES runs(id), candidate_id TEXT NOT NULL, bundle_hash TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), checks_payload TEXT CHECK(checks_payload IS NULL OR json_valid(checks_payload)));
CREATE TRIGGER IF NOT EXISTS immutable_candidate_images_update BEFORE UPDATE ON candidate_images BEGIN SELECT RAISE(ABORT,'Candidate images are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_candidate_images_delete BEFORE DELETE ON candidate_images BEGIN SELECT RAISE(ABORT,'Candidate images are immutable'); END;
CREATE TABLE IF NOT EXISTS idempotency (namespace TEXT NOT NULL, key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, response TEXT NOT NULL CHECK(json_valid(response)), created_at TEXT NOT NULL, PRIMARY KEY(namespace,key));
CREATE TABLE IF NOT EXISTS legacy_archives (id TEXT PRIMARY KEY, source_path TEXT NOT NULL, schema_json TEXT NOT NULL, imported_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS legacy_rows (archive_id TEXT NOT NULL REFERENCES legacy_archives(id), table_name TEXT NOT NULL, ordinal INTEGER NOT NULL, row_json TEXT NOT NULL, PRIMARY KEY(archive_id,table_name,ordinal));
CREATE TABLE IF NOT EXISTS legacy_keys (archive_id TEXT NOT NULL REFERENCES legacy_archives(id), namespace TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(archive_id,namespace,key));
${['legacy_archives', 'legacy_rows', 'legacy_keys'].flatMap(table => ['UPDATE', 'DELETE'].map(operation => `CREATE TRIGGER IF NOT EXISTS immutable_${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Legacy archive is immutable'); END;`)).join('\n')}
PRAGMA user_version = 2;
`;

/** V2 state only. Opening/importing never upgrades or writes the v1 database. */
export class RemoteDatabase {
  readonly connection: DatabaseSync;
  private depth = 0;
  private readonly now: () => Date;
  constructor(readonly file = 'data/remote/app.db', options: { legacyPath?: string; clock?: () => Date } = {}) {
    for (const legacy of new Set([options.legacyPath ?? 'data/app.db', process.env.MOGS_DATABASE_PATH ?? 'data/app.db'])) if (sameFile(file, legacy)) throw new RemoteStateError('validation', 'The v2 database must be separate from the v1 database.');
    this.now = options.clock ?? (() => new Date());
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.connection = new DatabaseSync(file);
    try {
      this.connection.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      const existing = this.connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      if (existing.length && !existing.some(row => row.name === 'remote_meta')) throw new RemoteStateError('validation', 'Refusing to open an existing non-v2 database.');
      if (existing.length && (this.connection.prepare("SELECT value FROM remote_meta WHERE key='schema_version'").get() as { value: string } | undefined)?.value !== '2') throw new RemoteStateError('validation', 'Unsupported remote database version.');
      if (file !== ':memory:') this.connection.exec('PRAGMA journal_mode=WAL;');
      this.connection.exec(DDL);
      const imageColumns = this.connection.prepare('PRAGMA table_info(candidate_images)').all() as { name: string }[];
      if (!imageColumns.some(column => column.name === 'checks_payload')) this.connection.exec('ALTER TABLE candidate_images ADD COLUMN checks_payload TEXT CHECK(checks_payload IS NULL OR json_valid(checks_payload))');
    } catch (error) { this.connection.close(); throw error; }
  }
  close(): void { this.connection.close(); }
  transaction<T>(operation: () => T): T {
    if (this.depth) return operation();
    this.connection.exec('BEGIN IMMEDIATE'); this.depth++;
    try { const result = operation(); this.connection.exec('COMMIT'); return result; }
    catch (error) { this.connection.exec('ROLLBACK'); throw error; }
    finally { this.depth--; }
  }
  async importLegacy(sourcePath: string): Promise<{ archiveId: string; rows: number }> {
    if (sameFile(sourcePath, this.file)) throw new RemoteStateError('validation', 'Cannot archive the v2 database as v1.');
    const directory = mkdtempSync(path.join(tmpdir(), 'mogs-v1-snapshot-'));
    const source = new DatabaseSync(sourcePath, { readOnly: true });
    let snapshot: DatabaseSync | undefined;
    try {
      await backup(source, path.join(directory, 'snapshot.db'));
      snapshot = new DatabaseSync(path.join(directory, 'snapshot.db'), { readOnly: true });
      const version = snapshot.prepare('PRAGMA user_version').get() as { user_version: number };
      if (version.user_version !== 1) throw new RemoteStateError('validation', 'Legacy import requires a v1 snapshot.');
      const schema = snapshot.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
      const names = snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
      const rows = names.map(({ name }) => ({ table: name, rows: snapshot!.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all() as JsonRow[] }));
      const archiveId = hashRecord({ schema, rows });
      this.transaction(() => {
        if (this.connection.prepare('SELECT id FROM legacy_archives WHERE id=?').get(archiveId)) return;
        for (const table of rows) if (table.table === 'idempotency') for (const row of table.rows) {
          if (this.connection.prepare('SELECT key FROM idempotency WHERE key=?').get(row.key)) throw new RemoteStateError('idempotency_conflict', 'A legacy key already exists in v2.');
        }
        this.connection.prepare('INSERT INTO legacy_archives VALUES(?,?,?,?)').run(archiveId, canonical(sourcePath), JSON.stringify(schema), this.now().toISOString());
        for (const table of rows) table.rows.forEach((row, ordinal) => {
          this.connection.prepare('INSERT INTO legacy_rows VALUES(?,?,?,?)').run(archiveId, table.table, ordinal, JSON.stringify(row));
          if (table.table === 'idempotency') this.connection.prepare('INSERT INTO legacy_keys VALUES(?,?,?,?,?)').run(archiveId, row.namespace, row.key, row.fingerprint, row.response);
        });
      });
      return { archiveId, rows: rows.reduce((total, table) => total + table.rows.length, 0) };
    } finally { snapshot?.close(); source.close(); rmSync(directory, { recursive: true, force: true }); }
  }
  legacyRows(archiveId: string, table: string): JsonRow[] { return (this.connection.prepare('SELECT row_json FROM legacy_rows WHERE archive_id=? AND table_name=? ORDER BY ordinal').all(archiveId, table) as { row_json: string }[]).map(row => JSON.parse(row.row_json) as JsonRow); }
  getAttempt(id: string): LaunchAttempt | null { return this.read('SELECT payload FROM attempts WHERE id=?', LaunchAttemptSchema, id); }
  attemptForRun(runId: string): LaunchAttempt | null { return this.read('SELECT payload FROM attempts WHERE run_id=?', LaunchAttemptSchema, runId); }
  activeAttempt(target: Baseline['target'] | string): LaunchAttempt | null { return this.read("SELECT payload FROM attempts WHERE target_key=? AND state NOT IN ('verified','abandoned','reconciled_failure')", LaunchAttemptSchema, typeof target === 'string' ? target : targetKey(target)); }
  putAttempt(input: LaunchAttempt): void {
    const value = LaunchAttemptSchema.parse(input), old = this.getAttempt(value.id);
    const identity = ({ state: _s, revision: _r, recoveryId: _i, closedAt: _a, closureReason: _c, ...rest }: LaunchAttempt) => rest;
    if (old) {
      if (!same(identity(old), identity(value)) || value.revision < old.revision || (!same(old, value) && value.revision <= old.revision)) fail('Attempt identity is immutable and changes require a newer revision.');
      const allowed: Record<LaunchAttempt['state'], LaunchAttempt['state'][]> = { active: ['abandoning', 'merged_failure', 'verified'], abandoning: ['abandoned', 'merged_failure', 'verified'], merged_failure: ['reconciled_failure', 'verified'], verified: [], abandoned: [], reconciled_failure: [] };
      if ((terminal(old.state) && !same(old, value)) || (old.state !== value.state && !allowed[old.state].includes(value.state))) fail('Invalid attempt transition.');
    } else {
      if (value.state !== 'active' || value.revision !== 0) fail('New attempts start active at revision zero.');
      if (this.activeAttempt(value.baseline.target)) throw new RemoteStateError('busy', 'A launch or restoration already owns this target.');
    }
    if (!same(value.baselineHash, hashRecord(value.baseline))) fail('Baseline hash mismatch.');
    this.connection.prepare('INSERT INTO attempts VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,payload=excluded.payload').run(value.id, value.runId, targetKey(value.baseline.target), value.state, JSON.stringify(value));
  }
  putFacts(input: AttemptFacts): void {
    const value = AttemptFactsSchema.parse(input), attempt = this.getAttempt(value.launchAttemptId);
    if (!attempt || value.hash !== hashRecord(value.snapshot) || value.hash !== (value.phase === 'before' ? attempt.beforeFactsHash : attempt.desiredFactsHash)) fail('Facts do not match their immutable attempt snapshot.');
    const old = this.getFacts(value.launchAttemptId, value.phase);
    if (old) { if (!same(old, value)) fail('Attempt facts are immutable.'); return; }
    this.connection.prepare('INSERT INTO facts VALUES(?,?,?,?)').run(value.launchAttemptId, value.phase, value.version, JSON.stringify(value));
  }
  getFacts(attemptId: string, phase: AttemptFacts['phase'] | number): AttemptFacts | null { return this.read('SELECT payload FROM facts WHERE attempt_id=? AND ' + (typeof phase === 'number' ? 'version' : 'phase') + '=?', AttemptFactsSchema, attemptId, phase); }
  putRun(input: RemoteRun): void {
    const value = RemoteRunSchema.parse(input), attempt = this.getAttempt(value.launchAttemptId), old = this.getRun(value.id);
    if (!attempt || attempt.runId !== value.id || attempt.baselineHash !== value.baselineHash || this.getFacts(attempt.id, 'desired')?.version !== value.desiredFactVersion) fail('Run does not match its attempt snapshot.');
    if (!same(value.scope.assetIds, attempt.baseline.assets.map(asset => asset.assetId)) || !same(value.scope.urls, attempt.baseline.assets.map(asset => new URL(asset.pathname, attempt.baseline.target.productionOrigin).href)) || value.scope.corpusHash !== attempt.baseline.corpusHash || value.scope.inventoryHash !== attempt.baseline.inventoryHash) fail('Run scope does not match baseline.');
    if (old) {
      const core = ({ status: _s, stats: _t, errors: _e, updatedAt: _u, filteredPassageIds: _f, ...rest }: RemoteRun) => rest;
      if (!same(core(old), core(value))) fail('Run identity and snapshots are immutable.');
      assertRunTransition(old.status, value.status);
      if (old.status === 'failed' && !same(old, value)) fail('Failed runs are frozen.');
      if (old.status === 'ready' && (!same(old.filteredPassageIds, value.filteredPassageIds) || !same(old.errors, value.errors))) fail('Complete run analysis is immutable.');
      const analysisStats = ({ reviewActions: _a, humanMs: _h, published: _p, verified: _v, ...rest }: RemoteRun['stats']) => rest;
      if (old.status === 'ready' && !same(analysisStats(old.stats), analysisStats(value.stats))) fail('Completed analysis counts and timing evidence are immutable.');
      if (Date.parse(value.updatedAt) < Date.parse(old.updatedAt)) fail('Run timestamps cannot move backward.');
    } else if (value.status !== 'collecting') fail('New runs start collecting.');
    if (attempt.state !== 'active' && (!old || !same(old, value))) fail('Inactive attempts cannot change analysis.');
    if (value.status !== 'failed' && old?.status !== 'ready' && (this.now().getTime() > Date.parse(value.deadlineAt) || Date.parse(value.updatedAt) > Date.parse(value.deadlineAt))) fail('Run deadline expired; record a failed run.');
    if (value.status === 'ready' && (value.stats.allResultsReadyMs === null || value.stats.allResultsReadyMs > value.fullRunDeadlineMs)) fail('Ready runs require all results before the deadline.');
    if (new Set(value.filteredPassageIds).size !== value.filteredPassageIds.length || value.filteredPassageIds.some(id => { const p = this.getRecord('passages', value.id, id, PassageSchema); return !p || prefilter(p); })) fail('Filtered passages must be unique captured passages that fail the pricing prefilter.');
    if (value.status === 'ready') this.assertClassifiedScope(value);
    this.connection.prepare('INSERT INTO runs VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(value.id, value.launchAttemptId, value.desiredFactVersion, JSON.stringify(value));
  }
  getRun(id: string): RemoteRun | null { return this.read('SELECT payload FROM runs WHERE id=?', RemoteRunSchema, id); }
  putPage(runId: string, input: Page): void {
    const page = PageSchema.parse(input), run = this.writableRun(runId), asset = this.getAttempt(run.launchAttemptId)!.baseline.assets.find(a => a.assetId === page.assetId);
    if (run.status === 'ready' && !this.getRecord('pages', run.id, page.assetId, PageSchema)) fail('Complete run snapshots are frozen.');
    if (!asset || asset.sourceHash !== page.sourceHash || asset.metadataHash !== page.metadataHash || asset.surface !== page.surface || asset.editable !== page.editable || page.file !== (asset.path === null ? null : asset.path.slice('content/'.length)) || page.url !== new URL(asset.pathname, this.getAttempt(run.launchAttemptId)!.baseline.target.productionOrigin).href) fail('Page does not match captured baseline.');
    this.immutable('pages', page.assetId, run, page, PageSchema);
  }
  putPassage(runId: string, input: Passage): void {
    const passage = PassageSchema.parse(input), run = this.writableRun(runId), page = this.getRecord('pages', runId, passage.assetId, PageSchema);
    if (run.status === 'ready' && !this.getRecord('passages', run.id, passage.id, PassageSchema)) fail('Complete run snapshots are frozen.');
    const asset = this.getAttempt(run.launchAttemptId)!.baseline.assets.find(a => a.assetId === passage.assetId);
    if (!page || !asset?.sourceIds.includes(passage.sourceId) || page.url !== passage.url) fail('Passage has no matching captured page/source ID.');
    this.immutable('passages', passage.id, run, passage, PassageSchema);
  }
  putJudgment(input: RemoteJudgment): void {
    const value = RemoteJudgmentSchema.parse(input), run = this.boundRun(value);
    if (run.status === 'ready' && !this.getRecord('judgments', run.id, value.passageId, RemoteJudgmentSchema)) fail('Complete run classification is frozen.');
    if (!this.getRecord('passages', run.id, value.passageId, PassageSchema) || value.factVersion !== run.desiredFactVersion) fail('Judgment has no matching captured passage/facts.');
    this.immutable('judgments', value.passageId, run, value, RemoteJudgmentSchema);
  }
  putPatch(input: RemotePatch): void {
    this.transaction(() => {
      const value = RemotePatchSchema.parse(input), run = this.boundRun(value), old = this.getPatch(run.id, value.id);
      if (run.status === 'ready' && !old) fail('Complete run correction membership is frozen.');
      const passage = this.getRecord('passages', run.id, value.passageId, PassageSchema);
      if (!passage || value.factVersion !== run.desiredFactVersion || value.assetId !== passage.assetId || value.sourceId !== passage.sourceId || value.original !== passage.text || value.url !== passage.url) fail('Patch has no matching captured passage/facts.');
      if (['published', 'verified', 'failed_verify'].includes(value.status)) fail('V2 patches do not use v1 local-publication states.');
      if (value.groupId && !this.getGroup(run.id, value.groupId)) fail('Patch group is not in its run.');
      if (!old && value.groupId && this.getGroup(run.id, value.groupId)?.sealedAt) fail('Sealed groups cannot gain new patch members.');
      if (old) {
        const core = (p: RemotePatch) => [p.launchAttemptId, p.runId, p.passageId, p.sourceId, p.assetId, p.url, p.surface, p.factVersion, p.kind, p.target, p.original, p.originalCapturedFileHash, p.groupId];
        if (!same(core(old), core(value)) || value.revision < old.revision || (!same(old, value) && value.revision <= old.revision)) fail('Patch identity is immutable; changes require a newer revision.');
        if (!same(old, value) && value.groupId) {
          const group = this.getGroup(run.id, value.groupId)!;
          if (this.getSubmission(run.id) || group.status === 'submitted') fail('Submitted candidates require abandonment, not edits.');
          if (group.sealedAt) this.store('groups', group.id, run, { ...group, status: 'blocked', approvalId: null, revision: group.revision + 1 });
        }
      }
      this.store('patches', value.id, run, value);
    });
  }
  getPatch(runId: string, id: string): RemotePatch | null { return this.getRecord('patches', runId, id, RemotePatchSchema); }
  putGroup(input: RemoteGroup): void {
    const value = RemoteGroupSchema.parse(input), run = this.boundRun(value), old = this.getGroup(run.id, value.id);
    if (run.status === 'ready' && !old) fail('Complete run correction membership is frozen.');
    if (value.factVersion !== run.desiredFactVersion) fail('Group fact snapshot mismatch.');
    if (value.membershipHash !== hashRecord([...value.memberIds].sort())) fail('Group membership hash mismatch.');
    if (old) {
      if (!same([old.runId, old.launchAttemptId, old.key, old.factVersion], [value.runId, value.launchAttemptId, value.key, value.factVersion]) || value.revision < old.revision) fail('Group identity/revision mismatch.');
      if (old.sealedAt && (!same([...old.memberIds].sort(), [...value.memberIds].sort()) || value.sealedAt !== old.sealedAt || value.status === 'collecting')) fail('Sealed group membership and time are immutable.');
      if (old.status === 'submitted' && !same(old, value)) fail('Submitted groups are immutable.');
      const changedMembership = !same([old.membershipHash, old.eligibleIds, old.excludedIds], [value.membershipHash, value.eligibleIds, value.excludedIds]);
      if (changedMembership && value.revision <= old.revision) fail('Changed eligible membership requires a newer revision.');
    }
    if (['sealed', 'approved', 'submitted'].includes(value.status)) this.assertSealable(value);
    if (value.approvalId) this.assertApproval(value, this.getApproval(run.id, value.approvalId));
    else if (['approved', 'submitted'].includes(value.status)) fail('Approved group needs its current approval.');
    this.store('groups', value.id, run, value);
  }
  getGroup(runId: string, id: string): RemoteGroup | null { return this.getRecord('groups', runId, id, RemoteGroupSchema); }
  assertSealable(group: RemoteGroup): void {
    const run = this.getRun(group.runId)!;
    if (!['drafting', 'ready'].includes(run.status)) fail('Full-scope classification must finish before sealing.');
    this.assertClassifiedScope(run);
    if (group.memberIds.some(id => { const patch = this.getPatch(run.id, id); return !patch || patch.groupId !== group.id; })) fail('Group has missing or foreign members.');
    if (this.patches(run.id).some(p => p.groupId === group.id && !group.memberIds.includes(p.id))) fail('Group omits a potential member.');
    for (const id of group.eligibleIds) {
      const patch = this.getPatch(run.id, id)!;
      const required = CheckNameSchema.options.filter(name => name !== 'tokens_kept' || patch.surface === 'email');
      if (patch.status !== 'drafted' || !patch.replacement || required.some(name => !patch.checks.some(check => check.name === name && check.pass)) || patch.checks.some(check => !check.pass)) fail('Eligible patch lacks complete passing checks.');
    }
    if (group.excludedIds.some(id => !['withheld', 'dropped', 'stale'].includes(this.getPatch(run.id, id)!.status))) fail('Excluded members need an explicit non-eligible outcome.');
  }
  assertApproval(group: RemoteGroup, approval: Approval | null): void {
    const attempt = this.getAttempt(group.launchAttemptId)!;
    if (!approval || approval.groupId !== group.id || approval.runId !== group.runId || approval.launchAttemptId !== group.launchAttemptId || approval.revision !== group.revision || approval.membershipHash !== group.membershipHash || !same(approval.eligibleIds, group.eligibleIds) || approval.desiredFactsHash !== attempt.desiredFactsHash) fail('Approval does not bind the current complete group revision.');
    if ('checkedPatchHash' in approval && approval.checkedPatchHash !== checkedPatchHash(group.eligibleIds.map(id => this.getPatch(group.runId, id)!))) fail('Checked patch identity changed after approval.');
  }
  putApproval(input: Approval): void {
    const value = ApprovalSchema.parse(input), run = this.boundRun(value), group = this.getGroup(run.id, value.groupId);
    if (!group) fail('Approval group is missing.');
    this.assertSealable(group); this.assertApproval(group, value);
    this.immutable('approvals', value.id, run, value, ApprovalSchema);
  }
  getApproval(runId: string, id: string): Approval | null { return this.getRecord('approvals', runId, id, ApprovalSchema); }
  putCandidate(input: Candidate): void {
    const value = CandidateSchema.parse(input), run = this.ownedRun(value), attempt = this.getAttempt(run.launchAttemptId)!;
    const old = this.getCandidate(run.id), core = ({ candidateSha: _s, ...rest }: Candidate) => rest;
    if (value.baselineHash !== attempt.baselineHash || value.baseSha !== attempt.baseline.baseSha || value.desiredFactsHash !== attempt.desiredFactsHash || value.purpose !== attempt.purpose) fail('Candidate baseline/facts/purpose mismatch.');
    if (old && (!same(core(old), core(value)) || (old.candidateSha !== null && old.candidateSha !== value.candidateSha))) fail('Candidate intent and assigned commit are immutable.');
    if (!old && (attempt.state !== 'active' || (attempt.purpose === 'correction' && run.status !== 'ready'))) fail('Candidate requires an active ready attempt.');
    if (attempt.purpose === 'correction') for (const group of this.groups(run.id).filter(g => g.eligibleIds.length)) {
      const approval = value.approvals.find(a => a.groupId === group.id);
      if (!['approved', 'submitted'].includes(group.status) || !approval || group.approvalId !== approval.id || !same(approval, this.getApproval(run.id, approval.id))) fail('Candidate requires all current eligible approvals.');
      this.assertApproval(group, approval);
    }
    if (value.approvals.some(a => a.runId !== run.id || a.launchAttemptId !== attempt.id)) fail('Candidate contains foreign approvals.');
    this.store('candidates', value.id, run, value);
  }
  getCandidate(runId: string): Candidate | null { return this.read('SELECT payload FROM candidates WHERE run_id=?', CandidateSchema, runId); }
  putCandidateImages(runId: string, images: Record<string, string>, checks: Record<string, Check[]> = {}): void {
    const candidate = this.getCandidate(runId);
    if (!candidate || !same(Object.keys(images).sort(), candidate.files.map(file => file.path).sort()) || candidate.files.some(file => typeof images[file.path] !== 'string' || sha256(images[file.path]) !== file.afterHash)) fail('Candidate images must exactly match the frozen path/hash bundle.');
    const verifiedChecks = z.record(z.string(), z.array(CheckSchema)).parse(checks);
    const old = this.getCandidateImages(runId);
    if (old) { if (!same(old, images) || !same(this.getCandidateChecks(runId), verifiedChecks)) fail('Candidate images and final checks are immutable.'); return; }
    this.connection.prepare('INSERT INTO candidate_images(run_id,candidate_id,bundle_hash,payload,checks_payload) VALUES(?,?,?,?,?)').run(runId, candidate.id, candidate.bundleHash, JSON.stringify(images), JSON.stringify(verifiedChecks));
  }
  getCandidateImages(runId: string): Record<string, string> | null { return this.read('SELECT payload FROM candidate_images WHERE run_id=?', z.record(z.string(), z.string()), runId); }
  getCandidateChecks(runId: string): Record<string, Check[]> | null { return this.read('SELECT checks_payload AS payload FROM candidate_images WHERE run_id=? AND checks_payload IS NOT NULL', z.record(z.string(), z.array(CheckSchema)), runId); }
  putSubmission(input: Submission): void {
    this.transaction(() => {
      const value = SubmissionSchema.parse(input), run = this.ownedRun(value), old = this.getSubmission(run.id);
      if (value.candidate.runId !== run.id || value.candidate.launchAttemptId !== run.launchAttemptId) fail('Submission candidate belongs to another attempt.');
      const core = (s: Submission) => [s.id, s.launchAttemptId, s.runId, s.operationId, s.requestFingerprint, s.createdAt, s.candidate.id];
      if (old && (!same(core(old), core(value)) || value.revision < old.revision || (!same(old, value) && value.revision <= old.revision) || (old.prNumber !== null && (old.prNumber !== value.prNumber || old.prUrl !== value.prUrl)) || (old.status === 'closed' && !same(old, value)))) fail('Submission identity/revision is immutable.');
      this.putCandidate(value.candidate); this.store('submissions', value.id, run, value);
    });
  }
  getSubmission(runId: string): Submission | null { return this.read('SELECT payload FROM submissions WHERE run_id=?', SubmissionSchema, runId); }
  putRecovery(input: Recovery): void {
    const value = RecoverySchema.parse(input), attempt = this.getAttempt(value.launchAttemptId);
    if (!attempt) fail('Recovery attempt is missing.');
    const run = this.getRun(attempt.runId)!;
    if (value.submissionId && value.submissionId !== this.getSubmission(run.id)?.id) fail('Recovery submission mismatch.');
    const old = this.getRecovery(value.id), core = (r: Recovery) => [r.id, r.launchAttemptId, r.submissionId, r.action, r.expectedAttemptRevision, r.expectedSubmissionRevision, r.requestFingerprint, r.createdAt];
    if (old && (!same(core(old), core(value)) || Date.parse(value.updatedAt) < Date.parse(old.updatedAt) || (old.status === 'reconciled' && !same(old, value)))) fail('Recovery identity and terminal evidence are immutable.');
    this.store('recoveries', value.id, run, value);
  }
  getRecovery(id: string): Recovery | null { return this.read('SELECT payload FROM recoveries WHERE id=?', RecoverySchema, id); }
  putObservation(input: DeploymentObservation): void {
    const value = DeploymentObservationSchema.parse(input), attempt = this.getAttempt(value.launchAttemptId);
    if (!attempt) fail('Observation attempt is missing.');
    const run = this.getRun(attempt.runId)!, submission = this.getSubmission(run.id);
    if (!submission || value.submissionId !== submission.id || value.candidateSha !== submission.candidate.candidateSha) fail('Observation submission/commit mismatch.');
    if (attempt.purpose === 'restoration' && value.blocks.length) fail('Restoration cannot record correction verification credit.');
    if (attempt.purpose === 'correction' && value.verification === 'passed') {
      const eligible = this.patches(run.id).filter(patch => patch.status === 'drafted').map(patch => patch.passageId).sort();
      const observed = value.blocks.map(block => block.passageId).sort();
      if (!eligible.length || !same(eligible, observed) || value.blocks.some(block => !block.judgment)) fail('Correction observation needs every eligible patch and fresh verdict.');
    }
    for (const block of value.blocks) if (block.judgment && (block.judgment.runId !== run.id || block.judgment.factVersion !== run.desiredFactVersion || block.judgment.adapter !== run.config.adapter || block.judgment.model !== run.config.judgeModel)) fail('Observation verdict identity mismatch.');
    this.immutable('observations', value.id, run, value, DeploymentObservationSchema);
  }
  addReviewEvent(input: RemoteReviewEvent): void {
    const event = RemoteReviewEventSchema.parse(input), run = this.getRun(event.runId);
    if (!run || event.launchAttemptId !== run.launchAttemptId || (event.groupId && !this.getGroup(run.id, event.groupId)) || (event.patchId && !this.getPatch(run.id, event.patchId))) fail('Review event ownership mismatch.');
    this.immutable('review_events', event.id, run, event, RemoteReviewEventSchema);
  }
  reviewActionCount(runId: string): number { return this.reviewEvents(runId).filter(e => e.actor === 'human' && ['approve', 'edit', 'drop', 'submit', 'abandon', 'reconcile', 'restore'].includes(e.action)).length; }
  replay(namespace: string, key: string, fingerprint: string): unknown | null {
    if (this.connection.prepare('SELECT key FROM legacy_keys WHERE key=?').get(key)) throw new RemoteStateError('idempotency_conflict', 'A historical v1 key cannot start or replay a v2 operation.');
    const row = this.connection.prepare('SELECT namespace,fingerprint,response FROM idempotency WHERE key=?').get(key) as { namespace: string; fingerprint: string; response: string } | undefined;
    if (!row) return null;
    if (row.namespace !== namespace || row.fingerprint !== fingerprint) throw new RemoteStateError('idempotency_conflict', 'Idempotency key conflicts with a different operation or payload.');
    return JSON.parse(row.response);
  }
  remember(namespace: string, key: string, fingerprint: string, response: unknown, at: string): void {
    const old = this.replay(namespace, key, fingerprint);
    if (old !== null) { if (!same(old, response)) fail('Original replay response is immutable.'); return; }
    this.connection.prepare('INSERT INTO idempotency VALUES(?,?,?,?,?)').run(namespace, key, fingerprint, JSON.stringify(response), at);
  }
  pages(runId: string): Page[] { return this.list('pages', runId, PageSchema); }
  passages(runId: string): Passage[] { return this.list('passages', runId, PassageSchema); }
  judgments(runId: string): RemoteJudgment[] { return this.list('judgments', runId, RemoteJudgmentSchema); }
  patches(runId: string): RemotePatch[] { return this.list('patches', runId, RemotePatchSchema); }
  groups(runId: string): RemoteGroup[] { return this.list('groups', runId, RemoteGroupSchema); }
  approvals(runId: string): Approval[] { return this.list('approvals', runId, ApprovalSchema); }
  recoveries(runId: string): Recovery[] { return this.list('recoveries', runId, RecoverySchema); }
  observations(runId: string): DeploymentObservation[] { return this.list('observations', runId, DeploymentObservationSchema); }
  reviewEvents(runId: string): RemoteReviewEvent[] { return this.list('review_events', runId, RemoteReviewEventSchema); }
  export(runId: string): z.infer<typeof RemoteExportSchema> {
    const run = this.getRun(runId), attempt = this.attemptForRun(runId);
    if (!run || !attempt) throw new RemoteStateError('not_found', 'Run not found.');
    const value = { contractVersion: 2, attempt, facts: [this.getFacts(attempt.id, 'before'), this.getFacts(attempt.id, 'desired')], run, pages: this.pages(runId), passages: this.passages(runId), groups: this.groups(runId), patches: this.patches(runId), judgments: this.judgments(runId), approvals: this.approvals(runId), submission: this.getSubmission(runId), observations: this.observations(runId), recoveries: this.recoveries(runId), reviewEvents: this.reviewEvents(runId) };
    return RemoteExportSchema.parse({ ...value, candidateChecks: this.getCandidateChecks(runId) });
  }
  private ownedRun(value: { runId: string; launchAttemptId: string }): RemoteRun { const run = this.getRun(value.runId); if (!run || run.launchAttemptId !== value.launchAttemptId) fail('Cross-run/attempt reference.'); return run; }
  private assertClassifiedScope(run: RemoteRun): void {
    const passages = this.passages(run.id), judgments = this.judgments(run.id), pages = this.pages(run.id), baseline = this.getAttempt(run.launchAttemptId)!.baseline;
    const captured = passages.map(p => [p.assetId, p.sourceId].join('\0')).sort();
    const required = baseline.assets.flatMap(a => a.sourceIds.map(sourceId => [a.assetId, sourceId].join('\0'))).sort();
    const classified = [...judgments.map(j => j.passageId), ...run.filteredPassageIds];
    if (run.errors.length || pages.length !== run.scope.assetIds.length || !same(captured, required) || passages.length !== classified.length || new Set(classified).size !== classified.length || !passages.length || passages.some(p => !classified.includes(p.id))) fail('Full-scope classification must finish before sealing or readiness.');
  }
  private boundRun(value: { runId: string; launchAttemptId: string }): RemoteRun { this.ownedRun(value); return this.writableRun(value.runId); }
  private writableRun(runId: string): RemoteRun {
    const run = this.getRun(runId);
    if (!run || this.getAttempt(run.launchAttemptId)?.state !== 'active' || run.status === 'failed') fail('Run is not accepting analysis changes.');
    if (run.status !== 'ready' && this.now().getTime() > Date.parse(run.deadlineAt)) fail('Run deadline expired; late results are rejected.');
    return run;
  }
  private store(table: typeof tables[number], id: string, run: RemoteRun, value: unknown): void { this.connection.prepare(`INSERT INTO ${table} VALUES(?,?,?,?) ON CONFLICT(run_id,id) DO UPDATE SET payload=excluded.payload`).run(id, run.id, run.launchAttemptId, JSON.stringify(value)); }
  private immutable<T>(table: typeof tables[number], id: string, run: RemoteRun, value: T, schema: z.ZodType<T>): void { const old = this.getRecord(table, run.id, id, schema); if (old) { if (!same(old, value)) fail('Captured snapshots, evidence and approvals are immutable.'); return; } this.store(table, id, run, value); }
  private getRecord<T>(table: typeof tables[number], runId: string, id: string, schema: z.ZodType<T>): T | null { return this.read(`SELECT payload FROM ${table} WHERE run_id=? AND id=?`, schema, runId, id); }
  private list<T>(table: typeof tables[number], runId: string, schema: z.ZodType<T>): T[] { return (this.connection.prepare(`SELECT payload FROM ${table} WHERE run_id=? ORDER BY rowid`).all(runId) as { payload: string }[]).map(row => schema.parse(JSON.parse(row.payload))); }
  private read<T>(sql: string, schema: z.ZodType<T>, ...params: (string | number)[]): T | null { const row = this.connection.prepare(sql).get(...params) as { payload: string } | undefined; return row ? schema.parse(JSON.parse(row.payload)) : null; }
}
