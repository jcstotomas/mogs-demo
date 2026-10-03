import { getExport } from '../_lib/handlers';
export function GET(request: Request) { return getExport(request); }
export const runtime = 'nodejs';
