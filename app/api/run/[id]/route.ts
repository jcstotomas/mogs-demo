import { getRun } from '../../_lib/handlers';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return getRun(request, context, 'id'); }
