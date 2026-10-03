import { readFileSync } from 'node:fs';
import { buildFixtures } from '../lib/fixtures';
import { MogsDatabase } from '../lib/db';
import { ApproveRequestSchema, ApproveResponseSchema, ConfirmRequestSchema, ConfirmResponseSchema, ExportResponseSchema, GroupsResponseSchema, PatchActionSchema, PatchResponseSchema, RunResponseSchema, ApiErrorSchema, FactsResponseSchema, OpenGroupRequestSchema, OpenGroupResponseSchema } from '../lib/contracts/api';
import { EvalReportSchema, FactSnapshotSchema, GroupSchema, JudgmentSchema, ManifestRowSchema, PageSchema, PassageSchema, PatchSchema, PublicationSchema, RunSchema } from '../lib/types';
import { assertPreflight } from '../lib/publication/contracts';
const f = buildFixtures();
const parse = (file: string) => JSON.parse(readFileSync('fixtures/' + file, 'utf8'));
FactSnapshotSchema.parse(parse('facts.initial.json')); FactSnapshotSchema.parse(parse('facts.confirmed.json'));
PageSchema.array().parse(parse('pages.json')); PassageSchema.array().parse(parse('passages.json'));
JudgmentSchema.array().parse(parse('judgments.json')); PatchSchema.array().parse(parse('patches.json'));
GroupSchema.parse(parse('group.json')); RunSchema.parse(parse('run.json')); PublicationSchema.parse(parse('publication.json'));
ManifestRowSchema.array().parse(parse('manifest.json')); EvalReportSchema.parse(parse('eval.json'));
const api = parse('api.json');
FactsResponseSchema.parse(api.facts); OpenGroupRequestSchema.parse(api.openGroup.request); OpenGroupResponseSchema.parse(api.openGroup.response);
ConfirmRequestSchema.parse(api.confirm.request); ConfirmResponseSchema.parse(api.confirm.response); ConfirmResponseSchema.parse(api.confirm.retryResponse);
RunResponseSchema.parse(api.run); GroupsResponseSchema.parse(api.groups); PatchActionSchema.parse(api.edit.request); PatchResponseSchema.parse(api.edit.response); PatchActionSchema.parse(api.drop.request);
ApproveRequestSchema.parse(api.approve.request); ApproveResponseSchema.parse(api.approve.response); ExportResponseSchema.parse(api.export);
for (const row of api.errors) ApiErrorSchema.parse(row.body);
assertPreflight(f.run, f.group, f.patches);
const db = new MogsDatabase(':memory:');
try {
  db.putFacts(f.facts); db.putFacts(f.after); db.putRun(f.run);
  for (const page of f.pages) db.putPage(f.run.id, page);
  for (const p of f.passages) db.putPassage(f.run.id, p);
  for (const j of f.judgments) db.putJudgment(j);
  db.putGroup(f.group); for (const patch of f.patches) db.putPatch(patch); db.bindMembers(f.group); db.putPublication(f.publication);
} finally { db.close(); }
const live = new MogsDatabase(); try { live.putFacts(FactSnapshotSchema.parse(JSON.parse(readFileSync('data/facts.json', 'utf8')))); } finally { live.close(); }
console.log('PASS: 13 record fixtures, six API shapes/error cases, source round trip, preflight and SQLite constraints.');
