import { proxyMultichannel } from '@/lib/multichannel/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
const handle = async (request: Request, context: Context) => proxyMultichannel(request, (await context.params).path);
export const GET = handle;
export const POST = handle;
