import { notFound } from 'next/navigation';
import { readSourceAsset, renderedBody } from '@/lib/assets/catalog';
export const dynamic = 'force-dynamic';
export default async function EmailAsset({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) notFound();
  let asset;
  try { asset = await readSourceAsset('email/' + id + '.md', 'email'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') notFound(); throw error; }
  return <><header style={{ padding: '1rem 2rem' }}><a href="/console">MOGS correction console</a> · Fictional email preview</header><div dangerouslySetInnerHTML={{ __html: renderedBody(asset) }} /></>;
}
