import { z, ZodError } from 'zod';
import { RemoteStateError } from '@/lib/runs/remote-db';
import { RemoteErrorSchema } from '@/lib/runs/remote-types';

export type PathContext = { params: Promise<Record<string, string>> };
const statusByCode = { validation: 400, not_found: 404, stale: 409, busy: 409, idempotency_conflict: 409, provider_failure: 502, remote_failure: 502, enforcement_unavailable: 503, unknown_remote_state: 409, interrupted: 409 } as const;
type ErrorCode = keyof typeof statusByCode;
const retryable = new Set<ErrorCode>(['provider_failure', 'remote_failure', 'unknown_remote_state', 'interrupted']);
export function remoteApiError(error: unknown): Response {
  let code: ErrorCode = 'remote_failure', message = 'The request could not be completed.';
  if (error instanceof ZodError || error instanceof SyntaxError) { code = 'validation'; message = 'The request is invalid. Check the required fields and JSON body.'; }
  else if (error instanceof RemoteStateError) { code = error.code; message = error.message; }
  else if (error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code in statusByCode) {
    code = error.code as ErrorCode;
    // Transport/provider exceptions may carry URLs, tokens or raw response bodies.
    message = code === 'enforcement_unavailable' ? 'GitHub merge enforcement is unavailable. Submission and publication are blocked.' : code === 'unknown_remote_state' ? 'The remote state is unresolved. This attempt remains active until recovery completes.' : code === 'interrupted' ? 'The operation was interrupted. Its recorded state must be recovered.' : 'The operation could not be completed.';
  }
  return Response.json(RemoteErrorSchema.parse({ error: { code, message, retryable: retryable.has(code) } }), { status: statusByCode[code], headers: { 'Cache-Control': 'no-store' } });
}
export function assertLocalRequest(request: Request): void {
  const url = new URL(request.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new RemoteStateError('validation', 'The coordinator API is available only on localhost.');
  const origin = request.headers.get('Origin'), site = request.headers.get('Sec-Fetch-Site');
  if ((origin && origin !== url.origin) || site === 'cross-site') throw new RemoteStateError('validation', 'The coordinator requires a request from its local console.');
}
export async function requestBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  assertLocalRequest(request);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 32_768) throw new RemoteStateError('validation', 'Request body exceeds the local API limit.');
  return schema.parse(JSON.parse(text));
}
export async function pathId(context: PathContext, field: string): Promise<string> {
  return z.string().min(1).max(200).parse((await context.params)[field]);
}
export function sameRun(pathRunId: string, bodyRunId: string): void {
  if (pathRunId !== bodyRunId) throw new RemoteStateError('validation', 'The path and body run identities must match.');
}
export const json = (value: unknown): Response => Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
