import { notFound } from 'next/navigation';
import PublicAsset from '../../../components/public-asset';
import { readGenerated } from '../../../lib/generated';

export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const { artifact } = await readGenerated();
  return artifact.routes.filter(route => route.kind === 'web' && route.pathname !== '/site/launch').map(route => ({ slug: route.pathname.slice('/site/'.length) }));
}

export default async function SitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) notFound();
  return <PublicAsset pathname={'/site/' + slug} />;
}
