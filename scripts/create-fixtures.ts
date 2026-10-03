import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { buildFixtures } from '../lib/fixtures';
import { ApiErrorSchema } from '../lib/contracts/api';
const f = buildFixtures();
mkdirSync('data/seed', { recursive: true });
const write = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
if (!existsSync('data/facts.json')) write('data/facts.json', f.facts);
if (!existsSync('data/seed/facts.json')) write('data/seed/facts.json', f.facts);
write('fixtures/facts.initial.json', f.facts);
write('fixtures/facts.confirmed.json', f.after);
write('fixtures/pages.json', f.pages);
write('fixtures/passages.json', f.passages);
write('fixtures/judgments.json', f.judgments);
write('fixtures/patches.json', f.patches);
write('fixtures/group.json', f.group);
write('fixtures/run.json', f.run);
write('fixtures/publication.json', f.publication);
write('fixtures/manifest.json', f.manifest);
write('fixtures/eval.json', f.evaluation);
const confirm = { changeId: f.facts.change.id, expectedFactVersion: 1, idempotencyKey: 'fixture-confirm' };
const confirmed = { changeId: f.facts.change.id, factVersion: 2, confirmedAt: f.run.confirmedAt, runId: f.run.id };
write('fixtures/api.json', {
  facts: { facts: f.facts, runId: null },
  openGroup: { request: {runId:f.run.id}, response: {openedAt:f.run.confirmedAt} },
  confirm: { request: confirm, response: confirmed, retryResponse: confirmed },
  run: { run: f.run, groups: [f.group], publications: [] },
  groups: { runId: f.run.id, groups: [f.group], patches: f.patches, publications: [] },
  edit: { request: { action: 'edit', expectedRevision: 0, replacement: 'Starter is $40 a month.' }, response: { patch: f.patches[0], group: f.group } },
  drop: { request: { action: 'drop', expectedRevision: 0 } },
  approve: { request: { runId: f.run.id, expectedRevision: 0, idempotencyKey: 'fixture-approve' }, response: { publication: f.publication } },
  export: { run: f.run, pages: f.pages, passages: f.passages, judgments: f.judgments, groups: [f.group], patches: f.patches, publications: [], reviewEvents: [] },
  errors: [
    { status: 400, code: 'validation', message: 'Malformed request.' }, { status: 404, code: 'not_found', message: 'Run not found.' },
    { status: 409, code: 'stale', message: 'Group revision changed.' }, { status: 409, code: 'busy', message: 'Live run already exists.' },
    { status: 409, code: 'idempotency_conflict', message: 'Key has another payload.' }, { status: 502, code: 'provider_failure', message: 'Provider request failed.' },
    { status: 500, code: 'runtime_failure', message: 'Publication failed.' }, { status: 503, code: 'interrupted', message: 'Run interrupted.' },
  ].map(row => ({ status: row.status, body: ApiErrorSchema.parse({ error: { code: row.code, message: row.message, retryable: row.status >= 500 } }) })),
});
console.log('Created typed Step 0 fixtures; these are not live provider or evaluation results.');
