import { getGroups } from '../_lib/handlers';
export function GET(request: Request) { return getGroups(request); }
export const runtime = 'nodejs';
