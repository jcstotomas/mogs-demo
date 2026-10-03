'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  ApiErrorSchema, ApproveResponseSchema, ConfirmResponseSchema, ExportResponseSchema,
  type ApproveRequest, type ConfirmRequest,
} from '@/lib/contracts/api';
import { FactSnapshotSchema, type FactSnapshot, type Group, type Patch, type Publication, type Run } from '@/lib/types';
import styles from './launch-console.module.css';

type Evidence = z.infer<typeof ExportResponseSchema>;
const FactsResponse = z.object({ facts: FactSnapshotSchema, runId: z.string().min(1).nullable() }).strict();
const checkNames: Record<Patch['checks'][number]['name'], string> = {
  span_confined: 'Focused edit', numbers_allowed: 'Correct values', qualifiers_kept: 'Scope preserved',
  rejudge_consistent: 'Model recheck', source_located: 'Source found', source_fresh: 'Source unchanged',
  fact_fresh: 'Current facts', tokens_kept: 'Email tags and links',
};
const requiredChecks = ['span_confined', 'numbers_allowed', 'qualifiers_kept', 'rejudge_consistent', 'source_located', 'source_fresh', 'fact_fresh'] as const;
const labelNames = {
  contradicting: 'Needs correction', consistent: 'Already correct', valid_exception: 'Valid exception',
  unrelated: 'Unrelated', insufficient_context: 'Needs context',
};
const runNames: Record<Run['status'], string> = {
  collecting: 'Reading the assets', classifying: 'Checking claims', drafting: 'Preparing corrections',
  ready: 'All results ready', failed: 'Run needs attention',
};
const groupNames: Record<Group['status'], string> = {
  collecting: 'Preparing', sealed: 'Ready for review', blocked: 'Blocked', publishing: 'Publishing',
  published: 'Published · checking', verified: 'Verified locally', failed_publish: 'Publish failed', failed_verify: 'Verification failed',
};
const publicationNames: Record<Publication['status'], string> = {
  prepared: 'Preparing publication', writing: 'Writing changes', published: 'Published · checking',
  verified: 'Verified locally', failed_publish: 'Publish failed', failed_verify: 'Verification failed',
  recovering: 'Recovering publication', recovered: 'Recovered · not published', blocked: 'Publication blocked',
};

class RequestFailure extends Error {
  constructor(message: string, readonly code: string, readonly retryable: boolean) { super(message); }
}
async function request<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new RequestFailure('Connection lost. Refresh the results before continuing.', 'network', true);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw new RequestFailure(
      parsed.success ? parsed.data.error.message : 'The request could not finish. Try refreshing the results.',
      parsed.success ? parsed.data.error.code : 'runtime_failure',
      parsed.success ? parsed.data.error.retryable : true,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new RequestFailure('The response could not be read safely. Approval is paused until results refresh.', 'invalid_response', false);
  return parsed.data;
}
const describeError = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Refresh and try again.';
const currency = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
const duration = (ms: number | null) => ms === null ? 'Pending' : ms < 1000 ? '<1s' : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
const localUrl = (url: string) => { const parsed = new URL(url); return parsed.pathname + parsed.search + parsed.hash; };
function requestKey(storageId: string, fallback: Map<string, string>) {
  const found = fallback.get(storageId);
  if (found) return found;
  let key: string;
  try { key = sessionStorage.getItem(storageId) ?? crypto.randomUUID(); sessionStorage.setItem(storageId, key); }
  catch { key = crypto.randomUUID(); }
  fallback.set(storageId, key);
  return key;
}
function checksComplete(patch: Patch) {
  const names = patch.surface === 'email' ? [...requiredChecks, 'tokens_kept'] : requiredChecks;
  return patch.status === 'drafted' && patch.replacement !== null && names.every(name => patch.checks.some(check => check.name === name && check.pass)) && patch.checks.every(check => check.pass);
}

export function LaunchConsole() {
  const [facts, setFacts] = useState<FactSnapshot | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const keyCache = useRef(new Map<string, string>());
  const requestSerial = useRef(0);
  const mutationBusy = useRef(false);
  const openedGroups = useRef(new Set<string>());

  const loadFacts = useCallback(async (signal?: AbortSignal) => {
    const result = await request('/api/facts', FactsResponse, { signal });
    setFacts(result.facts);
    setRunId(result.runId);
    return result;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void loadFacts(controller.signal).then(() => setConnectionError(null)).catch(error => {
      if (!controller.signal.aborted) setConnectionError(describeError(error));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [loadFacts, refreshToken]);

  useEffect(() => {
    if (!runId) { setEvidence(null); return; }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      const serial = ++requestSerial.current;
      try {
        const next = await request(`/api/runs/${encodeURIComponent(runId)}/export`, ExportResponseSchema, { signal: controller.signal });
        if (!stopped && serial === requestSerial.current) {
          if (next.run.id !== runId) throw new Error('The returned results belong to another run.');
          setEvidence(next);
          setConnectionError(null);
        }
      } catch (error) {
        if (!stopped && serial === requestSerial.current) setConnectionError(describeError(error));
      } finally {
        if (!stopped) timer = setTimeout(poll, 1500);
      }
    };
    void poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [runId, refreshToken]);

  async function markViewed(group: Group) {
    if (openedGroups.current.has(group.id)) return;
    openedGroups.current.add(group.id);
    try {
      await request(`/api/groups/${encodeURIComponent(group.id)}/open`, z.object({ openedAt: z.iso.datetime() }).strict(), {
        method: 'POST', body: JSON.stringify({ runId: group.runId }),
      });
    } catch { openedGroups.current.delete(group.id); }
  }

  async function refresh() {
    setRefreshing(true);
    setRefreshToken(value => value + 1);
    try { await loadFacts(); } catch (error) { setConnectionError(describeError(error)); }
    finally { setRefreshing(false); }
  }

  async function confirmChange() {
    if (!facts || runId || mutationBusy.current) return;
    mutationBusy.current = true;
    setConfirming(true);
    setActionError(null);
    const payload: ConfirmRequest = {
      changeId: facts.change.id, expectedFactVersion: facts.version,
      idempotencyKey: requestKey(`mogs:v1:confirm:${facts.scenarioId}:${facts.version}`, keyCache.current),
    };
    try {
      const result = await request('/api/facts', ConfirmResponseSchema, { method: 'POST', body: JSON.stringify(payload) });
      setRunId(result.runId);
      await loadFacts();
    } catch (error) {
      setActionError(describeError(error));
      // A lost response may still have started the run. Restore it before offering another action.
      try { await loadFacts(); } catch { setConnectionError('Could not refresh the change status. Check the connection before continuing.'); }
    } finally { mutationBusy.current = false; setConfirming(false); }
  }

  async function approve(group: Group) {
    if (!evidence || mutationBusy.current || connectionError) return;
    mutationBusy.current = true;
    setApprovingId(group.id);
    setActionError(null);
    const payload: ApproveRequest = {
      runId: evidence.run.id, expectedRevision: group.revision,
      idempotencyKey: requestKey(`mogs:v1:approve:${evidence.run.id}:${group.id}:${group.revision}`, keyCache.current),
    };
    try {
      await request(`/api/groups/${encodeURIComponent(group.id)}/approve`, ApproveResponseSchema, { method: 'POST', body: JSON.stringify(payload) });
    } catch (error) {
      setActionError(error instanceof RequestFailure && error.code === 'stale'
        ? 'This group changed while you were reviewing it. The latest version is loading; review it before approving.'
        : describeError(error));
    } finally {
      // Refresh membership and revisions together, including other groups changed by this publication.
      const serial = ++requestSerial.current;
      try {
        const next = await request(`/api/runs/${encodeURIComponent(evidence.run.id)}/export`, ExportResponseSchema);
        if (serial === requestSerial.current) {
          setEvidence(next);
          setConnectionError(null);
          if (next.publications.some(publication => publication.groupId === group.id && publication.idempotencyKey === payload.idempotencyKey && ['prepared', 'writing', 'published', 'verified'].includes(publication.status))) setActionError(null);
        }
      } catch (error) { setConnectionError(describeError(error)); }
      mutationBusy.current = false;
      setApprovingId(null);
    }
  }

  const run = evidence?.run;
  const groups = evidence?.groups ?? [];
  const patchesById = new Map(evidence?.patches.map(patch => [patch.id, patch]) ?? []);
  const pagesById = new Map(evidence?.pages.map(page => [page.assetId, page]) ?? []);
  const passagesById = new Map(evidence?.passages.map(passage => [passage.id, passage]) ?? []);
  const activePublication = evidence?.publications.some(publication => ['prepared', 'writing', 'published', 'recovering'].includes(publication.status)) ?? false;
  const protectedFindings = evidence?.judgments.filter(judgment => ['consistent', 'valid_exception', 'unrelated'].includes(judgment.label)) ?? [];
  const ambiguous = evidence?.judgments.filter(judgment => judgment.label === 'insufficient_context') ?? [];
  const heldPatches = evidence?.patches.filter(patch => ['withheld', 'stale', 'failed_verify'].includes(patch.status) || patch.checks.some(check => !check.pass)) ?? [];
  const scopeWeb = run?.scope.assetIds.filter(id => id.startsWith('web:')).length ?? 1;
  const scopeEmail = run?.scope.assetIds.filter(id => id.startsWith('email:')).length ?? 2;
  const runActive = !!run && !['ready', 'failed'].includes(run.status);

  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skip}>Skip to review</a>
      <header className={styles.topbar}>
        <a href="/console" className={styles.brand}>MOGS<span>Launch review</span></a>
        <nav aria-label="Console navigation"><a href="#review">Corrections</a><a href="#findings">Other findings</a><a href="/site/pricing" target="_blank" rel="noreferrer">View pricing ↗</a></nav>
      </header>
      <main id="main-content" className={styles.main}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>Fictional company · Local demonstration</p>
          <h1>One price change.<br />Every claim in context.</h1>
          <p>Review the corrections that follow from a new price, while keeping valid exceptions intact.</p>
        </div>

        {connectionError ? <div role="alert" className={styles.error}><strong>Results could not refresh.</strong><p>{connectionError}</p><button className={styles.secondary} onClick={() => void refresh()} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh results'}</button></div> : null}
        {actionError ? <div role="alert" className={styles.error}>{actionError}</div> : null}

        <section className={styles.change} aria-labelledby="change-title">
          <div>
            <p className={styles.eyebrow}>The change</p>
            <h2 id="change-title">Starter monthly</h2>
            <div className={styles.price}>
              <span>{facts ? currency(facts.change.fromCents) : '$30'}</span><span aria-hidden="true" className={styles.arrow}>→</span><strong>{facts ? currency(facts.change.toCents) : '$40'}</strong><small>/ month</small>
            </div>
            <p className={styles.muted}>For customers without legacy eligibility. Active Starter monthly subscribers from before the cutoff keep their existing rate. Annual billing stays the same.</p>
          </div>
          <div className={styles.changeAction}>
            <span className={styles.badge}>{runId || facts?.phase === 'confirmed' ? 'Change confirmed' : 'Ready to confirm'}</span>
            <p>{runId ? 'Canonical pricing reflects the new price. Review each complete group before publishing its corrections.' : 'Confirm updates canonical pricing and starts the review. Marketing corrections await your approval.'}</p>
            <button className={styles.primary} onClick={() => void confirmChange()} disabled={loading || confirming || !!runId || !!connectionError || !facts || facts.phase !== 'initial'}>
              {confirming ? 'Confirming change…' : runId ? 'Review started' : loading ? 'Loading change…' : 'Confirm price change'}
            </button>
          </div>
        </section>

        <section className={styles.scope} aria-label="Run scope">
          <div><strong>{scopeWeb} web {scopeWeb === 1 ? 'page' : 'pages'} + {scopeEmail} emails</strong><p>{run && run.scope.assetIds.length !== 3 ? 'Current run scope is shown from the recorded run.' : 'Miniature integration run. Canonical pricing is separate.'} The 22-asset timing gate is a later milestone.</p></div>
          <span className={styles.badge}>Gate 1</span>
        </section>

        {run ? <section className={styles.progressSection} aria-labelledby="progress-title">
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Run progress</p><h2 id="progress-title">{runNames[run.status]}</h2></div><span className={styles.badge} aria-live="polite">{run.stats.judged} / {run.stats.candidates} candidates checked</span></div>
          <progress className={styles.progress} aria-label="Candidate claims checked" value={run.stats.judged} max={Math.max(run.stats.candidates, 1)} />
          <dl className={styles.stats}>
            <Stat label="Assets read" value={`${run.stats.assetsIndexed} / ${run.scope.assetIds.length}`} />
            <Stat label="Claims needing correction" value={run.stats.byLabel.contradicting} />
            <Stat label="First complete group" value={duration(run.stats.firstSealedGroupMs)} />
            <Stat label="All results ready" value={duration(run.stats.allResultsReadyMs)} />
          </dl>
          <p className={styles.small}>{run.mode !== 'live' ? `${run.mode === 'fixture' ? 'Fixture' : 'Evaluation'} results. ` : ''}{runActive ? 'Results update automatically. A group can be approved only after the full scope is classified and every member has a result.' : 'These timings measure this recorded run only.'}</p>
          {run.errors.length ? <ul className={styles.errorList}>{run.errors.map((error, index) => <li key={`${error.code}:${index}`}>{error.message}</li>)}</ul> : null}
        </section> : runId ? <p role="status" className={styles.empty}>Loading the run and its correction groups…</p> : null}

        <section id="review" className={styles.section} aria-labelledby="review-title">
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Review and publish</p><h2 id="review-title">Correction groups</h2></div>{run ? <span className={styles.count}>{groups.length}</span> : null}</div>
          <p className={styles.sectionDescription}>One approval publishes the checked members of one complete group across its web and email assets.</p>
          {!groups.length ? <div className={styles.empty}>{run ? run.status === 'failed' ? 'The run did not produce a reviewable group. Review the errors above.' : run.status === 'ready' ? 'No correction groups were produced. Review the other findings below.' : 'Reading the full scope and preparing complete correction groups…' : 'Confirm the price change to begin.'}</div> : groups.map(group => {
            const members = group.memberIds.map(id => patchesById.get(id)).filter((patch): patch is Patch => !!patch);
            const eligible = group.eligibleIds.map(id => patchesById.get(id)).filter((patch): patch is Patch => !!patch);
            const canApprove = group.status === 'sealed' && group.sealedAt !== null && members.length === group.memberIds.length && eligible.length === group.eligibleIds.length && eligible.length > 0 && eligible.every(checksComplete) && run?.status !== 'failed';
            return <CorrectionGroup key={group.id} group={group} patches={members} pages={pagesById} publication={evidence?.publications.find(publication => publication.id === group.publicationId) ?? null} canApprove={canApprove && !activePublication && !connectionError && !approvingId} approving={approvingId === group.id} onApprove={() => void approve(group)} onViewed={() => void markViewed(group)} />;
          })}
        </section>

        {evidence ? <section id="findings" className={styles.section} aria-labelledby="findings-title">
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Keep the context</p><h2 id="findings-title">Other findings</h2></div></div>
          <div className={styles.findingsGrid}>
            <div className={styles.findingPanel}><h3>Needs attention <span>{ambiguous.length + heldPatches.length}</span></h3><p className={styles.small}>Ambiguous claims and failed checks stay outside publication.</p>
              {!ambiguous.length && !heldPatches.length ? <p className={styles.muted}>{runActive ? 'Findings will appear as checks finish.' : 'No unresolved findings in the recorded results.'}</p> : null}
              {ambiguous.map(judgment => { const passage = passagesById.get(judgment.passageId); return <div className={styles.finding} key={judgment.passageId}><span className={styles.warningBadge}>Needs context</span><p>{passage?.text ?? 'Passage text is unavailable.'}</p><p className={styles.small}>{judgment.escalatedBy === 'low_confidence' ? 'The model was not certain enough to propose an edit.' : judgment.escalatedBy === 'scope_conflict' ? 'The audience or eligibility evidence conflicts.' : 'The available context does not support a safe correction.'}</p>{passage ? <a href={localUrl(passage.url)} target="_blank" rel="noreferrer">Open {passage.surface} ↗</a> : null}</div>; })}
              {heldPatches.map(patch => <div className={styles.finding} key={patch.id}><span className={styles.warningBadge}>{patch.status === 'failed_verify' ? 'Verification failed' : patch.status === 'stale' ? 'Source changed' : 'Withheld'}</span><p>{patch.original}</p><p className={styles.small}>{patch.withholdReason ?? patch.checks.filter(check => !check.pass).map(check => check.detail).join(' ')}</p><a href={localUrl(patch.url)} target="_blank" rel="noreferrer">Open {patch.surface} ↗</a></div>)}
            </div>
            <div className={styles.findingPanel}><h3>Keep as written <span>{protectedFindings.length}</span></h3><p className={styles.small}>Model findings that do not call for a correction.</p>
              {!protectedFindings.length ? <p className={styles.muted}>{runActive ? 'Preserved claims will appear as checks finish.' : 'No protected findings were recorded.'}</p> : null}
              {protectedFindings.map(judgment => { const passage = passagesById.get(judgment.passageId); const page = passage ? pagesById.get(passage.assetId) : undefined; return <details className={styles.protectedItem} key={judgment.passageId}><summary><span className={styles.goodBadge}>{labelNames[judgment.label]}</span><span>{passage?.text ?? judgment.passageId}</span></summary><p className={styles.small}>{page?.meta.title}{page?.meta.legacyStarterEligible === true ? ' · Explicitly eligible for legacy Starter pricing' : ''}</p>{passage ? <a href={localUrl(passage.url)} target="_blank" rel="noreferrer">Open {passage.surface} ↗</a> : null}</details>; })}
            </div>
          </div>
        </section> : null}

        {run && evidence ? <footer className={styles.evidence}>
          <dl className={styles.stats}><Stat label="Published corrections" value={run.stats.published} /><Stat label="Verified corrections" value={run.stats.verified} /><Stat label="Review actions" value={run.stats.reviewActions} /><Stat label="Review elapsed time" value={evidence.reviewEvents.some(event => event.actor === 'human' && event.action === 'open') ? duration(run.stats.humanMs) : 'Not recorded'} /></dl>
          <details><summary>Run details</summary><dl><dt>Run</dt><dd>{run.id}</dd><dt>Judge</dt><dd>{run.config.adapter ?? 'Not selected'} · {run.config.judgeModel}</dd><dt>Confirmed</dt><dd>{new Date(run.confirmedAt).toLocaleString()}</dd><dt>Mode</dt><dd>{run.mode === 'live' ? 'Live provider calls on fictional local content' : `${run.mode} results — not a live run`}</dd></dl></details>
          <p>Published locally and checked in the rendered asset. The model recheck is recorded separately from whether the replacement was observed.</p>
        </footer> : <footer className={styles.evidence}><p>MOGS is fictional. This console publishes only locally served demonstration content.</p></footer>}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className={styles.stat}><dt>{label}</dt><dd>{value}</dd></div>;
}

function CorrectionGroup({ group, patches, pages, publication, canApprove, approving, onApprove, onViewed }: {
  group: Group; patches: Patch[]; pages: Map<string, Evidence['pages'][number]>; publication: Publication | null;
  canApprove: boolean; approving: boolean; onApprove: () => void; onViewed: () => void;
}) {
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    if (group.status !== 'sealed' || !card.current) return;
    const observer = new IntersectionObserver(entries => {
      if (document.visibilityState === 'visible' && entries.some(entry => entry.isIntersecting)) onViewed();
    }, { threshold: 0.1 });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [group.status, onViewed]);
  const success = group.status === 'verified';
  const failure = ['blocked', 'failed_publish', 'failed_verify'].includes(group.status);
  return <article ref={card} className={styles.group} aria-labelledby={`title-${group.id}`}>
    <div className={styles.groupHeader}><div><span className={success ? styles.goodBadge : failure ? styles.warningBadge : styles.badge}>{groupNames[group.status]}</span><h3 id={`title-${group.id}`}>{group.title}</h3><p>{group.eligibleIds.length} eligible {group.eligibleIds.length === 1 ? 'correction' : 'corrections'} · {group.bySurface.web.eligible} web · {group.bySurface.email.eligible} email{group.excludedIds.length ? ` · ${group.excludedIds.length} excluded` : ''}</p></div>
      {group.status === 'sealed' ? <button className={styles.primary} disabled={!canApprove || approving} onClick={onApprove}>{approving ? 'Publishing…' : 'Approve and publish group'}</button> : null}
    </div>
    {group.status === 'collecting' ? <p className={styles.groupNote}>Membership is still being completed. Approval is unavailable.</p> : null}
    {group.status === 'sealed' && !canApprove && !approving ? <p className={styles.groupNote}>Approval is paused while current results or another publication finish. Every eligible member must have passing checks.</p> : null}
    {patches.map(patch => {
      const observed = publication?.verification.find(result => result.passageId === patch.passageId);
      const excluded = group.excludedIds.includes(patch.id);
      return <div className={styles.patch} key={patch.id}>
        <div className={styles.patchHeading}><a href={localUrl(patch.url)} target="_blank" rel="noreferrer">{pages.get(patch.assetId)?.meta.title ?? localUrl(patch.url)} ↗</a><span className={styles.small}>{patch.surface === 'email' ? 'Email' : 'Web'}{excluded ? ' · Excluded from approval' : ''}</span></div>
        <div className={styles.diff}><div><span>Current copy at review</span><p><del>{patch.original}</del></p></div><div><span>{excluded ? 'Withheld suggestion' : 'Proposed correction'}</span><p>{patch.replacement ? <ins>{patch.replacement}</ins> : 'No replacement proposed.'}</p></div></div>
        <p className={styles.rationale}>{patch.withholdReason ?? patch.rationale}</p>
        <details className={styles.checks}><summary>{patch.checks.filter(check => check.pass).length} of {patch.checks.length} recorded checks pass</summary><ul>{patch.checks.map(check => <li key={check.name}><span className={check.pass ? styles.goodText : styles.badText}>{check.pass ? 'Pass' : 'Fail'}</span><div><strong>{checkNames[check.name]}</strong><p>{check.detail}</p></div></li>)}</ul></details>
        {observed ? <div className={observed.pass ? styles.verification : styles.error}><strong>{observed.pass ? 'Verified locally' : 'Verification failed'}</strong><p>Replacement observed: {observed.sourceObserved ? 'yes' : 'no'} · Model recheck: {observed.judgment ? labelNames[observed.judgment.label] : 'not completed'}</p><p>{observed.detail}</p><a href={localUrl(observed.url)} target="_blank" rel="noreferrer">Open rendered {patch.surface} ↗</a></div> : null}
      </div>;
    })}
    {patches.length !== group.memberIds.length ? <p className={styles.groupNote}>Some member details are still loading. Approval is paused.</p> : null}
    {publication ? <div className={styles.publication} role="status"><strong>{publicationNames[publication.status]}</strong>{publication.failure ? <p className={styles.badText}>{publication.failure}</p> : null}{publication.status === 'published' ? <p>The files were written. Rendered verification is still pending.</p> : null}</div> : null}
  </article>;
}
