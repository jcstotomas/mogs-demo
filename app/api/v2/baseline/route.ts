import { getBaseline } from '@/app/api/v2/_lib/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return getBaseline(request); }
