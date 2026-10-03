'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { RemoteBaselineViewSchema, RemoteCandidateViewSchema, type RemoteBaselineView } from '@/lib/runs/remote-api';
import {
  ApprovalSchema, LaunchAttemptSchema, RecoverySchema, RemoteErrorSchema, RemoteExportSchema, RemoteRunSchema, SubmissionSchema,
  type RemoteExport, type RemoteGroup,
} from '@/lib/runs/remote-types';
import {
  abandonRequest, actionCounts, approvalMatches, approvalRequest, bundleReady, checkNames, confirmRequest,
  groupNames, groupReady, labelNames, latestObservation, publicVerified, reconcileRequest, runNames, submissionRequest,
} from './remote-console-model';
import type { FixtureState } from './remote-console-fixtures';
import styles from './launch-console.module.css';
import remote from './remote-console.module.css';

const ConfirmResponseSchema = z.object({ attempt: LaunchAttemptSchema, run: RemoteRunSchema }).strict();
const ApproveResponseSchema = z.object({ approval: ApprovalSchema }).strict();
const SubmitResponseSchema = z.object({ submission: SubmissionSchema }).strict();
const RecoveryResponseSchema = z.object({ recovery: RecoverySchema }).strict();
const fixtureLinks: { state: FixtureState; label: string }[] = [
  { state: 'initial', label: 'Before Confirm' }, { state: 'collecting', label: 'Collecting' }, { state: 'sealed', label: 'Complete groups' },
  { state: 'withheld', label: 'Withheld and protected' }, { state: 'failedsubmission', label: 'Submission failed' },
  { state: 'failedpreview', label: 'Preview failed' }, { state: 'mergedfailure', label: 'Public verification failed' }, { state: 'verified', label: 'Verified' },
];
class RequestFailure extends Error {
  constructor(message: string, readonly code: string, readonly retryable: boolean) { super(message); }
}
async function request<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } }); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new RequestFailure('Connection lost. Refresh recorded results before retrying the same action.', 'network', true);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = RemoteErrorSchema.safeParse(body);
    throw new RequestFailure(parsed.success ? parsed.data.error.message : 'The request did not finish. Refresh recorded results.',
      parsed.success ? parsed.data.error.code : 'invalid_response', parsed.success ? parsed.data.error.retryable : false);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new RequestFailure('Recorded response could not be validated. Actions are paused until results refresh.', 'invalid_response', false);
  return parsed.data;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'The operation could not finish.';
const currency = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const duration = (ms: number | null) => ms === null ? 'Pending' : `${(ms / 1000).toFixed(1)}s`;
function storedIdentity(name: string, cache: Map<string, string>) {
  const cached = cache.get(name);
  if (cached) return cached;
  let identity: string;
  try { identity = sessionStorage.getItem(name) ?? crypto.randomUUID(); sessionStorage.setItem(name, identity); }
  catch { identity = crypto.randomUUID(); }
  cache.set(name, identity); return identity;
}
function rememberRun(runId: string) {
  const url = new URL(window.location.href); url.searchParams.set('runId', runId);
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}
function safeExternal(url: string | null) {
  if (!url) return null;
  try { return new URL(url).protocol === 'https:' ? url : null; } catch { return null; }
}

export function RemoteConsole({ fixture, fixtureNotice, initialEvidence, initialBaseline, initialRunId, recordingNotice = null, recordingOrigin = null }: {
  fixture: FixtureState | null; fixtureNotice: string | null; initialEvidence: RemoteExport | null;
  initialBaseline: RemoteBaselineView | null; initialRunId: string | null;
  recordingNotice?: string | null; recordingOrigin?: string | null;
}) {
  const [baseline, setBaseline] = useState(initialBaseline);
  const [evidence, setEvidence] = useState(initialEvidence);
  const [runId, setRunId] = useState(initialEvidence?.run.id ?? initialRunId);
  const [loading, setLoading] = useState(!fixture && !recordingNotice);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [refresh, setRefresh] = useState(0);
  const mutation = useRef(false);
  const identities = useRef(new Map<string, string>());
  const serial = useRef(0);
  const errorSource = useRef<'connection' | 'action'>('connection');
  const reload = useCallback(async (currentRun: string, signal?: AbortSignal) => {
    if (recordingNotice) {
      if (!initialEvidence) throw new Error('The saved analysis is unavailable. Refresh this page after it finishes.');
      return initialEvidence;
    }
    const ticket = ++serial.current;
    const next = await request(`/api/v2/runs/${encodeURIComponent(currentRun)}/export`, RemoteExportSchema, { signal });
    if (ticket === serial.current && !signal?.aborted) { setEvidence(next); if (errorSource.current === 'connection') setError(null); }
    return next;
  }, [recordingNotice, initialEvidence]);

  useEffect(() => {
    if (fixture || recordingNotice) return;
    const controller = new AbortController();
    setLoading(true);
    void request('/api/v2/baseline', RemoteBaselineViewSchema, { signal: controller.signal }).then(next => {
      if (controller.signal.aborted) return;
      setBaseline(next);
      if (!runId && next.activeRunId) { setRunId(next.activeRunId); rememberRun(next.activeRunId); }
      if (errorSource.current === 'connection') setError(null);
    }).catch(failure => { if (!controller.signal.aborted) setError(message(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [fixture, recordingNotice, refresh]); // A baseline refresh is explicit; polling never constructs a candidate.

  useEffect(() => {
    if (fixture || recordingNotice || !runId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try { await reload(runId, controller.signal); }
      catch (failure) { if (!controller.signal.aborted) setError(message(failure)); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2500);
    };
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); ++serial.current; };
  }, [fixture, recordingNotice, runId, reload, refresh]);

  const mutate = async (name: string, action: () => Promise<void>) => {
    if (fixture || recordingNotice || mutation.current) return;
    mutation.current = true; setBusy(name); setError(null); setStatus('');
    try { await action(); }
    catch (failure) { errorSource.current = 'action'; setError(message(failure)); }
    finally { mutation.current = false; setBusy(null); }
  };
  const key = (action: string) => storedIdentity('mogs-v2:' + action, identities.current);
  const confirm = () => mutate('Confirm', async () => {
    if (!baseline) return;
    const identityScope = `${baseline.baselineHash}:${evidence?.attempt.closedAt ? evidence.attempt.id : 'initial'}`;
    const attemptId = key('attempt:' + identityScope);
    const result = await request('/api/v2/facts', ConfirmResponseSchema, { method: 'POST', body: JSON.stringify(confirmRequest(attemptId, baseline.baselineHash, key('confirm:' + identityScope))) });
    setRunId(result.run.id); rememberRun(result.run.id); await reload(result.run.id);
    setStatus('Desired facts confirmed. The public site has not been changed.');
  });
  const approve = (group: RemoteGroup) => mutate(group.id, async () => {
    if (!evidence || !groupReady(evidence, group) || evidence.run.mode !== 'live') return;
    await request(`/api/v2/groups/${encodeURIComponent(group.id)}/approve`, ApproveResponseSchema, {
      method: 'POST', body: JSON.stringify(approvalRequest(evidence, group, key(`approve:${group.id}:${group.revision}:${group.membershipHash}`))),
    });
    await reload(evidence.run.id); setStatus('Group approved for inclusion in the pull request. The public site has not been changed.');
  });
  const submit = () => mutate('Submit', async () => {
    if (!evidence || !bundleReady(evidence) || !baseline?.enforcement.available || evidence.run.mode !== 'live') return;
    const prepared = await request(`/api/v2/runs/${encodeURIComponent(evidence.run.id)}/candidate`, RemoteCandidateViewSchema);
    const payload = submissionRequest(evidence, prepared.candidate, key(`submit:${evidence.attempt.id}:${prepared.candidate.bundleHash}`));
    await request(`/api/v2/runs/${encodeURIComponent(evidence.run.id)}/submit`, SubmitResponseSchema, { method: 'POST', body: JSON.stringify(payload) });
    await reload(evidence.run.id); setStatus('Submission recorded. Preview verification and human GitHub merge are separate steps.');
  });
  const abandon = () => mutate('Abandon', async () => {
    if (!evidence || !reason.trim()) return;
    await request(`/api/v2/runs/${encodeURIComponent(evidence.run.id)}/abandon`, RecoveryResponseSchema, {
      method: 'POST', body: JSON.stringify(abandonRequest(evidence, reason.trim(), key(`abandon:${evidence.attempt.id}:${evidence.attempt.revision}:${reason.trim()}`))),
    });
    await reload(evidence.run.id); setStatus('Abandonment operation recorded. The target remains reserved until remote state is known.');
  });
  const reconcile = () => mutate('Reconcile', async () => {
    if (!evidence || !reason.trim()) return;
    const observation = latestObservation(evidence, 'production');
    if (!observation) return;
    await request(`/api/v2/runs/${encodeURIComponent(evidence.run.id)}/reconcile`, RecoveryResponseSchema, {
      method: 'POST', body: JSON.stringify(reconcileRequest(evidence, observation, reason.trim(), key(`reconcile:${evidence.attempt.id}:${observation.deploymentId}:${reason.trim()}`))),
    });
    await reload(evidence.run.id); setStatus('Reconciliation recorded from the observed deployed state. The public site was not restored.');
  });
  const observe = () => mutate('Observe', async () => {
    if (!evidence?.submission) return;
    const next = await request(`/api/v2/runs/${encodeURIComponent(evidence.run.id)}/observe`, RemoteExportSchema, {
      method: 'POST', body: JSON.stringify({ contractVersion: 2, launchAttemptId: evidence.attempt.id, runId: evidence.run.id }),
    });
    ++serial.current; setEvidence(next); setStatus('Deployment observation recorded. Preview, merge and public verification remain distinct results.');
  });
  const refreshResults = () => {
    if (recordingNotice) { window.location.reload(); return; }
    errorSource.current = 'connection'; setRefresh(value => value + 1);
  };

  const observedProduction = evidence ? latestObservation(evidence, 'production') : null;
  const preview = evidence ? latestObservation(evidence, 'preview') : null;
  const desired = evidence?.facts.find(f => f.phase === 'desired')?.snapshot ?? baseline?.desiredFacts;
  const before = evidence?.facts.find(f => f.phase === 'before')?.snapshot ?? baseline?.beforeFacts;
  const deployed = recordingNotice ? before : observedProduction ? observedProduction.publishedFacts : baseline?.beforeFacts;
  const active = !!evidence && ['active', 'abandoning', 'merged_failure'].includes(evidence.attempt.state);
  const liveEvidence = !fixture && !recordingNotice && (!evidence || evidence.run.mode === 'live');
  const disabled = loading || !!busy || !!error || !liveEvidence;
  const terminal = !!evidence?.attempt.closedAt;
  const canConfirm = !!baseline && !active && !baseline.activeRunId && baseline.beforeFacts.version === 1;
  const ready = !!evidence && bundleReady(evidence);
  const counts = evidence ? actionCounts(evidence) : null;
  const protectedJudgments = evidence?.judgments.filter(j => ['consistent', 'valid_exception', 'unrelated'].includes(j.label)) ?? [];
  const ambiguous = evidence?.judgments.filter(j => j.label === 'insufficient_context') ?? [];
  const withheld = evidence?.patches.filter(p => p.status === 'withheld' || p.status === 'stale' || p.status === 'dropped') ?? [];
  const prefix = fixture ? 'Fixture: ' : '';
  const prUrl = !fixture ? safeExternal(evidence?.submission?.prUrl ?? null) : null;
  const productionUrl = recordingNotice ? recordingOrigin : !fixture ? safeExternal(evidence?.attempt.baseline.target.productionOrigin ?? baseline?.baseline.target.productionOrigin ?? null) : null;
  const canAbandon = !!evidence && ['active', 'abandoning'].includes(evidence.attempt.state) && !observedProduction?.mergedSha;
  const assets = evidence?.attempt.baseline.assets ?? baseline?.baseline.assets ?? [];

  return <div className={`${styles.shell} ${remote.shellWrap}`}>
    <a className={styles.skip} href="#remote-main">Skip to launch review</a>
    <header className={styles.topbar}><a className={styles.brand} href="/console/remote">MOGS <span>Fictional launch review</span></a>
      <nav aria-label="Launch navigation"><a href="#review">Review groups</a><a href="#delivery">Delivery evidence</a><a href="/console">Local v1 history</a></nav>
    </header>
    <main className={styles.main} id="remote-main" tabIndex={-1}>
      <div className={styles.intro}><p className={styles.eyebrow}>{recordingNotice ? 'Local real-provider analysis' : 'Deployed launch correction'}</p><h1>{recordingNotice ? 'Review the 22-asset analysis' : 'Review a price change'}</h1>
        <p>{recordingNotice ? 'Inspect recorded model judgments and checked proposals for the fictional MOGS site and paired email templates.' : 'Check the fictional MOGS site and paired email templates, approve complete corrections, then review one pull request.'}</p></div>
      {fixtureNotice ? <aside className={remote.notice} aria-label="Fixture mode"><strong>UI fixture · {fixture}</strong><p>{fixtureNotice}</p>
        <nav className={remote.fixtureNav} aria-label="Fixture states">{fixtureLinks.map(item => <a key={item.state} href={`?fixture=${item.state}`} aria-current={item.state === fixture ? 'page' : undefined}>{item.label}</a>)}</nav></aside> : null}
      {recordingNotice ? <aside className={remote.notice} aria-label="Recorded local analysis"><strong>Local real-provider analysis · read only</strong><p>{recordingNotice}</p><button className={styles.secondary} onClick={refreshResults}>Refresh saved analysis</button></aside> : null}
      {!fixture && !recordingNotice && evidence?.run.mode !== undefined && evidence.run.mode !== 'live' ? <aside className={remote.notice}>Recorded {evidence.run.mode} run. Live approval and submission controls are disabled; these results carry no human publication credit.</aside> : null}
      {error ? <div className={styles.error} role="alert"><strong>Action paused</strong><p>{error}</p><button className={styles.secondary} disabled={!!busy} onClick={refreshResults}>Refresh recorded results</button></div> : null}
      <section className={styles.change} aria-labelledby="change-title"><div><p className={styles.eyebrow}>Desired product change</p><h2 id="change-title">Starter monthly pricing</h2>
        <div className={styles.price}><span>{currency(before?.change.fromCents ?? 3000)}</span><span className={`${styles.arrow} ${remote.priceArrow}`} aria-label="changes to">→</span><strong>{currency(desired?.change.toCents ?? 4000)}</strong><small>per month</small></div>
        <p className={styles.muted}>Active Starter monthly subscribers who began before the recorded cutoff keep $30. Annual pricing and historical statements stay unchanged.</p>
        <dl className={remote.facts}><div><dt>{recordingNotice ? 'Local source price' : 'Observed deployed price'}</dt><dd>{deployed ? currency(deployed.plans.starter.monthlyCents) : 'Unavailable'}</dd></div><div><dt>Desired price</dt><dd>{currency(desired?.plans.starter.monthlyCents ?? 4000)}</dd></div></dl>
      </div><div className={styles.changeAction}><span className={styles.badge}>{recordingNotice ? evidence ? 'Saved local analysis' : 'Recording unavailable' : evidence ? prefix + (terminal ? 'Attempt closed' : 'Desired facts recorded') : loading ? 'Loading deployed baseline' : 'Awaiting Confirm'}</span>
        <p>{recordingNotice ? 'The recorded desired change was analyzed locally. Human approval, PR submission and deployed verification remain separate steps.' : 'Confirm records desired facts and starts analysis. Approval authorizes PR inclusion. Publication follows a separate human GitHub merge.'}</p>
        <button className={styles.primary} disabled={disabled || !canConfirm} aria-busy={busy === 'Confirm'} onClick={confirm}>{busy === 'Confirm' ? 'Confirming…' : 'Confirm price change'}</button>
        {!canConfirm && !loading ? <p>{recordingNotice ? 'This saved analysis is read only. It cannot confirm, approve, submit or publish.' : fixture ? 'Fixture actions are disabled.' : active || baseline?.activeRunId ? 'The existing attempt reserves this target. Continue its review or recovery.' : 'A fresh, verified $30 baseline is required for another price-change attempt.'}</p> : null}
        {!fixture && baseline?.activeRunId && baseline.activeRunId !== runId ? <a href={`/console/remote?runId=${encodeURIComponent(baseline.activeRunId)}`}>Resume the active attempt</a> : null}
        {productionUrl ? <a href={`${productionUrl}/site/pricing`} target="_blank" rel="noreferrer">{recordingNotice ? 'Open local pricing' : 'Open public pricing'}</a> : null}
      </div></section>
      <div className={styles.scope}><div><strong>{evidence?.run.scope.assetIds.length ?? baseline?.baseline.assets.length ?? '—'} assets in the captured scope</strong><p>{baseline?.baseline.assets.filter(a => a.editable && a.surface === 'web').length ?? evidence?.attempt.baseline.assets.filter(a => a.editable && a.surface === 'web').length ?? '—'} editable web pages · {baseline?.baseline.assets.filter(a => a.surface === 'email').length ?? evidence?.attempt.baseline.assets.filter(a => a.surface === 'email').length ?? '—'} email previews · canonical pricing</p><p>Email publication changes templates. It does not send emails.</p></div><span className={styles.badge}>{prefix}{recordingNotice || evidence?.run.scope.assetIds.length === 22 ? 'Required 22-asset scope' : 'Miniature scope'}</span></div>
      <nav className={remote.fixtureNav} aria-label={recordingNotice ? 'Captured local assets' : 'Captured public assets'}>{assets.map(asset => <span key={asset.assetId}>{productionUrl ? <a href={productionUrl + asset.pathname} target="_blank" rel="noreferrer">{evidence?.pages.find(page => page.assetId === asset.assetId)?.meta.title ?? asset.pathname}</a> : <span>{asset.pathname} · {fixture ? 'fixture link disabled' : 'source link unavailable'}</span>}</span>)}</nav>
      <p className={remote.status} role="status" aria-live="polite">{status || (loading ? 'Loading recorded baseline…' : '')}</p>
      {evidence ? <>
        <section className={styles.progressSection} aria-labelledby="progress-title"><div className={styles.sectionHeading}><div><p className={`${styles.eyebrow} ${remote.supportingText}`}>Full-scope analysis</p><h2 id="progress-title">{prefix}{runNames[evidence.run.status]}</h2></div><span className={evidence.run.status === 'failed' ? styles.warningBadge : styles.badge}>{evidence.run.status}</span></div>
          <progress className={styles.progress} aria-label="Assets indexed" max={evidence.run.scope.assetIds.length} value={evidence.run.stats.assetsIndexed} />
          <dl className={styles.stats}>{[
            ['Assets indexed', `${evidence.run.stats.assetsIndexed} / ${evidence.run.scope.assetIds.length}`], ['Blocks read', evidence.run.stats.passagesIndexed],
            ['Claims checked', `${evidence.run.stats.judged} / ${evidence.run.stats.candidates}`], ['Lexically excluded', evidence.run.filteredPassageIds.length],
            ['Checked corrections', evidence.run.stats.patchesDrafted], ['Withheld corrections', evidence.run.stats.withheld],
            ['First complete group', duration(evidence.run.stats.firstSealedGroupMs)], ['All results ready', duration(evidence.run.stats.allResultsReadyMs)],
          ].map(([label, value]) => <div className={styles.stat} key={label}><dt className={remote.supportingText}>{label}</dt><dd>{value}</dd></div>)}</dl>
          <p className={`${styles.small} ${remote.supportingText}`}>{evidence.run.scope.assetIds.length === 22 ? 'Required analysis gates: first complete group ≤90s; all results ≤180s from Confirm.' : 'Miniature timings do not satisfy the required 22-asset workload gate.'}</p>
          {recordingNotice ? <p className={`${styles.small} ${remote.supportingText}`}>These timings measure the recorded local model run. The deployed 22-asset timing gate and publication flow remain unverified.</p> : null}
          {evidence.run.errors.length ? <div className={styles.error} role="alert"><strong>{evidence.run.errors.length} unresolved analysis errors</strong><ul className={styles.errorList}>{evidence.run.errors.map((item, index) => <li key={`${item.code}:${index}`}>{item.message}</li>)}</ul><p>Incomplete results block approval and submission.</p></div> : null}
        </section>
        <section className={styles.section} id="review" aria-labelledby="review-title"><div className={styles.sectionHeading}><h2 id="review-title">Complete correction groups</h2><span className={styles.count}>{evidence.groups.length}</span></div><p className={styles.sectionDescription}>Review current and proposed text, the complete member set, exclusions and checks. Each approval applies to the displayed revision only.</p>
          {!evidence.groups.length ? <p className={styles.empty}>Groups appear after full-scope classification and complete drafting and checking.</p> : evidence.groups.map(group => <GroupReview key={group.id} group={group} evidence={evidence} fixture={!!fixture} recorded={!!recordingNotice} busy={busy} disabled={disabled} onApprove={() => approve(group)} />)}
        </section>
        <section className={styles.section} aria-labelledby="findings-title"><h2 id="findings-title">Withheld and preserved claims</h2><div className={styles.findingsGrid}>
          <div className={styles.findingPanel}><h3>Needs attention <span>{withheld.length + ambiguous.length}</span></h3><p className={styles.muted}>These claims receive no automatic correction.</p>
            {withheld.map(patch => <div className={styles.finding} key={patch.id}><strong>{patch.surface === 'email' ? 'Email' : 'Web'} · {patch.status}</strong><p>{patch.original}</p><p>{patch.withholdReason ?? patch.rationale ?? 'Current checks do not authorize an edit.'}</p></div>)}
            {ambiguous.map(judgment => <div className={styles.finding} key={judgment.passageId}><strong>Needs context</strong><p>{evidence.passages.find(p => p.id === judgment.passageId)?.text}</p><p>Plan, billing or eligibility context is unresolved.</p></div>)}
            {!withheld.length && !ambiguous.length ? <p className={styles.small}>No recorded attention cases yet.</p> : null}
          </div><div className={styles.findingPanel}><h3>Preserved claims <span>{protectedJudgments.length}</span></h3><p className={styles.muted}>Valid legacy, historical, already-correct and unrelated claims stay unchanged.</p>
            <p className={remote.protectedCounts}>Web: {protectedJudgments.filter(j => evidence.passages.find(p => p.id === j.passageId)?.surface === 'web').length} · Email: {protectedJudgments.filter(j => evidence.passages.find(p => p.id === j.passageId)?.surface === 'email').length}</p>
            <div className={remote.preserved}>{protectedJudgments.map(judgment => { const passage = evidence.passages.find(p => p.id === judgment.passageId); return <details key={judgment.passageId}><summary>{passage?.surface === 'email' ? 'Email' : 'Web'} · {labelNames[judgment.label]}</summary><p>{passage?.text ?? 'Source passage unavailable.'}</p></details>; })}</div>
          </div></div>
        </section>
        <section className={styles.section} id="delivery" aria-labelledby="delivery-title"><h2 id="delivery-title">Pull request and public result</h2><p className={styles.sectionDescription}>All eligible groups must have current approvals and the complete combined candidate must pass checks. One pull request contains the checked content and canonical fact update.</p>
          <div className={remote.actions}><button className={styles.primary} disabled={disabled || !ready || !baseline?.enforcement.available} aria-busy={busy === 'Submit'} onClick={submit}>{busy === 'Submit' ? 'Checking and submitting…' : 'Submit one pull request'}</button>
            <button className={styles.secondary} disabled={disabled || !evidence.submission || !['active', 'merged_failure'].includes(evidence.attempt.state)} aria-busy={busy === 'Observe'} onClick={observe}>{busy === 'Observe' ? 'Checking deployment…' : 'Check deployment'}</button>
            {!fixture ? <button className={styles.secondary} disabled={!!busy} onClick={refreshResults}>Refresh recorded evidence</button> : null}</div>
          <p className={remote.groupReason}>{recordingNotice ? 'This local recording has no human approvals or pull request. Publication actions are disabled.' : fixture ? 'Fixture submission is disabled.' : evidence.submission ? 'The submitted candidate is immutable. Changed source or head requires abandonment and a new attempt.' : !ready ? 'Wait for all results and current approval of every eligible group.' : !baseline?.enforcement.available ? baseline?.enforcement.message ?? 'Required merge enforcement is unavailable.' : 'Submitting creates a PR. The public site remains unchanged until a human merges.'}</p>
          {!fixture && baseline && !baseline.enforcement.available ? <p className={styles.error}>{baseline.enforcement.message}</p> : null}
          <div className={remote.stages}>
            <EvidenceStage title="1. Pull request" status={prefix + (evidence.submission?.status ?? 'Not submitted')} failed={evidence.submission?.status === 'failed' || evidence.submission?.status === 'blocked'}>
              <p>{evidence.submission?.failure ?? (evidence.submission ? 'Submission is recorded independently of deployed verification.' : 'No proposed source changes have been submitted.')}</p>
              {evidence.submission ? <p>Operation recorded: {evidence.submission.createdAt}</p> : null}
              {prUrl ? <a href={prUrl} target="_blank" rel="noreferrer">Open pull request #{evidence.submission?.prNumber}</a> : fixture && evidence.submission?.prUrl ? <p>Synthetic PR identity · link disabled</p> : null}
            </EvidenceStage>
            <EvidenceStage title="2. Preview verification" status={prefix + (recordingNotice ? 'Not performed' : preview?.verification ?? 'Awaiting deployed preview')} failed={preview?.verification === 'failed' || preview?.readiness === 'failed'}>
              <p>{preview ? `Build ${preview.readiness}. Preview verification ${preview.verification}.` : 'A submitted PR alone does not establish a deployed preview.'}</p>
              {preview ? <p>Observed: {preview.observedAt}</p> : null}
              {preview?.failures.length ? <ul>{preview.failures.map(failure => <li key={failure}>{failure}</li>)}</ul> : null}
              {!fixture && preview && safeExternal(preview.url) ? <a href={preview.url} target="_blank" rel="noreferrer">Open matching preview</a> : null}
            </EvidenceStage>
            <EvidenceStage title="3. Human GitHub merge" status={prefix + (recordingNotice ? 'Not performed' : observedProduction?.mergedSha ? 'Merge observed' : 'Awaiting human merge')}>
              <p>{observedProduction?.mergedSha ? 'The recorded production observation identifies the merged commit.' : 'A person reviews and merges in GitHub after the required checks pass. This console never merges.'}</p><p>GitHub review duration: unavailable</p>
            </EvidenceStage>
            <EvidenceStage title="4. Public verification" status={prefix + (recordingNotice ? 'Not performed' : publicVerified(evidence) ? 'Verified publicly' : observedProduction?.verification ?? 'Awaiting matching production deployment')} failed={observedProduction?.verification === 'failed' || observedProduction?.readiness === 'failed'}>
              <p>{observedProduction ? `Production build ${observedProduction.readiness}. Rendered verification ${observedProduction.verification}.` : 'Production deployment and rendered checks are separate from preview checks.'}</p>
              {observedProduction ? <p>Observed: {observedProduction.observedAt}</p> : null}
              {observedProduction?.failures.length ? <ul>{observedProduction.failures.map(failure => <li key={failure}>{failure}</li>)}</ul> : null}
              {!fixture && observedProduction && safeExternal(observedProduction.url) ? <a href={observedProduction.url} target="_blank" rel="noreferrer">Open observed public deployment</a> : null}
            </EvidenceStage>
          </div>
          {!recordingNotice && (canAbandon || evidence.attempt.state === 'merged_failure' || evidence.recoveries.length) ? <section className={remote.recovery} aria-labelledby="recovery-title"><h3 id="recovery-title">{evidence.attempt.state === 'merged_failure' ? 'Reconcile failed public state' : 'Attempt recovery'}</h3>
            <p>{evidence.attempt.state === 'merged_failure' ? 'A merged failure reserves this target. Reconciliation records the actual deployed state and closes the failure; it does not restore the site.' : 'Abandonment records terminal failing checks and closes an unmerged PR before releasing the target. Prior PR and failure evidence stay recorded.'}</p>
            {evidence.recoveries.map(item => <p key={item.id}><strong>{item.action}: {item.status}</strong>{item.failure ? ` · ${item.failure}` : ''}</p>)}
            {canAbandon || evidence.attempt.state === 'merged_failure' ? <><label htmlFor="recovery-reason">Reason for this recovery action</label><textarea id="recovery-reason" className={remote.reason} value={reason} onChange={event => setReason(event.target.value)} disabled={!!fixture || !!busy} placeholder="Describe the observed failure or reason for retiring this attempt." />
              <button className={styles.secondary} disabled={disabled || !reason.trim() || (evidence.attempt.state === 'merged_failure' && !observedProduction)} onClick={evidence.attempt.state === 'merged_failure' ? reconcile : abandon}>{busy === 'Reconcile' || busy === 'Abandon' ? 'Recording recovery…' : evidence.attempt.state === 'merged_failure' ? 'Reconcile deployed state' : 'Abandon this attempt'}</button>
              {!reason.trim() ? <p>{fixture ? 'Fixture recovery actions are disabled.' : 'Add a reason before recording recovery.'}</p> : null}
              {evidence.attempt.state === 'merged_failure' && !observedProduction ? <p>Await a recorded production observation before reconciliation.</p> : null}
            </> : null}
          </section> : null}
        </section>
        <section className={styles.evidence} aria-labelledby="evidence-title"><h2 id="evidence-title">Recorded evidence</h2><p className={remote.supportingText}>{counts?.approvals ?? 0} human group approvals · {counts?.submissions ?? 0} submission actions · {counts?.abandonments ?? 0} abandonment actions · {counts?.reconciliations ?? 0} reconciliation actions. Fixture/test actions and polling add no human credit.</p>
          <details><summary>Run and source identities</summary><dl className={remote.evidenceList}>{[
            ['Run', evidence.run.id], ['Attempt', evidence.attempt.id], ['Attempt state', evidence.attempt.state], ['Base commit', evidence.attempt.baseline.baseSha],
            ['Before facts', evidence.attempt.beforeFactsHash], ['Desired facts', evidence.attempt.desiredFactsHash], ['Candidate commit', evidence.submission?.candidate.candidateSha ?? 'Unavailable'],
            ['Preview deployment', preview?.deploymentId ?? 'Unavailable'], ['Merged commit', observedProduction?.mergedSha ?? 'Unavailable'], ['Public deployment', observedProduction?.deploymentId ?? 'Unavailable'],
            ['Observed review time', duration(evidence.run.stats.humanMs)], ['Processing time', duration(evidence.run.stats.machineMs)], ['Provider', `${evidence.run.config.adapter} · ${evidence.run.config.judgeModel}`],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>
        </section>
      </> : <p className={styles.empty}>{recordingNotice ? 'No validated saved analysis is available. Refresh this page after the recording is created.' : 'Confirm the desired price change to start the captured-scope review. Live content stays unchanged during analysis.'}</p>}
    </main>
  </div>;
}

function EvidenceStage({ title, status, children, failed }: { title: string; status: string; children: React.ReactNode; failed?: boolean }) {
  return <section className={remote.stage}><h3>{title}</h3><p role={failed ? 'alert' : undefined} className={failed ? styles.badText : undefined}><strong>{status}</strong></p>{children}</section>;
}
function GroupReview({ group, evidence, fixture, recorded, busy, disabled, onApprove }: {
  group: RemoteGroup; evidence: RemoteExport; fixture: boolean; recorded: boolean; busy: string | null; disabled: boolean; onApprove: () => void;
}) {
  const ready = groupReady(evidence, group);
  const approved = approvalMatches(evidence, group);
  const patches = group.memberIds.map(id => evidence.patches.find(patch => patch.id === id)).filter(patch => patch !== undefined);
  const surfaceCount = (ids: string[], surface: 'web' | 'email') => ids.filter(id => evidence.patches.find(patch => patch.id === id)?.surface === surface).length;
  return <article className={styles.group} aria-labelledby={`title-${group.id}`}><header className={styles.groupHeader}><div><span className={approved ? styles.goodBadge : styles.badge}>{fixture ? 'Fixture: ' : ''}{groupNames[group.status]}</span><h3 id={`title-${group.id}`}>{group.title}</h3>
    <p>Revision {group.revision} · {group.eligibleIds.length} eligible · {group.excludedIds.length} excluded</p><p className={remote.surfaces}>Web: {surfaceCount(group.eligibleIds, 'web')} eligible / {surfaceCount(group.excludedIds, 'web')} excluded · Email: {surfaceCount(group.eligibleIds, 'email')} eligible / {surfaceCount(group.excludedIds, 'email')} excluded</p>
  </div><div><button className={styles.primary} disabled={disabled || fixture || recorded || !ready || evidence.run.mode !== 'live'} aria-busy={busy === group.id} onClick={onApprove}>{busy === group.id ? 'Recording approval…' : approved ? 'Approved for PR inclusion' : 'Approve group for PR inclusion'}</button>
    <p className={remote.groupReason}>{recorded ? 'This saved analysis is read only. Human approval is disabled.' : fixture ? 'Fixture approval is disabled.' : approved ? 'Approval is bound to this checked revision and member set.' : ready ? 'This records one human group approval. It does not publish.' : 'Approval waits for full-scope classification and every applicable member check.'}</p></div></header>
    {patches.map(patch => <section className={styles.patch} key={patch.id}><div className={styles.patchHeading}><strong>{patch.surface === 'email' ? 'Email preview' : 'Web page'} · {evidence.pages.find(page => page.assetId === patch.assetId)?.meta.title ?? patch.assetId}</strong><span className={styles.small}>{group.eligibleIds.includes(patch.id) ? 'Eligible correction' : 'Excluded'}</span></div>
      <div className={styles.diff}><div><span>Current text</span><p>{patch.original}</p></div><div><span>Proposed text</span><p>{patch.replacement ?? 'No proposed edit'}</p></div></div>
      <p className={styles.rationale}>{patch.rationale ?? patch.withholdReason}</p><details className={styles.checks}><summary>{patch.checks.filter(check => check.pass).length} / {patch.checks.length} checks passed{fixture ? ' · synthetic' : ''}</summary><ul>{patch.checks.map(check => <li key={check.name}><strong className={check.pass ? styles.goodText : styles.badText}>{check.pass ? 'Pass' : 'Fail'}</strong><div><strong>{checkNames[check.name]}</strong><p>{check.detail}</p></div></li>)}</ul></details>
    </section>)}
  </article>;
}
