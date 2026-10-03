import { z } from 'zod';
import { BaselineSchema, CandidateSchema } from './remote-types';
import { CheckSchema, FactSnapshotSchema, HashSchema } from '../types';

/** Read-only views shared by the local console and versioned HTTP handlers. */
export const RemoteBaselineViewSchema = z.object({
  contractVersion: z.literal(2), baseline: BaselineSchema, baselineHash: HashSchema,
  beforeFacts: FactSnapshotSchema, desiredFacts: FactSnapshotSchema,
  activeRunId: z.string().min(1).nullable(),
  enforcement: z.object({ available: z.boolean(), message: z.string() }).strict(),
}).strict();
export const RemoteCandidateViewSchema = z.object({ candidate: CandidateSchema, checks: z.record(z.string(), z.array(CheckSchema)) }).strict();
export const RemoteObserveRequestSchema = z.object({ contractVersion: z.literal(2), launchAttemptId: z.string().min(1), runId: z.string().min(1) }).strict();
export type RemoteBaselineView = z.infer<typeof RemoteBaselineViewSchema>;
export type RemoteCandidateView = z.infer<typeof RemoteCandidateViewSchema>;
