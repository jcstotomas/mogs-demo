import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { RemoteExportSchema, type RemoteExport } from '@/lib/runs/remote-types';

const PointerSchema = z.object({
  evidenceFile: z.string().regex(/^local-analysis-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/),
}).strict();
const RecordingSchema = z.object({
  format: z.literal('mogs-required-analysis-v1'), evidenceKind: z.literal('local-real-provider-analysis'),
  localOrigin: z.literal('http://localhost:3108'), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  publicationCredit: z.literal(false), humanApprovals: z.literal(0), pr: z.null(), evidence: RemoteExportSchema,
}).passthrough().superRefine((record, ctx) => {
  const state = record.evidence, assets = state.attempt.baseline.assets;
  if (state.run.mode !== 'eval' || state.run.scope.assetIds.length !== 22 || assets.length !== 22
    || assets.filter(asset => asset.surface === 'web').length !== 20 || assets.filter(asset => asset.surface === 'email').length !== 2
    || state.approvals.length || state.submission || state.observations.length || state.groups.some(group => group.approvalId !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Recording must contain the isolated required scope and no approval or publication evidence.' });
  }
});

export async function loadRequiredRecording(): Promise<{ evidence: RemoteExport | null; notice: string; localOrigin: string | null }> {
  const directory = path.join(process.cwd(), 'data/evidence/remote2');
  try {
    const pointer = PointerSchema.parse(JSON.parse(await readFile(path.join(directory, 'local-analysis-latest.json'), 'utf8')));
    const record = RecordingSchema.parse(JSON.parse(await readFile(path.join(directory, pointer.evidenceFile), 'utf8')));
    return {
      evidence: record.evidence, localOrigin: record.localOrigin,
      notice: 'Real provider calls analyzed the frozen 20-web/two-email corpus in an isolated local run. This read-only recording has zero human approvals, no pull request, and no deployed preview or public verification credit. Refresh this page to load the latest saved analysis.',
    };
  } catch (error) {
    return {
      evidence: null, localOrigin: null,
      notice: (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'The 22-asset analysis recording is not ready yet. Refresh this page after the local analysis finishes. Approval and publication controls are disabled.'
        : 'The saved 22-asset recording could not be validated. Approval and publication controls are disabled. A valid isolated analysis record is required before results can be shown.',
    };
  }
}
