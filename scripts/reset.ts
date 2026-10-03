import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { access, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { MogsDatabase } from '../lib/db';
import { FactSnapshotSchema, HashSchema } from '../lib/types';
import { parseSource } from '../lib/assets/source';
import { hashRecord, sha256 } from '../lib/hash';

const SeedSchema = z.object({ format: z.literal('mogs-content-seed-v1'), scope: z.literal('miniature-gate-1'), sources: z.record(z.string(), z.object({ source: z.string(), hash: HashSchema }).strict()), corpusHash: HashSchema, manifestHash: HashSchema, initialFactHash: HashSchema }).strict();
const LockSchema = z.object({ pid: z.number().int().positive(), operation: z.enum(['confirm', 'publish', 'reset']), startedAt: z.iso.datetime() }).strict();
async function exists(file: string): Promise<boolean> { try { await access(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } }
async function assertIdle(root: string, databasePath: string): Promise<void> {
  if (await exists(path.join(root, 'data/confirm-journal.json'))) throw new Error('A confirmation journal needs coordinator recovery before reset. Start the server to recover it.');
  const readers=path.join(root,'data/readers');
  if(await exists(readers))for(const entry of await readdir(readers)){
    try{const lease=JSON.parse(await readFile(path.join(readers,entry),'utf8')) as {pid:number};if(alive(lease.pid))throw new Error('A database request is still open; retry reset when the runtime is idle.');}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  if (!await exists(databasePath)) return;
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const run = database.prepare("SELECT id,status FROM runs WHERE mode='live' AND status IN ('collecting','classifying','drafting') LIMIT 1").get();
    const publication = database.prepare("SELECT id,status FROM publications WHERE status IN ('prepared','writing','published','recovering','blocked') LIMIT 1").get();
    if (run) throw new Error('An unfinished live run blocks reset; wait for completion or coordinator interruption recovery.');
    if (publication) throw new Error('An unfinished publication blocks reset; complete verification/recovery through the coordinator.');
  } finally { database.close(); }
}
async function writeAtomic(file: string, source: string): Promise<void> {
  const temporary = file + '.reset-' + process.pid;
  try { await writeFile(temporary, source, { flag: 'wx' }); await rename(temporary, file); }
  finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
}
async function main(): Promise<void> {
  const root = process.cwd(), databasePath = path.join(root, 'data/app.db'), lockPath = path.join(root, 'data/runtime.lock');
  if (process.env.MOGS_DATABASE_PATH && path.resolve(process.env.MOGS_DATABASE_PATH) !== databasePath) throw new Error('Reset only operates on the live data/app.db, never an evaluation or custom database.');
  const seed = SeedSchema.parse(JSON.parse(await readFile(path.join(root, 'content/seed.json'), 'utf8')));
  const manifestSource = await readFile(path.join(root, 'content/manifest.jsonl'), 'utf8');
  const factSource = await readFile(path.join(root, 'data/seed/facts.json'), 'utf8'), facts = FactSnapshotSchema.parse(JSON.parse(factSource));
  if (sha256(manifestSource) !== seed.manifestHash || sha256(factSource) !== seed.initialFactHash || facts.phase !== 'initial' || facts.version !== 1) throw new Error('Seed manifest or initial facts do not match their frozen hashes.');
  for (const [file, item] of Object.entries(seed.sources)) {
    const surface = file.startsWith('site/') ? 'web' : 'email';
    const asset = parseSource(item.source, file, surface);
    if (asset.sourceHash !== item.hash) throw new Error('Seed source hash mismatch: ' + file);
  }
  if (hashRecord(Object.entries(seed.sources).map(([file, item]) => ({ file, hash: item.hash }))) !== seed.corpusHash) throw new Error('Seed corpus hash mismatch.');
  if (await exists(lockPath)) {
    const lock = LockSchema.parse(JSON.parse(await readFile(lockPath, 'utf8')));
    if (alive(lock.pid)) throw new Error('Runtime is busy with ' + lock.operation + '; reset requires an idle runtime.');
    await assertIdle(root, databasePath);
    await unlink(lockPath);
  }
  const lock = await open(lockPath, 'wx');
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, operation: 'reset', startedAt: new Date().toISOString() }));
    await assertIdle(root, databasePath);
    for (const [file, item] of Object.entries(seed.sources)) await writeAtomic(path.join(root, 'content', file), item.source);
    await writeAtomic(path.join(root, 'data/facts.json'), factSource);
    for (const file of [databasePath, databasePath + '-wal', databasePath + '-shm']) await unlink(file).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
    const database = new MogsDatabase(databasePath);
    try { database.putFacts(facts); } finally { database.close(); }
    await unlink(path.join(root,'data/processing.json')).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});
    for (const [file, item] of Object.entries(seed.sources)) if (sha256(await readFile(path.join(root, 'content', file))) !== item.hash) throw new Error('Restored source hash mismatch: ' + file);
    if (sha256(await readFile(path.join(root, 'data/facts.json'))) !== seed.initialFactHash) throw new Error('Restored fact hash mismatch.');
    console.log(JSON.stringify({ reset: 'complete', scope: seed.scope, assets: Object.keys(seed.sources).length, corpusHash: seed.corpusHash, factHash: seed.initialFactHash, evaluationReports: 'preserved' }));
  } finally { await lock.close(); await unlink(lockPath); }
}
await main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
