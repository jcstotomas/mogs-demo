import { mkdir, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { RemoteDatabase } from '../lib/runs/remote-db';
import { loadLocalEnv } from '../lib/providers/env';
import { hashRecord } from '../lib/hash';

loadLocalEnv();
const source = process.env.MOGS_DATABASE_PATH ?? 'data/app.db';
const destination = process.env.MOGS_REMOTE_DATABASE_PATH ?? 'data/remote/app.db';
function sourceIdentity(): string {
  const sourceDb = new DatabaseSync(source, { readOnly: true });
  try {
    sourceDb.exec('BEGIN');
    const schema = sourceDb.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const tables = sourceDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
    const rows = tables.map(({ name }) => ({ table: name, rows: sourceDb.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all() }));
    return hashRecord({ schema, rows });
  } finally { sourceDb.close(); }
}
const sourceBeforeHash = sourceIdentity();
const db = new RemoteDatabase(destination, { legacyPath: source });
try {
  const imported = await db.importLegacy(source);
  const tables = ['fact_snapshots', 'runs', 'pages', 'passages', 'judgments', 'correction_groups', 'patches', 'group_members', 'publications', 'review_events', 'idempotency'];
  const tableCounts = Object.fromEntries(tables.map(table => [table, db.legacyRows(imported.archiveId, table).length]));
  const sourceAfterHash = sourceIdentity();
  const activeV2Attempts = (db.connection.prepare("SELECT COUNT(*) AS count FROM attempts WHERE state NOT IN ('verified','abandoned','reconciled_failure')").get() as { count: number }).count;
  const record = { contractVersion: 2, checkedAt: new Date().toISOString(), source, destination, archiveId: imported.archiveId, rawRowsPreserved: imported.rows, tableCounts, sourceBeforeHash, sourceAfterHash, observedSourceUnchanged: sourceBeforeHash === sourceAfterHash, archiveMatchesSource: imported.archiveId === sourceBeforeHash && imported.archiveId === sourceAfterHash, activeV2Attempts, note: 'Online read-only backup imported into separate v2 state. Source hashes are observed before/after the operation; concurrent v1 writes would change that observation. This records historical migration, not remote publication or a contract gate pass.' };
  await mkdir('data/evidence/remote0', { recursive: true });
  await writeFile('data/evidence/remote0/migration.json', JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record, null, 2));
} finally { db.close(); }
