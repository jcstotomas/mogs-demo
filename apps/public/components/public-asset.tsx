import { notFound } from 'next/navigation';
import { readRoute } from '../lib/generated';
import { CalendarArt } from './brand';
import SiteHeader from './site-header';

export default async function PublicAsset({ pathname }: { pathname: string }) {
  const result = await readRoute(pathname);
  if (!result) notFound();
  const { route, deployment } = result;
  const isEmail = route.kind === 'email';
  return <div className={`public-page public-page--${route.kind}`}>
    <a className="skip-link" href="#content">Skip to content</a>
    <SiteHeader pathname={pathname} />
    <div className="content-shell" id="content" tabIndex={-1}>
      <div className="asset-hero">
        <div className="asset-intro">
          <p className="eyebrow">Fictional company · {isEmail ? 'Repository-backed email preview' : 'Published site content'}</p>
          <h1>{isEmail ? route.title + ' preview' : route.title === 'MOGS canonical pricing' ? <><span className="visually-hidden">MOGS canonical </span>pricing</> : route.title.startsWith('MOGS ') ? <><span className="visually-hidden">MOGS </span>{route.title.slice(5)}</> : route.title}</h1>
          <p className="lede">{isEmail ? 'This page previews a template. No email is sent.' : 'MOGS is a fictional team scheduling company.'}</p>
        </div>
        {!isEmail && <CalendarArt />}
      </div>
      <div className="source-body" dangerouslySetInnerHTML={{ __html: route.html }} />
      <script type="application/json" id="deployment-meta" dangerouslySetInnerHTML={{ __html: JSON.stringify(deployment).replace(/</g, '\\u003c') }} />
    </div>
    <footer>Fictional MOGS demo · Source revision {deployment.sourceCommit.slice(0, 7)}</footer>
  </div>;
}
