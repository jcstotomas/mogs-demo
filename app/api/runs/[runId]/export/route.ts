import { getExport } from '../../../_lib/handlers';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) { return getExport(request, context); }
