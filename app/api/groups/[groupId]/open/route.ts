import { postOpen } from '../../../_lib/handlers';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ groupId: string }> }) { return postOpen(request, context); }
