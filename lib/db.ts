import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { FactSnapshotSchema, GroupSchema, JudgmentSchema, PageSchema, PassageSchema, PatchSchema, PublicationSchema, ReviewEventSchema, RunSchema, type FactSnapshot, type Group, type Judgment, type Page, type Passage, type Patch, type Publication, type ReviewEvent, type Run } from './types';
import { hashRecord } from './hash';
import { assertRunTransition } from './runs/contracts';

const MIGRATION = `
CREATE TABLE IF NOT EXISTS fact_snapshots (
 version INTEGER PRIMARY KEY, scenario_id TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload))
);
CREATE TABLE IF NOT EXISTS runs (
 id TEXT PRIMARY KEY, change_id TEXT NOT NULL, fact_version INTEGER NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('live','eval','fixture')),
 status TEXT NOT NULL CHECK(status IN ('collecting','classifying','drafting','ready','failed')), payload TEXT NOT NULL CHECK(json_valid(payload)),
 UNIQUE(id,fact_version), FOREIGN KEY(fact_version) REFERENCES fact_snapshots(version)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_live_run ON runs(mode) WHERE mode='live';
CREATE UNIQUE INDEX IF NOT EXISTS one_live_change ON runs(change_id) WHERE mode='live';
CREATE TABLE IF NOT EXISTS pages (
 run_id TEXT NOT NULL, asset_id TEXT NOT NULL, source_hash TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 PRIMARY KEY(run_id,asset_id), FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS passages (
 run_id TEXT NOT NULL, id TEXT NOT NULL, asset_id TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 PRIMARY KEY(run_id,id), FOREIGN KEY(run_id,asset_id) REFERENCES pages(run_id,asset_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS judgments (
 run_id TEXT NOT NULL, passage_id TEXT NOT NULL, fact_version INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 PRIMARY KEY(run_id,passage_id), FOREIGN KEY(run_id,passage_id) REFERENCES passages(run_id,id), FOREIGN KEY(run_id,fact_version) REFERENCES runs(id,fact_version)
);
CREATE TABLE IF NOT EXISTS correction_groups (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, fact_version INTEGER NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 UNIQUE(run_id,id), FOREIGN KEY(run_id,fact_version) REFERENCES runs(id,fact_version)
);
CREATE TABLE IF NOT EXISTS patches (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, passage_id TEXT NOT NULL, group_id TEXT, fact_version INTEGER NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 UNIQUE(run_id,id), FOREIGN KEY(run_id,passage_id) REFERENCES passages(run_id,id), FOREIGN KEY(run_id,group_id) REFERENCES correction_groups(run_id,id), FOREIGN KEY(run_id,fact_version) REFERENCES runs(id,fact_version)
);
CREATE TABLE IF NOT EXISTS group_members (
 run_id TEXT NOT NULL, group_id TEXT NOT NULL, patch_id TEXT NOT NULL, eligible INTEGER NOT NULL CHECK(eligible IN (0,1)),
 PRIMARY KEY(run_id,group_id,patch_id), UNIQUE(run_id,patch_id), FOREIGN KEY(run_id,group_id) REFERENCES correction_groups(run_id,id), FOREIGN KEY(run_id,patch_id) REFERENCES patches(run_id,id)
);
CREATE TABLE IF NOT EXISTS publications (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, group_id TEXT NOT NULL UNIQUE, fact_version INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 FOREIGN KEY(run_id,group_id) REFERENCES correction_groups(run_id,id), FOREIGN KEY(run_id,fact_version) REFERENCES runs(id,fact_version)
);
CREATE TABLE IF NOT EXISTS review_events (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, group_id TEXT, patch_id TEXT, action TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 FOREIGN KEY(run_id) REFERENCES runs(id), FOREIGN KEY(run_id,group_id) REFERENCES correction_groups(run_id,id), FOREIGN KEY(run_id,patch_id) REFERENCES patches(run_id,id)
);
CREATE TABLE IF NOT EXISTS idempotency (
 namespace TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL CHECK(json_valid(response)), created_at TEXT NOT NULL,
 PRIMARY KEY(namespace,key)
);
CREATE INDEX IF NOT EXISTS patches_by_run_group ON patches(run_id,group_id);
CREATE INDEX IF NOT EXISTS groups_by_run ON correction_groups(run_id);
CREATE INDEX IF NOT EXISTS publications_by_status ON publications(status);
PRAGMA user_version = 1;
`;
export class MogsDatabase {
  readonly connection: DatabaseSync;
  private transactionDepth = 0;
  constructor(readonly file = process.env.MOGS_DATABASE_PATH ?? 'data/app.db') {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.connection = new DatabaseSync(file);
    this.connection.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (file !== ':memory:') this.connection.exec('PRAGMA journal_mode = WAL;');
    const version = this.connection.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version > 1) { this.close(); throw new Error('Unsupported database schema version.'); }
    this.connection.exec(MIGRATION);
  }
  close(): void { this.connection.close(); }
  transaction<T>(operation: () => T): T {
    if (this.transactionDepth) return operation();
    this.connection.exec('BEGIN IMMEDIATE');
    this.transactionDepth++;
    try { const value = operation(); this.connection.exec('COMMIT'); return value; }
    catch (error) { this.connection.exec('ROLLBACK'); throw error; }
    finally { this.transactionDepth--; }
  }
  putFacts(input: FactSnapshot): void {
    const facts = FactSnapshotSchema.parse(input), existing = this.getFacts(facts.version);
    if (existing) { if (hashRecord(existing) !== hashRecord(facts)) throw new Error('Fact snapshots are immutable.'); return; }
    this.connection.prepare('INSERT INTO fact_snapshots(version,scenario_id,payload) VALUES(?,?,?)').run(facts.version, facts.scenarioId, JSON.stringify(facts));
  }
  getFacts(version: number): FactSnapshot | null { return this.read('SELECT payload FROM fact_snapshots WHERE version=?', FactSnapshotSchema, version); }
  putRun(input: Run): void {
    const run = RunSchema.parse(input), existing = this.getRun(run.id);
    if (existing && hashRecord({ scope: existing.scope, config: existing.config, factVersion: existing.factVersion, confirmedAt: existing.confirmedAt, changeId: existing.changeId, mode: existing.mode }) !== hashRecord({ scope: run.scope, config: run.config, factVersion: run.factVersion, confirmedAt: run.confirmedAt, changeId: run.changeId, mode: run.mode })) throw new Error('Run snapshot/config/confirmation are immutable.');
    if (existing) assertRunTransition(existing.status, run.status);
    this.connection.prepare('INSERT INTO runs(id,change_id,fact_version,mode,status,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload').run(run.id, run.changeId, run.factVersion, run.mode, run.status, JSON.stringify(run));
  }
  getRun(id: string): Run | null { return this.read('SELECT payload FROM runs WHERE id=?', RunSchema, id); }
  putPage(runId: string, input: Page): void { const page = PageSchema.parse(input); this.connection.prepare('INSERT INTO pages(run_id,asset_id,source_hash,payload) VALUES(?,?,?,?) ON CONFLICT(run_id,asset_id) DO UPDATE SET source_hash=excluded.source_hash,payload=excluded.payload').run(runId, page.assetId, page.sourceHash, JSON.stringify(page)); }
  putPassage(runId: string, input: Passage): void {
    const p = PassageSchema.parse(input), existing = this.read('SELECT payload FROM passages WHERE run_id=? AND id=?', PassageSchema, runId, p.id);
    if (existing && hashRecord([existing.assetId, existing.sourceId, existing.url, existing.surface, existing.role]) !== hashRecord([p.assetId, p.sourceId, p.url, p.surface, p.role])) throw new Error('Passage identity is immutable.');
    this.connection.prepare('INSERT INTO passages(run_id,id,asset_id,payload) VALUES(?,?,?,?) ON CONFLICT(run_id,id) DO UPDATE SET payload=excluded.payload').run(runId, p.id, p.assetId, JSON.stringify(p));
  }
  putJudgment(input: Judgment): void {
    const j = JudgmentSchema.parse(input);
    if (this.getRun(j.runId)?.factVersion !== j.factVersion) throw new Error('Judgment fact version does not match its run.');
    this.connection.prepare('INSERT INTO judgments(run_id,passage_id,fact_version,payload) VALUES(?,?,?,?) ON CONFLICT(run_id,passage_id) DO UPDATE SET payload=excluded.payload').run(j.runId, j.passageId, j.factVersion, JSON.stringify(j));
  }
  putGroup(input: Group): void {
    const g = GroupSchema.parse(input), existing = this.read('SELECT payload FROM correction_groups WHERE id=?', GroupSchema, g.id);
    if (existing && hashRecord([existing.runId, existing.factVersion, existing.key]) !== hashRecord([g.runId, g.factVersion, g.key])) throw new Error('Group identity is immutable.');
    if (existing && (g.revision < existing.revision || (existing.sealedAt !== null && (g.sealedAt !== existing.sealedAt || hashRecord([...existing.memberIds].sort()) !== hashRecord([...g.memberIds].sort()) || g.status === 'collecting')))) throw new Error('Sealed membership/timestamp and monotonic revision must be preserved.');
    this.connection.prepare('INSERT INTO correction_groups(id,run_id,fact_version,revision,status,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,status=excluded.status,payload=excluded.payload').run(g.id, g.runId, g.factVersion, g.revision, g.status, JSON.stringify(g));
  }
  getGroup(runId: string, id: string): Group | null { return this.read('SELECT payload FROM correction_groups WHERE run_id=? AND id=?', GroupSchema, runId, id); }
  putPatch(input: Patch): void {
    const p = PatchSchema.parse(input), existing = this.read('SELECT payload FROM patches WHERE id=?', PatchSchema, p.id);
    const identity = (patch: Patch) => [patch.runId, patch.passageId, patch.sourceId, patch.assetId, patch.url, patch.surface, patch.factVersion, patch.kind, patch.target, patch.original, patch.originalCapturedFileHash];
    if (existing && (hashRecord(identity(existing)) !== hashRecord(identity(p)) || p.revision < existing.revision)) throw new Error('Patch identity and monotonic revision must be preserved.');
    this.connection.prepare('INSERT INTO patches(id,run_id,passage_id,group_id,fact_version,revision,status,payload) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET group_id=excluded.group_id,revision=excluded.revision,status=excluded.status,payload=excluded.payload').run(p.id, p.runId, p.passageId, p.groupId, p.factVersion, p.revision, p.status, JSON.stringify(p));
  }
  getPatch(runId: string, id: string): Patch | null { return this.read('SELECT payload FROM patches WHERE run_id=? AND id=?', PatchSchema, runId, id); }
  bindMembers(group: Group): void {
    const g = GroupSchema.parse(group);
    const stored = this.getGroup(g.runId, g.id);
    if (!stored || hashRecord(stored) !== hashRecord(g)) throw new Error('Member binding requires the current stored group.');
    this.transaction(() => {
      this.connection.prepare('DELETE FROM group_members WHERE run_id=? AND group_id=?').run(g.runId, g.id);
      for (const patchId of g.memberIds) {
        const patch = this.getPatch(g.runId, patchId);
        if (!patch || patch.groupId !== g.id) throw new Error('Group member patch association mismatch.');
        this.connection.prepare('INSERT INTO group_members(run_id,group_id,patch_id,eligible) VALUES(?,?,?,?)').run(g.runId, g.id, patchId, g.eligibleIds.includes(patchId) ? 1 : 0);
      }
    });
  }
  putPublication(input: Publication): void {
    const p = PublicationSchema.parse(input), existing = this.read('SELECT payload FROM publications WHERE id=?', PublicationSchema, p.id);
    const identity = (publication: Publication) => [publication.runId, publication.groupId, publication.factVersion, publication.idempotencyKey, publication.requestFingerprint, publication.approvedRevision, publication.approvedMemberIds, publication.actor, publication.createdAt];
    if (existing && hashRecord(identity(existing)) !== hashRecord(identity(p))) throw new Error('Publication approval identity is immutable.');
    this.connection.prepare('INSERT INTO publications(id,run_id,group_id,fact_version,status,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload').run(p.id, p.runId, p.groupId, p.factVersion, p.status, JSON.stringify(p));
  }
  addReviewEvent(input: ReviewEvent): void { const e = ReviewEventSchema.parse(input); this.connection.prepare('INSERT INTO review_events(id,run_id,group_id,patch_id,action,actor,at,payload) VALUES(?,?,?,?,?,?,?,?)').run(e.id, e.runId, e.groupId, e.patchId, e.action, e.actor, e.at, JSON.stringify(e)); }
  reviewActionCount(runId: string): number { const row = this.connection.prepare("SELECT count(*) AS total FROM review_events WHERE run_id=? AND actor='human' AND action IN ('approve','edit','drop')").get(runId) as { total: number }; return row.total; }
  replay(namespace: string, key: string, fingerprint: string): unknown | null {
    const row = this.connection.prepare('SELECT fingerprint,response FROM idempotency WHERE namespace=? AND key=?').get(namespace, key) as { fingerprint: string; response: string } | undefined;
    if (!row) return null;
    if (row.fingerprint !== fingerprint) throw new Error('Idempotency key conflicts with another payload.');
    return JSON.parse(row.response);
  }
  remember(namespace: string, key: string, fingerprint: string, response: unknown, createdAt: string): void {
    this.connection.prepare('INSERT INTO idempotency(namespace,key,fingerprint,response,created_at) VALUES(?,?,?,?,?)').run(namespace, key, fingerprint, JSON.stringify(response), createdAt);
  }
  liveRun(): Run | null { return this.read("SELECT payload FROM runs WHERE mode='live'", RunSchema); }
  latestRun(mode: Run['mode']): Run | null { return this.read('SELECT payload FROM runs WHERE mode=? ORDER BY rowid DESC LIMIT 1', RunSchema, mode); }
  pages(runId: string): Page[] { return this.list('pages', PageSchema, runId); }
  passages(runId: string): Passage[] { return this.list('passages', PassageSchema, runId); }
  judgments(runId: string): Judgment[] { return this.list('judgments', JudgmentSchema, runId); }
  groups(runId: string): Group[] { return this.list('correction_groups', GroupSchema, runId); }
  patches(runId: string): Patch[] { return this.list('patches', PatchSchema, runId); }
  publications(runId: string): Publication[] { return this.list('publications', PublicationSchema, runId); }
  reviewEvents(runId: string): ReviewEvent[] { return this.list('review_events', ReviewEventSchema, runId); }
  private list<T>(table: string, schema: z.ZodType<T>, runId: string): T[] {
    return (this.connection.prepare('SELECT payload FROM '+table+' WHERE run_id=? ORDER BY rowid').all(runId) as {payload:string}[]).map(row => schema.parse(JSON.parse(row.payload)));
  }
  private read<T>(sql: string, schema: z.ZodType<T>, ...params: (string | number)[]): T | null { const row = this.connection.prepare(sql).get(...params) as { payload: string } | undefined; return row ? schema.parse(JSON.parse(row.payload)) : null; }
}
