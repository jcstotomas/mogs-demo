import { assertLocalRequest } from '@/app/api/v2/_lib/http';
import { campaignContext } from '@/lib/campaign-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  if (process.env.MOGS_MULTICHANNEL_ENABLED !== '1') return Response.json({ error: 'Campaign review is disabled.' }, { status: 404 });
  try {
    assertLocalRequest(request);
    return Response.json(campaignContext(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'The saved website launch could not be read. Open the website review to continue.' }, { status: 503 });
  }
}
