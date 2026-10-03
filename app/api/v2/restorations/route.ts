import { postRestoration } from '@/app/api/v2/_lib/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return postRestoration(request); }
