import type { Metadata } from 'next';
import { LaunchConsole } from '@/components/launch-console';

export const metadata: Metadata = {
  title: 'Launch review · MOGS',
  description: 'Review and publish checked corrections for the fictional MOGS launch.',
};

export default function ConsolePage() {
  return <LaunchConsole />;
}
