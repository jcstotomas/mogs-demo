import { notFound } from 'next/navigation';
import { readSourceAsset, renderedBody } from '@/lib/assets/catalog';
export const dynamic = 'force-dynamic';
export default async function SiteAsset({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  if (!slug.length || slug.some(part => !/^[a-z0-9][a-z0-9-]*$/.test(part))) notFound();
  let asset;
  try { asset = await readSourceAsset('site/' + slug.join('/') + '.md', 'web'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') notFound(); throw error; }
  return <><header style={{ padding: '1rem 2rem' }}><a href="/console">MOGS correction console</a> · Fictional company</header><div dangerouslySetInnerHTML={{ __html: renderedBody(asset) }} /></>;
}
