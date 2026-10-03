import { BrandMark } from './brand';

const links = [
  ['/site/pricing', 'Pricing'],
  ['/site/launch', 'Launch guide'],
  ['/assets/email/onboarding', 'Onboarding email'],
  ['/assets/email/eligible', 'Legacy email'],
] as const;

export default function SiteHeader({ pathname }: { pathname?: string }) {
  return <header className="site-header">
    <a className="brand" href="/"><BrandMark />MOGS</a>
    <nav aria-label="Public content">
      {links.map(([href, label]) => <a key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</a>)}
    </nav>
  </header>;
}
