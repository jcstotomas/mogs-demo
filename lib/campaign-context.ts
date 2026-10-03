import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FactSnapshotSchema } from './types';
import { LaunchAttemptSchema, RemoteRunSchema } from './runs/remote-types';
import { hashRecord } from './hash';

/** Read stored launch evidence without initialization, recovery, or provider calls. */
export function campaignContext() {
  const packageRoot = path.resolve('experiments/multichannel-lab');
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'showcase/manifest.json'), 'utf8'));
  const entries = manifest.assets as Array<{ file: string }>;
  const imports = { assets: entries.length, emails: entries.filter(a => a.file.endsWith('.html')).length,
    decks: entries.filter(a => a.file.endsWith('.pdf')).length, creatives: entries.filter(a => /\.(png|jpe?g)$/i.test(a.file)).length };
  const fallback = { core: null, imports, factsCompatible: false };
  const databasePath = path.resolve(process.env.MOGS_REMOTE_DATABASE_PATH ?? 'data/remote/app.db');
  if (!existsSync(databasePath)) return { ...fallback, error: 'No saved website launch is available. Open the website review to begin.' };
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const attempts = db.prepare('SELECT payload FROM attempts ORDER BY rowid DESC').all() as Array<{ payload: string }>;
    const matching = attempts.map(row => LaunchAttemptSchema.parse(JSON.parse(row.payload))).filter(a =>
      a.baseline.target.repository === (process.env.MOGS_GITHUB_REPOSITORY ?? 'jcstotomas/mogs-demo') &&
      a.baseline.target.baseRef === (process.env.MOGS_GITHUB_BASE_REF ?? 'main') &&
      (!process.env.MOGS_PRODUCTION_ORIGIN || a.baseline.target.productionOrigin === process.env.MOGS_PRODUCTION_ORIGIN));
    const attempt = matching.find(a => !['verified', 'abandoned', 'reconciled_failure'].includes(a.state)) ?? matching[0];
    if (!attempt) return { ...fallback, error: 'No saved website launch is available. Open the website review to begin.' };
    const runRow = db.prepare('SELECT payload FROM runs WHERE id=?').get(attempt.runId) as { payload: string };
    const run = RemoteRunSchema.parse(JSON.parse(runRow.payload));
    if (run.mode !== 'live') return { ...fallback, error: 'The saved run is test evidence. Open the live website review.' };
    const facts = (phase: string) => {
      const row = db.prepare('SELECT payload FROM facts WHERE attempt_id=? AND phase=?').get(attempt.id, phase) as { payload: string };
      return FactSnapshotSchema.parse(JSON.parse(row.payload).snapshot);
    };
    const before = facts('before'), desired = facts('desired');
    const labBefore = JSON.parse(readFileSync(path.join(packageRoot, 'fixtures/facts/facts.initial.json'), 'utf8'));
    const labDesired = JSON.parse(readFileSync(path.join(packageRoot, 'fixtures/facts/facts.confirmed.json'), 'utf8'));
    const count = (table: 'pages' | 'passages' | 'patches' | 'groups' | 'approvals') =>
      Number((db.prepare(`SELECT count(*) AS n FROM ${table} WHERE run_id=?`).get(run.id) as { n: number }).n);
    const submission = db.prepare('SELECT payload FROM submissions WHERE run_id=?').get(run.id) as { payload: string } | undefined;
    return { imports, factsCompatible: hashRecord(before) === hashRecord(labBefore) && hashRecord(desired) === hashRecord(labDesired),
      core: { runId: run.id, status: run.status, attemptState: attempt.state, assets: count('pages'), passages: count('passages'),
        repairs: run.stats.patchesDrafted, groups: count('groups'), approvedGroups: count('approvals'),
        prUrl: submission ? JSON.parse(submission.payload).prUrl : null, reviewUrl: '/console/remote?runId=' + encodeURIComponent(run.id) + '#review',
        beforeMonthlyCents: before.plans.starter.monthlyCents, monthlyCents: desired.plans.starter.monthlyCents,
        annualCents: desired.plans.starter.annualCents, legacyMonthlyCents: desired.change.legacyRateCents } };
  } finally { db.close(); }
}
