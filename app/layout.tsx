import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'MOGS', description: 'Launch correction demo for a fictional company.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
