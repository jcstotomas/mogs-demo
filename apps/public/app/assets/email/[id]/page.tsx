import { notFound } from 'next/navigation';
import PublicAsset from '../../../../components/public-asset';
import { readGenerated } from '../../../../lib/generated';

export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ id: string }[]> {
  const { artifact } = await readGenerated();
  return artifact.routes.filter(route => route.kind === 'email').map(route => ({ id: route.pathname.slice('/assets/email/'.length) }));
}

export default async function EmailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z][a-z0-9-]*$/.test(id)) notFound();
  return <PublicAsset pathname={'/assets/email/' + id} />;
}
