'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import styles from './campaign-console.module.css';

const ContextSchema = z.object({
  core: z.object({
    runId: z.string().nullable(), status: z.string(), assets: z.number(), passages: z.number(),
    repairs: z.number(), groups: z.number(), approvedGroups: z.number(), prUrl: z.string().nullable(),
    reviewUrl: z.string(), beforeMonthlyCents: z.number(), monthlyCents: z.number(),
    annualCents: z.number(), legacyMonthlyCents: z.number(),
  }).nullable(),
  imports: z.object({ assets: z.number(), emails: z.number(), decks: z.number(), creatives: z.number() }),
  factsCompatible: z.boolean(), error: z.string().optional(),
});
type CampaignContext = z.infer<typeof ContextSchema>;
const dollars = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
function reviewLink(url: string | undefined) {
  return url?.startsWith('/console/remote') && !url.startsWith('//') ? url : '/console/remote';
}
function externalLink(url: string | null | undefined) {
  if (!url) return null;
  try { return new URL(url).protocol === 'https:' ? url : null; } catch { return null; }
}

export function CampaignConsole() {
  const [context, setContext] = useState<CampaignContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [frameError, setFrameError] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const resize = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/multichannel-context', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('The current website run could not be loaded. Open its review to refresh the recorded evidence.');
        const result = ContextSchema.safeParse(await response.json());
        if (!result.success) throw new Error('The current website run returned incomplete evidence. Open its review to refresh the recorded result.');
        return result.data;
      }).then(result => { if (!controller.signal.aborted) setContext(result); })
      .catch(error => { if (!controller.signal.aborted) setContextError(error instanceof Error ? error.message : 'The current website run is unavailable.'); });
    return () => { controller.abort(); resize.current?.disconnect(); };
  }, []);

  const fitFrame = () => {
    resize.current?.disconnect();
    const element = frame.current;
    const document = element?.contentDocument;
    if (!element || !document?.body || !document.getElementById('agent-form')) { setFrameError(true); return; }
    setFrameError(false);
    const fit = () => { element.style.height = `${Math.ceil(document.body.getBoundingClientRect().height) + 8}px`; };
    fit();
    resize.current = new ResizeObserver(fit);
    resize.current.observe(document.body);
  };

  const core = context?.core;
  const reviewUrl = reviewLink(core?.reviewUrl);
  const prUrl = externalLink(core?.prUrl);
  const error = contextError ?? context?.error;

  return <div className={styles.shell}>
    <a className={styles.skip} href="#campaign-main">Skip to campaign review</a>
    <header className={styles.header}>
      <a className={styles.brand} href="/console/campaign">MOGS <span>Fictional launch review</span></a>
      <nav aria-label="Review navigation"><a href="/console/campaign" aria-current="page">Campaign assets</a><a href={reviewUrl}>Website launch</a></nav>
    </header>
    <main className={styles.main} id="campaign-main" tabIndex={-1}>
      <div className={styles.intro}><p className={styles.eyebrow}>Website · Email · Sales deck · Creative</p><h1>Review the launch across your campaign.</h1>
        <p>Inspect the original sources, check the Starter price change, and continue the website launch review.</p></div>
      <section className={styles.launch} aria-labelledby="launch-title">
        <div><h2 id="launch-title">Website and paired email launch</h2>
          {core ? <><p className={styles.summary}>{core.assets} captured assets · {core.passages} source blocks · {core.repairs} checked corrections</p><p className={styles.detail}>{core.approvedGroups} of {core.groups} groups approved · Recorded run: {core.status}</p></> : <p className={styles.detail}>{error ? 'Recorded run unavailable.' : 'Loading the current launch review…'}</p>}
          {core ? <p className={styles.detail}>Starter {dollars(core.beforeMonthlyCents)} → {dollars(core.monthlyCents)} monthly · {dollars(core.annualCents)} annually · Eligible subscribers keep {dollars(core.legacyMonthlyCents)} monthly.</p> : null}
          <p className={styles.detail}>Human group approval, pull request submission, preview verification, merge, and public verification each have their own recorded result.</p>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </div>
        <div className={styles.actions}><a className={styles.primary} href={reviewUrl}>Continue website review</a>{prUrl ? <a className={styles.secondary} href={prUrl} target="_blank" rel="noreferrer">Open recorded pull request</a> : null}</div>
      </section>
      <section className={styles.campaign} aria-labelledby="campaign-title">
        <div className={styles.sectionHeading}><div><h2 id="campaign-title">Designed campaign sources</h2>
          <p className={styles.detail}>{context ? `${context.imports.emails} emails · ${context.imports.decks} sales deck · ${context.imports.creatives} creatives · ${context.imports.assets} assets available to import` : 'Load the designed campaign below or import your own supported source.'}</p>
          <p className={styles.detail}>Campaign findings are source-linked suggestions. Their counts and reports are separate from the website launch. Originals stay unchanged; email templates are not sent.</p>
          {context && !context.factsCompatible ? <p className={styles.error}>The campaign facts differ from the current website run. Compare each fact snapshot in its review.</p> : null}
        </div></div>
        {frameError ? <p className={styles.error} role="alert">Campaign review could not load. <a href="/console/campaign">Refresh campaign review</a>.</p> : null}
        <iframe className={styles.frame} ref={frame} src="/api/multichannel/ui" title="Campaign agent, original sources, and findings" onLoad={fitFrame} onError={() => setFrameError(true)} />
      </section>
    </main>
  </div>;
}
