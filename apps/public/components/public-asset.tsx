import { notFound } from 'next/navigation';
import { readRoute } from '../lib/generated';

export default async function PublicAsset({ pathname }: { pathname: string }) {
  const result = await readRoute(pathname);
  if (!result) notFound();
  const { route, deployment } = result;
  const isEmail = route.kind === 'email';
  return <>
    <a className="skip-link" href="#content">Skip to content</a>
    <header className="site-header">
      <a className="brand" href="/site/pricing">MOGS</a>
      <nav aria-label="Public content">
        <a href="/site/pricing">Pricing</a>
        <a href="/site/launch">Launch guide</a>
        <a href="/assets/email/onboarding">Onboarding email</a>
        <a href="/assets/email/eligible">Legacy email</a>
      </nav>
    </header>
    <div className="content-shell" id="content">
      <p className="eyebrow">Fictional company · {isEmail ? 'Repository-backed email preview' : 'Published site content'}</p>
      <h1>{isEmail ? route.title + ' preview' : route.title}</h1>
      <p className="lede">{isEmail ? 'This page previews a template. No email is sent.' : 'MOGS is a fictional team scheduling company.'}</p>
      <div className="source-body" dangerouslySetInnerHTML={{ __html: route.html }} />
      <script type="application/json" id="deployment-meta" dangerouslySetInnerHTML={{ __html: JSON.stringify(deployment).replace(/</g, '\\u003c') }} />
    </div>
    <footer>Fictional MOGS demo · Source revision {deployment.sourceCommit.slice(0, 7)}</footer>
  </>;
}
