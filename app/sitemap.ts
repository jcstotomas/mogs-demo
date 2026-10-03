import type { MetadataRoute } from 'next';
import { listAssetEntries } from '@/lib/assets/catalog';
export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = (process.env.MOGS_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const entries = await listAssetEntries();
  return [{ url: baseUrl + '/site/pricing' }, ...entries.map(entry => ({ url: baseUrl + entry.pathname }))];
}
