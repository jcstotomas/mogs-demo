import { z } from 'zod';
import { ApproveRequestSchema, AbandonRequestSchema, ApprovalSchema, ConfirmRequestSchema, LaunchAttemptSchema, ReconcileRequestSchema, RecoverySchema, RemoteExportSchema, RemoteRunSchema, RestoreRequestSchema, SubmitRequestSchema, SubmissionSchema } from '@/lib/runs/remote-types';
import { RemoteStateError } from '@/lib/runs/remote-db';
import { assertLocalRequest, json, pathId, remoteApiError, requestBody, sameRun, type PathContext } from './http';

const startResponse = z.object({ attempt: LaunchAttemptSchema, run: RemoteRunSchema }).strict();
const approveResponse = z.object({ approval: ApprovalSchema }).strict();
const submitResponse = z.object({ submission: SubmissionSchema }).strict();
const recoverResponse = z.object({ recovery: RecoverySchema }).strict();
function output<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw Object.assign(new Error('The coordinator returned invalid state.'), { code: 'remote_failure' });
  return result.data;
}
export interface RemoteHttpRuntime {
  baseline(): Promise<unknown>;
  confirm(request: z.infer<typeof ConfirmRequestSchema>): Promise<unknown>;
  approve(groupId: string, request: z.infer<typeof ApproveRequestSchema>): unknown;
  run(runId: string): unknown;
  candidate(runId: string): Promise<unknown>;
  submit(request: z.infer<typeof SubmitRequestSchema>): Promise<unknown>;
  abandon(request: z.infer<typeof AbandonRequestSchema>): Promise<unknown>;
  reconcile(request: z.infer<typeof ReconcileRequestSchema>): Promise<unknown>;
  restore(request: z.infer<typeof RestoreRequestSchema>): Promise<unknown>;
  observe(runId: string): Promise<unknown>;
}
/** Thin typed dispatch; coordinator services own lifecycle and remote effects. */
export function createRemoteHttpHandlers(runtime: RemoteHttpRuntime, schemas: { baseline: z.ZodType; candidate: z.ZodType; observe: z.ZodType<{ contractVersion: 2; launchAttemptId: string; runId: string }> }, schedule: (runId: string) => void) {
  const read = (operation: (request: Request, context?: PathContext) => unknown | Promise<unknown>) => async (request: Request, context?: PathContext) => {
    try { assertLocalRequest(request); return json(await operation(request, context)); } catch (error) { return remoteApiError(error); }
  };
  return {
    getBaseline: read(async () => output(schemas.baseline, await runtime.baseline())),
    postFacts: read(async request => {
      const response = output(startResponse, await runtime.confirm(await requestBody(request, ConfirmRequestSchema)));
      schedule(response.run.id);
      return response;
    }),
    getRun: async (request: Request, context: PathContext) => {
      try { assertLocalRequest(request); return json(output(RemoteExportSchema, runtime.run(await pathId(context, 'runId')))); } catch (error) { return remoteApiError(error); }
    },
    getExport: async (request: Request, context: PathContext) => {
      try { assertLocalRequest(request); return json(output(RemoteExportSchema, runtime.run(await pathId(context, 'runId')))); } catch (error) { return remoteApiError(error); }
    },
    getCandidate: async (request: Request, context: PathContext) => {
      try { assertLocalRequest(request); return json(output(schemas.candidate, await runtime.candidate(await pathId(context, 'runId')))); } catch (error) { return remoteApiError(error); }
    },
    postApprove: async (request: Request, context: PathContext) => {
      try { const groupId = await pathId(context, 'groupId'), body = await requestBody(request, ApproveRequestSchema); return json(output(approveResponse, await runtime.approve(groupId, body))); } catch (error) { return remoteApiError(error); }
    },
    postSubmit: async (request: Request, context: PathContext) => {
      try { const runId = await pathId(context, 'runId'), body = await requestBody(request, SubmitRequestSchema); sameRun(runId, body.runId); return json(output(submitResponse, await runtime.submit(body))); } catch (error) { return remoteApiError(error); }
    },
    postAbandon: async (request: Request, context: PathContext) => {
      try { const runId = await pathId(context, 'runId'), body = await requestBody(request, AbandonRequestSchema); sameRun(runId, body.runId); return json(output(recoverResponse, await runtime.abandon(body))); } catch (error) { return remoteApiError(error); }
    },
    postReconcile: async (request: Request, context: PathContext) => {
      try { const runId = await pathId(context, 'runId'), body = await requestBody(request, ReconcileRequestSchema); sameRun(runId, body.runId); return json(output(recoverResponse, await runtime.reconcile(body))); } catch (error) { return remoteApiError(error); }
    },
    postObserve: async (request: Request, context: PathContext) => {
      try {
        const runId = await pathId(context, 'runId'), body = await requestBody(request, schemas.observe);
        sameRun(runId, body.runId);
        const recorded = output(RemoteExportSchema, runtime.run(runId));
        if (recorded.attempt.id !== body.launchAttemptId) throw new RemoteStateError('validation', 'The observed run and attempt identities must match.');
        return json(output(RemoteExportSchema, await runtime.observe(runId)));
      } catch (error) { return remoteApiError(error); }
    },
    postRestoration: read(async request => output(startResponse, await runtime.restore(await requestBody(request, RestoreRequestSchema)))),
  };
}
