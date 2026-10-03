'use strict';

const $ = (id) => document.getElementById(id);
const state = { assets: [], runs: [], facts: null, agent: null, tasks: [], taskId: null, shownTaskRun: null, selected: new Set(), assetId: null, runId: null, unitId: null, page: 1, busy: false, initialized: false, poll: null };
const surfaceNames = { email: 'Email', deck: 'Deck PDF', creative: 'Creative' };
const labelNames = { contradicting: 'Needs correction', consistent: 'Consistent', valid_exception: 'Protected exception', unrelated: 'Unrelated', insufficient_context: 'Unresolved context' };
const audienceNames = { new_customers: 'New customers', existing_customers: 'Existing customers', historical: 'Historical context', unspecified: 'Audience unknown' };
const apiUrl = (path) => (document.documentElement.dataset.apiPrefix || '') + path;

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}
function agentReply(text) {
  const paragraph = el('p', 'agent-message agent-reply');
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) paragraph.append(el('strong', '', part.slice(2, -2)));
    else if (part.startsWith('`') && part.endsWith('`')) paragraph.append(el('span', '', part.slice(1, -1)));
    else paragraph.append(document.createTextNode(part));
  }
  return paragraph;
}
function clear(id) { const element = $(id); element.replaceChildren(); return element; }
function selectedAsset() { return state.assets.find((asset) => asset.id === state.assetId); }
function selectedRun() { return state.runs.find((run) => run.id === state.runId); }
function selectedTask() { return state.tasks.find((task) => task.id === state.taskId); }
function selectRun(runId) {
  state.runId = runId; state.unitId = null; state.page = 1;
  const run = selectedRun();
  if (run && !run.assetIds.includes(state.assetId)) state.assetId = run.findings.find((finding) => finding.replacement !== null)?.assetId || run.assetIds[0] || null;
}
function readableDate(value) { return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }); }
function dollars(cents) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(cents / 100); }
function say(message) { $('status').textContent = message; }
function error(message) { $('error').textContent = message; $('error').hidden = !message; }
function badge(text, tone = '') { return el('span', `badge ${tone}`.trim(), text); }
function statusTone(status) { return ['failed', 'cancelled'].includes(status) ? 'danger' : ['partial', 'queued', 'running', 'extracting'].includes(status) ? 'attention' : ''; }
function labelTone(label) { return label === 'contradicting' || label === 'insufficient_context' ? 'attention' : label === 'consistent' || label === 'valid_exception' ? 'good' : ''; }
function addNotice(parent, message, isError = false) { parent.append(el('div', `notice${isError ? ' error' : ''}`, message)); }
function locationText(locator) {
  if (locator.kind === 'html') return locator.field ? `Email ${locator.field}` : 'Email source block';
  return locator.kind === 'pdf' ? `PDF page ${locator.page}` : 'Image text region';
}
function details(title, pairs) {
  const element = el('details', 'evidence');
  element.append(el('summary', '', title));
  const list = el('dl');
  for (const [name, value] of pairs) { list.append(el('dt', '', name), el('dd', '', value)); }
  element.append(list);
  return element;
}
async function request(path, payload) {
  const response = await fetch(apiUrl(path), payload === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  let result;
  try { result = await response.json(); } catch { throw new Error(response.status === 404 ? 'The lab is disabled or this resource is unavailable.' : `The server returned an unreadable response (${response.status}).`); }
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}
function setBusy(value) {
  state.busy = value;
  for (const control of $('import-form').elements) control.disabled = value;
  $('demo-button').disabled = value;
  $('import-button').textContent = value ? 'Working…' : 'Import and extract';
  updateSelection();
}
function updateSelection() {
  const active = state.assets.filter((asset) => asset.active);
  const count = active.filter((asset) => state.selected.has(asset.id)).length;
  const extracting = active.some((asset) => state.selected.has(asset.id) && asset.status === 'extracting');
  $('select-all').checked = active.length > 0 && count === active.length;
  $('select-all').indeterminate = count > 0 && count < active.length;
  $('select-all').disabled = !active.length;
  const running = state.tasks.some((task) => ['queued', 'running'].includes(task.status));
  $('agent-submit').disabled = state.busy || running || !state.agent?.available || extracting;
  $('agent-message').disabled = state.busy || running || !state.agent?.available;
  for (const button of $('prompt-examples').querySelectorAll('button')) button.disabled = state.busy || running || !state.agent?.available;
  $('selection-help').textContent = extracting ? 'Extraction is in progress. Wait until selected assets finish before checking.' : count ? `${count} selected ${count === 1 ? 'asset' : 'assets'} · Every extracted block will be checked; failed and incomplete inputs remain in the report.` : 'No explicit selection. Describe the asset scope in your request; import files below if the library is empty.';
}
function renderAssets() {
  const container = clear('asset-list');
  $('asset-count').textContent = state.assets.length;
  if (!state.assets.length) container.append(el('p', 'empty-message', 'Your imported files will appear here. Load the designed campaign to try all three formats.'));
  for (const asset of state.assets) {
    const row = el('div', 'asset-row');
    const label = el('label', 'asset-check');
    const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = state.selected.has(asset.id); checkbox.disabled = !asset.active;
    checkbox.setAttribute('aria-label', `Include ${asset.context.title || asset.filename} in the next check`);
    checkbox.addEventListener('change', () => { checkbox.checked ? state.selected.add(asset.id) : state.selected.delete(asset.id); updateSelection(); });
    label.append(checkbox);
    const button = el('button', 'asset-button'); button.type = 'button'; button.setAttribute('aria-current', String(asset.id === state.assetId));
    button.append(el('span', 'asset-name', asset.context.title || asset.filename));
    const meta = el('span', 'asset-meta');
    meta.append(el('span', '', surfaceNames[asset.surface] || 'Asset'), badge(asset.active ? asset.status : 'Superseded', statusTone(asset.status)));
    button.append(meta, el('span', 'asset-file', asset.filename));
    button.addEventListener('click', () => {
      state.assetId = asset.id; state.unitId = null; state.page = 1;
      render();
      [...$('asset-list').querySelectorAll('button')].find((item) => item.getAttribute('aria-current') === 'true')?.focus({ preventScroll: true });
    });
    row.append(label, button); container.append(row);
  }
  updateSelection();
}
function renderRunOptions() {
  const select = clear('run-select');
  if (!state.runs.length) { const option = el('option', '', 'No runs yet'); option.value = ''; select.append(option); }
  for (const run of state.runs) { const option = el('option', '', `${readableDate(run.createdAt)} · ${run.status}${run.stale ? ' · stale' : ''}`); option.value = run.id; select.append(option); }
  select.value = state.runId || '';
  select.disabled = !state.runs.length;
}
function renderRunSummary() {
  const container = clear('run-summary');
  const run = selectedRun();
  $('export-link').hidden = !run || ['queued', 'running'].includes(run.status);
  if (run) $('export-link').href = apiUrl(`/api/runs/${encodeURIComponent(run.id)}/export`);
  if (!run) return;
  const row = el('div', 'run-status');
  row.append(badge(run.status, statusTone(run.status)), el('span', '', `Starter desired price ${dollars(run.facts.monthlyCents)}/month`), el('span', '', 'Experimental suggestions'));
  container.append(row);
  if (run.stale) addNotice(container, 'Stale report. Source or context changed after this check. Previous suggestions are retained as evidence and must be checked again against current revisions.');
  if (['queued', 'running'].includes(run.status)) addNotice(container, 'Checking all selected content. Results are incomplete while this run is in progress.');
  if (run.status === 'partial') addNotice(container, 'Partial coverage. Some content is unresolved or could not be checked. This report is not a clean audit.');
  if (['failed', 'cancelled'].includes(run.status)) addNotice(container, `Analysis ${run.status}. Review the recorded errors before starting a new check.`, true);
  const counts = el('div', 'run-stats');
  for (const [key, title] of [['assets', 'Assets'], ['units', 'Extracted blocks'], ['checked', 'Checked blocks'], ['suggestions', 'Suggestions'], ['unresolved', 'Unresolved']]) {
    const item = el('div', 'run-stat'); item.append(el('strong', '', run.counts[key]), document.createTextNode(title)); counts.append(item);
  }
  container.append(counts);
  if (run.errors.length) {
    const issues = el('details', 'run-issues'); issues.append(el('summary', '', `${run.errors.length} recorded coverage issues or errors`));
    const list = el('ul', 'warning-list'); for (const message of run.errors) list.append(el('li', '', message)); issues.append(list); container.append(issues);
  }
  container.append(details('Run evidence', [
    ['Run ID', run.id], ['Engine', run.engine], ['Fact hash', run.factsHash], ['Contract', run.contractVersion], ['Created', run.createdAt], ['Completed', run.completedAt || 'Not completed'], ['Elapsed', `${run.durationMs} ms`], ['Evidence scope', 'Local imports and deterministic rule analysis. No production verification.'],
  ]));
}
function renderAssetSummary() {
  const container = clear('asset-summary');
  const asset = selectedAsset();
  if (!asset) return;
  const section = el('div', 'asset-summary');
  section.append(el('h3', '', asset.context.title || asset.filename));
  const eligibility = asset.context.legacyEligible === true ? 'Legacy eligible' : asset.context.legacyEligible === false ? 'Not legacy eligible' : 'Legacy eligibility unknown';
  section.append(el('p', 'context-line', `${surfaceNames[asset.surface]} · ${audienceNames[asset.context.audience]} · ${eligibility}`));
  section.append(el('p', 'context-line', `Context supplied at import${asset.context.journey ? ` · ${asset.context.journey}` : ''}. ${asset.extraction ? `${asset.extraction.units.length} extracted blocks across ${asset.extraction.pages} ${asset.surface === 'email' ? 'document' : 'page(s)'}.` : 'No completed extraction.'}`));
  if (!asset.active) addNotice(section, 'This revision has been superseded. Its source and reports remain available; select the active revision for a new check.');
  if (asset.status === 'extracting') addNotice(section, 'Extracting source content. This asset is not ready to check.');
  if (asset.error) addNotice(section, `Extraction failed: ${asset.error}`, true);
  if (asset.extraction?.status === 'partial') addNotice(section, 'Extraction is partial. Missing or uncertain regions are not treated as checked content.');
  if (asset.extraction?.warnings.length) {
    const list = el('ul', 'warning-list field-help');
    for (const warning of asset.extraction.warnings) list.append(el('li', '', warning));
    const notes = el('details', 'evidence');
    notes.append(el('summary', '', `${asset.extraction.warnings.length} coverage ${asset.extraction.warnings.length === 1 ? 'note' : 'notes'}`), list);
    section.append(notes);
  }
  section.append(details('Source evidence', [
    ['Original filename', asset.filename], ['Asset revision', asset.revision], ['Source SHA-256', asset.sourceHash], ['Context SHA-256', asset.contextHash], ['Extractor', asset.extraction?.extractor || 'Unavailable'], ['Imported', asset.createdAt], ['Region', asset.context.region || 'Unknown'], ['Date context', asset.context.date || 'Unknown'], ['Origin', 'Local import; built-in examples are synthetic'],
  ]));
  container.append(section);
}
function renderFindings() {
  const container = clear('findings');
  const asset = selectedAsset(); const run = selectedRun();
  const findings = run && asset ? run.findings.filter((finding) => finding.assetId === asset.id) : [];
  const priority = (finding) => {
    if (finding.replacement !== null && !finding.withholdReason && finding.checks.length && finding.checks.every((check) => check.pass)) {
      return finding.locator.kind === 'html' && finding.locator.field ? 1 : 0;
    }
    if (finding.withholdReason || ['contradicting', 'insufficient_context'].includes(finding.label)) return 2;
    return finding.label === 'valid_exception' ? 3 : finding.label === 'consistent' ? 4 : 5;
  };
  findings.sort((left, right) => priority(left) - priority(right));
  $('finding-count').textContent = findings.length;
  if (!findings.length) {
    let message = 'Ask MOGS to check your imported assets, then review its findings here.';
    if (run && asset) message = !run.assetIds.includes(asset.id) ? 'This asset was not included in the selected run. Select it and start a new check.' : ['queued', 'running'].includes(run.status) ? 'Findings will appear after analysis. No conclusion is available yet.' : asset.status === 'failed' ? 'The source could not be extracted. See the recorded failure above.' : 'No findings are recorded for this asset in this run. Check coverage and errors before drawing a conclusion.';
    container.append(el('p', 'empty-message', message));
    return;
  }
  container.append(el('p', 'field-help', 'Corrections and unresolved items shown first.'));
  if (!findings.some((finding) => finding.unitId === state.unitId)) state.unitId = null;
  for (const finding of findings) {
    const article = el('article', 'finding'); article.dataset.selected = String(finding.unitId === state.unitId);
    const header = el('div', 'finding-heading'); header.append(badge(labelNames[finding.label] || finding.label, labelTone(finding.label)));
    const content = el('div', 'finding-content');
    content.append(el('p', 'finding-location', `${locationText(finding.locator)} · ${finding.kind.replaceAll('_', ' ')}`));
    content.append(el('span', 'copy-label', 'Current source'), el('p', 'source-copy', finding.original));
    if (finding.replacement !== null) {
      content.append(el('span', 'copy-label', run.stale ? 'Previously suggested · stale' : 'Suggested copy'), el('p', 'proposed-copy', finding.replacement));
    }
    content.append(el('p', 'rationale', finding.rationale));
    if (finding.withholdReason) content.append(el('p', 'withheld', `Suggestion withheld: ${finding.withholdReason}`));
    if (finding.label === 'valid_exception') content.append(el('p', 'field-help', 'Preserve this source. Its context supports an exception.'));
    if (finding.label === 'insufficient_context' && !finding.withholdReason) content.append(el('p', 'withheld', 'No suggested edit. More reliable context is required.'));
    const checkDetails = el('details', 'checks');
    const passes = finding.checks.filter((check) => check.pass).length;
    checkDetails.append(el('summary', '', finding.checks.length ? `Checks: ${passes}/${finding.checks.length} passed` : 'Checks: none recorded'));
    const list = el('ul');
    for (const check of finding.checks) list.append(el('li', '', `${check.pass ? 'Pass' : 'Fail'} · ${check.name}: ${check.detail}`));
    checkDetails.append(list); content.append(checkDetails);
    const unit = asset.extraction?.units.find((candidate) => candidate.id === finding.unitId);
    content.append(details('Claim evidence', [['Unit ID', finding.unitId], ['Source revision', finding.revision], ['Locator', JSON.stringify(finding.locator)], ['Surrounding source context', unit?.context || 'Unavailable'], ['Extraction confidence', unit?.confidence == null ? 'Not reported by extractor' : String(unit.confidence)], ['Fact snapshot', run.factsHash]]));
    const button = el('button', 'secondary', finding.unitId === state.unitId ? 'Source location selected' : 'Show source location'); button.type = 'button'; button.setAttribute('aria-pressed', String(finding.unitId === state.unitId));
    button.addEventListener('click', () => {
      state.unitId = finding.unitId;
      state.page = finding.locator.kind === 'html' ? 1 : finding.locator.page;
      renderFindings(); renderPreview();
      const selected = [...$('findings').querySelectorAll('article')].find((item) => item.dataset.selected === 'true');
      selected?.querySelector('button')?.focus({ preventScroll: true });
      say(`Source location selected: ${locationText(finding.locator)}.`);
    });
    content.append(button); article.append(header, content); container.append(article);
  }
}
function renderPreview() {
  const container = clear('source-preview'); const asset = selectedAsset();
  $('page-controls').hidden = true;
  $('preview-help').textContent = 'Select a finding to highlight its exact extracted location.';
  if (!asset?.extraction?.previews.length) {
    container.append(el('p', 'empty-message', asset?.status === 'extracting' ? 'The source preview is being prepared.' : asset ? 'No source preview is available. See extraction status and warnings.' : 'Import an asset or load the designed campaign to see its source.'));
    return;
  }
  const unit = asset.extraction.units.find((candidate) => candidate.id === state.unitId);
  const pages = asset.extraction.previews;
  let preview = pages.find((page) => page.page === state.page) || pages[0];
  state.page = preview.page;
  const url = apiUrl(`/api/assets/${encodeURIComponent(asset.id)}/preview/${preview.page}${unit ? `?unit=${encodeURIComponent(unit.id)}` : ''}`);
  if (asset.surface === 'email') {
    if (unit?.locator.kind === 'html' && unit.locator.field) {
      const field = el('div', 'source-field'); field.append(el('strong', '', `Email ${unit.locator.field}`), el('p', '', unit.text)); container.append(field);
    }
    const iframe = el('iframe'); iframe.title = `Sanitized email preview: ${asset.context.title || asset.filename}`; iframe.setAttribute('sandbox', ''); iframe.referrerPolicy = 'no-referrer'; iframe.src = unit ? `${url}#mogs-selected-unit` : url; container.append(iframe);
    $('preview-help').textContent = 'Sanitized email preview. Scripts, forms, navigation, and remote tracking are disabled. Original template bytes remain unchanged.';
  } else {
    const frame = el('div', 'preview-image'); const image = el('img'); image.src = url; image.alt = `${asset.surface === 'deck' ? `PDF page ${preview.page}` : 'Original creative'} of ${asset.context.title || asset.filename}`;
    image.addEventListener('error', () => { container.replaceChildren(el('p', 'empty-message', 'The preview could not be loaded. The recorded source and findings remain available.')); });
    frame.append(image);
    if (unit && unit.locator.kind !== 'html' && unit.locator.page === preview.page) {
      const [x, y, width, height] = unit.locator.bbox;
      if (preview.width > 0 && preview.height > 0 && [x, y, width, height].every(Number.isFinite)) {
        const highlight = el('div', 'source-highlight'); highlight.setAttribute('aria-hidden', 'true');
        highlight.style.left = `${Math.max(0, Math.min(100, x / preview.width * 100))}%`;
        highlight.style.top = `${Math.max(0, Math.min(100, y / preview.height * 100))}%`;
        highlight.style.width = `${Math.max(0, Math.min(100, width / preview.width * 100))}%`;
        highlight.style.height = `${Math.max(0, Math.min(100, height / preview.height * 100))}%`;
        frame.append(highlight);
      }
      $('preview-help').textContent = `Highlighted extraction: “${unit.text}”${unit.uncertain ? ' · Extraction is uncertain; review the original.' : ''}`;
    }
    container.append(frame);
  }
  if (pages.length > 1) {
    $('page-controls').hidden = false;
    const index = pages.findIndex((page) => page.page === state.page);
    $('page-label').textContent = `Page ${preview.page} of ${pages.length}`;
    $('previous-page').disabled = index <= 0; $('next-page').disabled = index >= pages.length - 1;
  }
}
function renderAgent() {
  const task = selectedTask();
  const available = state.agent?.available;
  $('agent-availability').textContent = available ? 'Agent connected' : 'Agent unavailable';
  $('agent-availability').className = `badge ${available ? 'good' : 'attention'}`;
  $('agent-unavailable').hidden = !!available;
  $('agent-unavailable').textContent = available ? '' : `${state.agent?.reason || 'Checking agent availability.'} Configure the server provider setting to use natural-language requests. Imported source review remains available.`;
  const container = clear('agent-conversation');
  if (task) {
    const chain = []; let cursor = task; const seen = new Set();
    while (cursor && !seen.has(cursor.id)) { seen.add(cursor.id); chain.unshift(cursor); cursor = state.tasks.find((candidate) => candidate.id === cursor.previousTaskId); }
    for (const item of chain) {
      const turn = el('div', 'agent-turn'); turn.append(el('p', 'speaker', 'You'), el('p', 'agent-message', item.message));
      if (item.reply) turn.append(el('p', 'speaker', 'MOGS'), agentReply(item.reply));
      container.append(turn);
    }
    const taskStatus = el('div', 'agent-task-status');
    const labels = {queued:'Queued',running:'Working',needs_input:'Your reply is needed',complete:'Task complete',failed:'Task failed',cancelled:'Task cancelled'};
    taskStatus.append(badge(labels[task.status] || task.status, ['failed', 'cancelled'].includes(task.status) ? 'danger' : task.status === 'complete' ? 'good' : 'attention'));
    container.append(taskStatus);
    if (task.events.length) {
      const progress = el('details', 'agent-progress'); progress.open = ['queued', 'running'].includes(task.status);
      progress.append(el('summary', '', `${task.events.length} recorded tool ${task.events.length === 1 ? 'action' : 'actions'}`));
      const list = el('ol'); for (const event of task.events) { const item = el('li'); item.append(el('strong', '', event.title), el('p', '', event.detail)); list.append(item); } progress.append(list); container.append(progress);
    }
    if (task.error) addNotice(container, task.error, true);
    if (task.runId && !['queued', 'running'].includes(task.status)) {
      const link = el('a', 'button-link secondary', 'Review the findings'); link.href = '#review'; link.addEventListener('click', () => { selectRun(task.runId); render(); }); container.append(link);
    }
    container.append(details('Agent evidence', [['Task ID', task.id], ['Model', task.model], ['Created', task.createdAt], ['Completed', task.completedAt || 'In progress'], ['Input tokens', task.usage.inputTokens], ['Output tokens', task.usage.outputTokens], ['Analysis run', task.runId || 'No scan started']]));
  }
  const followup = task?.status === 'needs_input';
  $('agent-message-label').textContent = followup ? 'Your reply' : 'Your request';
  $('agent-message').placeholder = followup ? 'Add the missing details so MOGS can continue…' : 'Raise Starter to $40 a month for new customers, preserve legacy pricing, and check all imported assets.';
  $('agent-submit').textContent = followup ? 'Send reply' : state.tasks.some((item) => ['queued', 'running'].includes(item.status)) ? 'MOGS is working…' : 'Ask MOGS';
  $('new-request').hidden = !task || ['queued', 'running'].includes(task.status);
  $('prompt-examples').hidden = !!task;
  $('task-history').hidden = !state.tasks.length;
  const select = clear('task-select'); const blank = el('option', '', 'Start a new request'); blank.value = ''; select.append(blank);
  for (const item of state.tasks) { const option = el('option', '', `${readableDate(item.createdAt)} · ${item.message.slice(0,80)}`); option.value = item.id; select.append(option); }
  select.value = state.taskId || '';
}
function render() {
  renderAgent(); renderAssets(); renderRunOptions(); renderRunSummary(); renderAssetSummary(); renderFindings();
  const asset = selectedAsset();
  const unit = asset?.extraction?.units.find((candidate) => candidate.id === state.unitId);
  if (unit?.locator.kind !== 'html' && unit?.locator.page) state.page = unit.locator.page;
  renderPreview();
}
function updateFacts() {
  if (!state.facts) return;
  $('facts-description').textContent = `MOGS Starter: before ${dollars(state.facts.beforeMonthlyCents)}/month. Annual ${dollars(state.facts.annualCents)}/year; Team ${dollars(state.facts.teamMonthlyCents)}/month. Eligible active legacy Starter subscribers retain ${dollars(state.facts.legacyMonthlyCents)}/month with cutoff ${state.facts.legacyCutoff}.`;
}
async function loadState(options = {}) {
  const data = await request('/api/state');
  const known = new Set(state.assets.map((asset) => asset.id));
  state.assets = data.assets; state.runs = data.runs; state.facts = data.facts;
  state.agent = data.agent || {available: false, model: '', reason: 'The agent is unavailable on this server. Restart the lab with agent support.'};
  state.tasks = data.agentTasks || [];
  if (!state.initialized && !state.taskId) state.taskId = state.tasks[0]?.id || null;
  if (options.taskId) state.taskId = options.taskId;
  const task = selectedTask();
  if (task?.runId && !['queued', 'running'].includes(task.status) && state.shownTaskRun !== task.id + task.runId) {
    selectRun(task.runId); state.shownTaskRun = task.id + task.runId;
  }
  for (const asset of state.assets) if (asset.active && (!state.initialized || !known.has(asset.id))) state.selected.add(asset.id);
  for (const id of state.selected) if (!state.assets.some((asset) => asset.id === id && asset.active)) state.selected.delete(id);
  if (!state.assetId || !state.assets.some((asset) => asset.id === state.assetId)) state.assetId = state.assets[0]?.id || null;
  if (options.assetId) { state.assetId = options.assetId; state.unitId = null; state.page = 1; }
  if (!state.runId || !state.runs.some((run) => run.id === state.runId)) state.runId = state.runs[0]?.id || null;
  if (options.runId) state.runId = options.runId;
  if (!state.initialized) $('import-panel').open = state.assets.length === 0;
  state.initialized = true; updateFacts(); render(); schedulePoll();
}
function schedulePoll() {
  clearTimeout(state.poll);
  if (state.tasks.some((task) => ['queued', 'running'].includes(task.status)) || state.runs.some((run) => ['queued', 'running'].includes(run.status)) || state.assets.some((asset) => asset.status === 'extracting')) {
    state.poll = setTimeout(async () => {
      try { await loadState(); const task = selectedTask(); if (task) say(task.status === 'needs_input' ? 'MOGS needs more context. Reply in the request box.' : ['queued', 'running'].includes(task.status) ? (task.events.at(-1)?.title || 'Agent is working…') : `Agent request ${task.status}. Review its response and recorded findings.`); }
      catch (failure) { error(failure.message); say('Could not refresh progress. Reload to reconnect.'); }
    }, 1000);
  }
}
function base64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('The selected file could not be read.')); reader.readAsDataURL(file);
  });
}
$('import-form').addEventListener('submit', async (event) => {
  event.preventDefault(); error('');
  const file = $('file').files[0]; if (!file) return;
  if (file.size > 10 * 1024 * 1024) { error('Choose a file smaller than 10 MB.'); return; }
  const context = {};
  for (const field of ['title', 'audience', 'journey', 'subject', 'preheader', 'plainText', 'region', 'date']) context[field] = $(field).value;
  context.legacyEligible = $('eligibility').value === 'unknown' ? null : $('eligibility').value === 'true';
  setBusy(true); say(`Importing and extracting ${file.name}…`);
  try {
    const asset = await request('/api/import', { filename: file.name, base64: await base64(file), context });
    await loadState({ assetId: asset.id });
    say(asset.status === 'failed' ? `Import recorded with an extraction failure: ${file.name}.` : asset.status === 'extracting' ? `Import recorded. Extracting ${file.name}…` : `Imported ${file.name}: ${asset.status}. Review source coverage before checking.`);
    if (asset.status === 'failed') error(asset.error || 'Extraction failed. See the asset record for details.');
  } catch (failure) { error(failure.message); say('Import did not complete. Your existing assets are unchanged.'); }
  finally { setBusy(false); }
});
$('demo-button').addEventListener('click', async () => {
  error(''); setBusy(true); say('Importing the designed campaign: two emails, a sales deck, and three creatives…');
  try {
    const result = await request('/api/demo', {});
    await loadState({ assetId: result.assets[0]?.id });
    const failures = result.assets.filter((asset) => asset.status === 'failed').length;
    say(`Loaded ${result.assets.length} campaign assets${failures ? `; ${failures} extraction failures are recorded` : ''}. Describe what changed above to start an agent review.`);
    $('import-panel').open = false;
  } catch (failure) { error(failure.message); say('Example import did not complete. Any recorded assets remain available.'); await loadState().catch(() => {}); }
  finally { setBusy(false); }
});
$('agent-form').addEventListener('submit', async (event) => {
  event.preventDefault(); error('');
  const message = $('agent-message').value.trim(); if (!message) return;
  const previous = selectedTask();
  const payload = { message };
  if (previous?.status === 'needs_input') payload.previousTaskId = previous.id;
  else {
    const assetIds = state.assets.filter((asset) => asset.active && state.selected.has(asset.id)).map((asset) => asset.id);
    if (assetIds.length) payload.assetIds = assetIds;
  }
  setBusy(true); say('Sending your request to MOGS…');
  let acceptedTask = null;
  try {
    const task = await request('/api/agent', payload);
    acceptedTask = task; state.taskId = task.id;
    state.tasks = [task, ...state.tasks.filter((item) => item.id !== task.id)];
    await loadState({ taskId: task.id });
    $('agent-message').value = '';
    say('Agent request started. Its tool activity will appear below.');
  } catch (failure) {
    if (acceptedTask) {
      render(); schedulePoll();
      error(`The request was accepted, but its progress could not be refreshed: ${failure.message}`);
      say('Your accepted request is retained. Reload to reconnect; your request text is preserved.');
    } else { error(failure.message); say('The agent request could not start. Your request text is preserved.'); }
  }
  finally { setBusy(false); }
});
for (const button of $('prompt-examples').querySelectorAll('[data-prompt]')) button.addEventListener('click', () => {
  $('agent-message').value = button.dataset.prompt; $('agent-message').focus();
});
$('new-request').addEventListener('click', () => {
  state.taskId = null; $('agent-message').value = ''; renderAgent(); updateSelection(); $('agent-message').focus();
});
$('task-select').addEventListener('change', () => {
  state.taskId = $('task-select').value || null;
  const task = selectedTask();
  if (task?.runId && !['queued', 'running'].includes(task.status)) { selectRun(task.runId); state.shownTaskRun = task.id + task.runId; }
  render();
});
$('select-all').addEventListener('change', () => {
  for (const asset of state.assets.filter((asset) => asset.active)) $('select-all').checked ? state.selected.add(asset.id) : state.selected.delete(asset.id);
  renderAssets();
});
$('run-select').addEventListener('change', () => {
  state.runId = $('run-select').value; state.unitId = null; state.page = 1;
  const run = selectedRun();
  if (run && !run.assetIds.includes(state.assetId)) state.assetId = run.assetIds[0] || state.assetId;
  render();
});
function changePage(direction) {
  const pages = selectedAsset()?.extraction?.previews || [];
  const index = pages.findIndex((preview) => preview.page === state.page);
  if (pages[index + direction]) { state.page = pages[index + direction].page; state.unitId = null; renderPreview(); for (const article of $('findings').querySelectorAll('article')) { article.dataset.selected = 'false'; const button = article.querySelector('button'); button.textContent = 'Show source location'; button.setAttribute('aria-pressed', 'false'); } }
}
$('previous-page').addEventListener('click', () => changePage(-1));
$('next-page').addEventListener('click', () => changePage(1));
loadState().then(() => say(state.assets.length ? `${state.assets.length} local assets available. Select an asset to inspect its source.` : 'Ready to import. Add your own asset or try the designed campaign.')).catch((failure) => { error(failure.message); say('The lab could not be loaded.'); });
