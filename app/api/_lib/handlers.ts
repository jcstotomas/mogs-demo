import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApproveRequestSchema, ApproveResponseSchema, ConfirmRequestSchema, ConfirmResponseSchema, ExportResponseSchema, GroupsResponseSchema, RunResponseSchema } from '@/lib/contracts/api';
import { approve, confirm, exportRun, facts, groups, openGroup, processRun, run } from '@/lib/runs/service';
import { apiError, requiredId } from './http';

type PathContext = { params: Promise<Record<string, string>> };
const OpenRequestSchema = z.object({ runId: z.string().min(1) }).strict();

async function pathId(context: PathContext, name: string): Promise<string> { return requiredId((await context.params)[name], name); }
function queryRunId(request: Request): string { return requiredId(new URL(request.url).searchParams.get('runId'), 'runId'); }

export async function getFacts() {
  try { return NextResponse.json(await facts()); }
  catch (error) { return apiError(error); }
}
export async function postFacts(request: Request) {
  try {
    const input = ConfirmRequestSchema.parse(await request.json());
    const response = ConfirmResponseSchema.parse(await confirm(input));
    after(() => processRun(response.runId));
    return NextResponse.json(response);
  } catch (error) { return apiError(error); }
}
export async function getRun(_request: Request, context: PathContext, paramName: string) {
  try { return NextResponse.json(RunResponseSchema.parse(await run(await pathId(context, paramName)))); }
  catch (error) { return apiError(error); }
}
export async function getGroups(request: Request, context?: PathContext) {
  try { return NextResponse.json(GroupsResponseSchema.parse(await groups(context ? await pathId(context, 'runId') : queryRunId(request)))); }
  catch (error) { return apiError(error); }
}
export async function getExport(request: Request, context?: PathContext) {
  try { return NextResponse.json(ExportResponseSchema.parse(await exportRun(context ? await pathId(context, 'runId') : queryRunId(request)))); }
  catch (error) { return apiError(error); }
}
export async function postApprove(request: Request, context: PathContext) {
  try {
    const groupId = await pathId(context, 'groupId');
    const input = ApproveRequestSchema.parse(await request.json());
    return NextResponse.json(ApproveResponseSchema.parse({ publication: await approve(groupId, input) }));
  } catch (error) { return apiError(error); }
}
export async function postOpen(request: Request, context: PathContext) {
  try {
    const groupId = await pathId(context, 'groupId');
    const input = OpenRequestSchema.parse(await request.json());
    return NextResponse.json(await openGroup(groupId, input.runId));
  } catch (error) { return apiError(error); }
}
