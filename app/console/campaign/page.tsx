import { notFound } from 'next/navigation';
import { CampaignConsole } from '@/components/campaign-console';

export const dynamic = 'force-dynamic';

export default function CampaignPage() {
  if (process.env.MOGS_MULTICHANNEL_ENABLED !== '1') notFound();
  return <CampaignConsole />;
}
