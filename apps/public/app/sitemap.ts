import type { MetadataRoute } from 'next';
import { readGenerated } from '../lib/generated';

export const dynamic = 'force-static';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { artifact } = await readGenerated();
  const requestedOrigin = process.env.MOGS_PUBLIC_ORIGIN ?? (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3100');
  if ((process.env.VERCEL || process.env.VERCEL_ENV) && !process.env.MOGS_PUBLIC_ORIGIN && !process.env.VERCEL_URL) throw new Error('Public deployment origin is required for sitemap generation.');
  const origin = new URL(requestedOrigin).origin;
  return artifact.routes.map(route => ({ url: origin + route.pathname }));
}
