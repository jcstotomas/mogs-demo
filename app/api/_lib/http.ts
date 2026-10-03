import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

const serviceCodes = new Set(['validation', 'not_found', 'stale', 'busy', 'idempotency_conflict', 'provider_failure', 'runtime_failure', 'interrupted']);

export function requiredId(value: string | null | undefined, name: string): string {
  if (!value?.trim()) throw new ZodError([{ code: 'custom', path: [name], message: name + ' is required.' }]);
  return value;
}

export function apiError(error: unknown): NextResponse {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return NextResponse.json({ error: { code: 'validation', message: error instanceof ZodError ? error.issues.map(issue => issue.message).join('; ') : 'Invalid JSON body.', retryable: false } }, { status: 400 });
  }
  if (error instanceof Error && 'code' in error && 'status' in error) {
    const candidate = error as Error & { code: unknown; status: unknown; retryable?: unknown; recordId?: unknown; currentRevision?: unknown };
    if (typeof candidate.code === 'string' && serviceCodes.has(candidate.code) && typeof candidate.status === 'number' && candidate.status >= 400 && candidate.status <= 599) {
      return NextResponse.json({ error: {
        code: candidate.code, message: candidate.message,
        ...(typeof candidate.recordId === 'string' ? { recordId: candidate.recordId } : {}),
        ...(typeof candidate.currentRevision === 'number' ? { currentRevision: candidate.currentRevision } : {}),
        retryable: typeof candidate.retryable === 'boolean' ? candidate.retryable : candidate.status >= 500 || candidate.code === 'busy' || candidate.code === 'interrupted',
      } }, { status: candidate.status });
    }
  }
  return NextResponse.json({ error: { code: 'runtime_failure', message: 'The request could not be completed.', retryable: true } }, { status: 500 });
}
