import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MOGS · fictional company',
  description: 'A controlled public content demo for the fictional MOGS team scheduling company.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
