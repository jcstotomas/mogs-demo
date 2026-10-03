import { renderCanonicalPricing } from '@/lib/assets/catalog';
export const dynamic = 'force-dynamic';
export default async function Pricing() {
  return <><header style={{ padding: '1rem 2rem' }}><a href="/console">MOGS correction console</a> · Fact-backed pricing</header><div dangerouslySetInnerHTML={{ __html: await renderCanonicalPricing() }} /></>;
}
