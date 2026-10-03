import { DatabaseSync } from 'node:sqlite';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Asset, LabRun } from './contracts.ts';
import { assertEnabled } from './gate.ts';
export const PACKAGE_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const RUNTIME_ROOT=path.join(PACKAGE_ROOT,'.runtime');
export function confined(root:string,relative:string):string{
 const absolute=path.resolve(root,relative);
 if(absolute!==root&&!absolute.startsWith(root+path.sep))throw new Error('Storage path escapes the lab runtime.');
 let current=path.parse(absolute).root;
 for(const part of absolute.slice(current.length).split(path.sep)){current=path.join(current,part);if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error('Symbolic links are not allowed in lab storage.');}
 return absolute;
}
export class Store{
 readonly db:DatabaseSync;readonly root:string;closed=false;
 constructor(subdir='default'){
  assertEnabled();
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(subdir))throw new Error('Invalid lab storage name.');
  this.root=confined(RUNTIME_ROOT,subdir);mkdirSync(this.root,{recursive:true});
  if(realpathSync(this.root)!==this.root)throw new Error('Lab storage must resolve to its own runtime.');
  this.db=new DatabaseSync(this.file('lab.db'));
  this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,filename TEXT NOT NULL,active INTEGER NOT NULL,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);");
  this.db.prepare("INSERT OR IGNORE INTO meta VALUES('contract','mogs-lab-v1')").run();
  if((this.db.prepare("SELECT value FROM meta WHERE key='contract'").get() as {value:string}).value!=='mogs-lab-v1')throw new Error('Unsupported lab database.');
 }
 file(relative:string):string{return confined(this.root,relative)}
 read(relative:string):Buffer{assertEnabled();return readFileSync(this.file(relative))}
 write(relative:string,bytes:Buffer|string):void{assertEnabled();const file=this.file(relative);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,bytes,{flag:'wx'});}
 assets():Asset[]{return (this.db.prepare('SELECT payload FROM assets ORDER BY rowid DESC').all() as {payload:string}[]).map(row=>JSON.parse(row.payload));}
 asset(id:string):Asset{const row=this.db.prepare('SELECT payload FROM assets WHERE id=?').get(id) as {payload:string}|undefined;if(!row)throw Object.assign(new Error('Asset not found.'),{status:404});return JSON.parse(row.payload);}
 saveAsset(asset:Asset):void{assertEnabled();this.db.prepare('INSERT INTO assets VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET active=excluded.active,payload=excluded.payload').run(asset.id,asset.filename,Number(asset.active),JSON.stringify(asset));}
 activate(asset:Asset):void{assertEnabled();this.db.exec('BEGIN IMMEDIATE');try{for(const prior of this.assets().filter(a=>a.filename===asset.filename&&a.id!==asset.id&&a.active))this.saveAsset({...prior,active:false});this.saveAsset({...asset,active:true});this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
 runs():LabRun[]{return (this.db.prepare('SELECT payload FROM runs ORDER BY rowid DESC').all() as {payload:string}[]).map(row=>JSON.parse(row.payload));}
 run(id:string):LabRun{const row=this.db.prepare('SELECT payload FROM runs WHERE id=?').get(id) as {payload:string}|undefined;if(!row)throw Object.assign(new Error('Run not found.'),{status:404});return JSON.parse(row.payload);}
 saveRun(run:LabRun):void{assertEnabled();this.db.prepare('INSERT INTO runs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(run.id,JSON.stringify(run));}
 close():void{if(!this.closed){this.db.close();this.closed=true;}}
}
