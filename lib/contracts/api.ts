import { z } from 'zod';
import { FactSnapshotSchema, GroupSchema, JudgmentSchema, PageSchema, PassageSchema, PatchSchema, PublicationSchema, ReviewEventSchema, RunSchema } from '../types';
const Id = z.string().min(1);
const Revision = z.number().int().nonnegative();
export const FactsResponseSchema = z.object({ facts: FactSnapshotSchema, runId: Id.nullable() }).strict();
export const OpenGroupRequestSchema = z.object({ runId: Id }).strict();
export const OpenGroupResponseSchema = z.object({ openedAt: z.iso.datetime() }).strict();
export const ConfirmRequestSchema = z.object({ changeId: Id, expectedFactVersion: z.number().int().positive(), idempotencyKey: Id }).strict();
export const ConfirmResponseSchema = z.object({ changeId: Id, factVersion: z.number().int().positive(), confirmedAt: z.iso.datetime(), runId: Id }).strict();
export const PatchActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('edit'), expectedRevision: Revision, replacement: z.string().min(1) }).strict(),
  z.object({ action: z.literal('drop'), expectedRevision: Revision }).strict(),
]);
export const ApproveRequestSchema = z.object({ runId: Id, expectedRevision: Revision, idempotencyKey: Id }).strict();
export const ApproveResponseSchema = z.object({ publication: PublicationSchema }).strict();
export const RunResponseSchema = z.object({ run: RunSchema, groups: z.array(GroupSchema), publications: z.array(PublicationSchema) }).strict();
export const GroupsResponseSchema = z.object({ runId: Id, groups: z.array(GroupSchema), patches: z.array(PatchSchema), publications: z.array(PublicationSchema) }).strict();
export const PatchResponseSchema = z.object({ patch: PatchSchema, group: GroupSchema.nullable() }).strict();
export const ExportResponseSchema = z.object({ run: RunSchema, pages: z.array(PageSchema), passages: z.array(PassageSchema), judgments: z.array(JudgmentSchema), groups: z.array(GroupSchema), patches: z.array(PatchSchema), publications: z.array(PublicationSchema), reviewEvents: z.array(ReviewEventSchema) }).strict();
export const ApiErrorSchema = z.object({ error: z.object({ code: z.enum(['validation', 'not_found', 'stale', 'busy', 'idempotency_conflict', 'provider_failure', 'runtime_failure', 'interrupted']), message: z.string(), recordId: Id.optional(), currentRevision: Revision.optional(), retryable: z.boolean() }).strict() }).strict();
export type ConfirmRequest = z.infer<typeof ConfirmRequestSchema>;
export type ConfirmResponse = z.infer<typeof ConfirmResponseSchema>;
export type ApproveRequest = z.infer<typeof ApproveRequestSchema>;
export type PatchAction = z.infer<typeof PatchActionSchema>;
export type RunResponse = z.infer<typeof RunResponseSchema>;
export type GroupsResponse = z.infer<typeof GroupsResponseSchema>;
export type ExportResponse = z.infer<typeof ExportResponseSchema>;
export type FactsResponse = z.infer<typeof FactsResponseSchema>;
