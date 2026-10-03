import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assetIdFor, contextHashFor, parseSource } from '../assets/source';
import { targetForKind } from '../facts/derive';
import { hashRecord, sha256 } from '../hash';
import { judge } from '../providers';
import { CheckNameSchema, PassageSchema, type Check, type FactSnapshot, type Page, type Passage, type Patch, type Target } from '../types';

type CheckName = Check['name'];
type CheckResult = { pass: boolean; detail: string };
type NumericValue = { value: number; unit: Target['unit'] | 'unknown' };

const qualifierPatterns = [
  /\b(?:billed|billing)\s+monthly\b/gi, /\bmonthly\s+billing\b/gi,
  /\b(?:a|per|each)\s+month\b/gi, /\b(?:billed|billing)\s+annually\b/gi,
  /\bannual\s+billing\b/gi, /\b(?:a|per|each)\s+year\b/gi,
  /\b(?:a|per|each)\s+day\b/gi, /\b(?:new|existing|current)\s+customers?\b/gi,
  /\bactive\s+pre-change\b/gi, /\bpre-change\b/gi,
  /\b(?:legacy|grandfathered|historical)\b/gi, /\b(?:about|approximately|around|only|under|over|before|after)\b/gi,
  /\b(?:in|since)\s+\d{4}\b/gi,
];
const broadening = /\b(?:for\s+everyone|all\s+customers?|any\s+customers?|without\s+exception|no\s+exceptions?|guaranteed)\b/i;
const wordNumbers: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100,
};

function result(pass: boolean, detail: string): CheckResult { return { pass, detail }; }

function wordTokens(text: string): string[] {
  return text.match(/\p{L}+(?:['’]\p{L}+)?|\d+(?:[.,]\d+)*|[^\s]/gu) ?? [];
}

/** Count contiguous token edits using an LCS, including punctuation and currency markers. */
function spanCheck(original: string, replacement: string): CheckResult {
  const oldWords = wordTokens(original), newWords = wordTokens(replacement);
  if (oldWords.length > 300 || newWords.length > 300) return result(false, 'Passage exceeds the bounded word-diff size.');
  const matrix: number[][] = Array.from({ length: oldWords.length + 1 }, () => Array<number>(newWords.length + 1).fill(0));
  for (let i = oldWords.length - 1; i >= 0; i--) for (let j = newWords.length - 1; j >= 0; j--)
    matrix[i][j] = oldWords[i] === newWords[j] ? 1 + matrix[i + 1][j + 1] : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
  let i = 0, j = 0, removed = 0, added = 0;
  const spans: { removed: number; added: number }[] = [];
  const flush = () => { if (removed || added) spans.push({ removed, added }); removed = 0; added = 0; };
  while (i < oldWords.length || j < newWords.length) {
    if (i < oldWords.length && j < newWords.length && oldWords[i] === newWords[j]) { flush(); i++; j++; }
    else if (j < newWords.length && (i === oldWords.length || matrix[i][j + 1] >= matrix[i + 1][j])) { added++; j++; }
    else { removed++; i++; }
  }
  flush();
  const pass = spans.length > 0 && spans.length <= 2 && spans.every(span => span.removed + span.added <= 8);
  return result(pass, spans.length + ' changed span(s); token edits ' + spans.map(span => span.removed + '/' + span.added).join(', ') + '.');
}

function asWordNumber(phrase: string): number | null {
  const parts = phrase.toLowerCase().replace(/-/g, ' ').split(/\s+/);
  if (parts.length === 1) return wordNumbers[parts[0]] ?? null;
  if (parts.length === 2 && wordNumbers[parts[0]] !== undefined && wordNumbers[parts[1]] !== undefined) return wordNumbers[parts[0]] + wordNumbers[parts[1]];
  return null;
}

function numericValues(text: string): NumericValue[] {
  const values: NumericValue[] = [];
  const digit = /(?<![\p{L}\p{N}])(\$)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(%|percent\b|dollars?\b)?/giu;
  for (const match of text.matchAll(digit)) {
    const amount = Number(match[2].replaceAll(',', '') + (match[3] ? '.' + match[3] : ''));
    const suffix = (match[4] ?? '').toLowerCase(), tail = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 24);
    const currency = Boolean(match[1]) || suffix.startsWith('dollar');
    const unit: NumericValue['unit'] = suffix === '%' || suffix === 'percent' ? 'percent' : currency ? (/^\s*(?:a|per|each)\s+day\b/i.test(tail) ? 'usd_per_day' : 'usd') : 'unknown';
    values.push({ value: amount, unit });
  }
  const spelled = /\b((?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?)\s+(dollars?|percent)\b/gi;
  for (const match of text.matchAll(spelled)) {
    const value = asWordNumber(match[1]);
    if (value === null) continue;
    const tail = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 24);
    values.push({ value, unit: match[2].toLowerCase() === 'percent' ? 'percent' : /^\s*(?:a|per|each)\s+day\b/i.test(tail) ? 'usd_per_day' : 'usd' });
  }
  return values;
}

function numericKey(number: NumericValue): string { return number.value.toFixed(4) + ':' + number.unit; }

function numbersCheck(original: string, replacement: string, target: Target | null): CheckResult {
  if (!target) return result(false, 'No deterministic target value is available.');
  const before = new Map<string, number>();
  for (const number of numericValues(original)) before.set(numericKey(number), (before.get(numericKey(number)) ?? 0) + 1);
  const introduced: NumericValue[] = [];
  for (const number of numericValues(replacement)) {
    const key = numericKey(number), remaining = before.get(key) ?? 0;
    if (remaining) before.set(key, remaining - 1);
    else introduced.push(number);
  }
  const pass = introduced.length > 0 && introduced.every(number => number.unit === target.unit && Math.abs(number.value - target.value) < 0.0001);
  return result(pass, introduced.length ? 'Introduced values: ' + introduced.map(number => numericKey(number)).join(', ') + '; target ' + numericKey(target) + '.' : 'No new target value was introduced.');
}

function qualifierCheck(original: string, replacement: string): CheckResult {
  const missing: string[] = [];
  for (const pattern of qualifierPatterns) {
    for (const match of original.matchAll(pattern)) if (!replacement.toLowerCase().includes(match[0].toLowerCase())) missing.push(match[0]);
  }
  for (const plan of ['Starter', 'Team', 'Business']) if (new RegExp('\\b' + plan + '\\b', 'i').test(original) && !new RegExp('\\b' + plan + '\\b', 'i').test(replacement)) missing.push(plan);
  if (broadening.test(replacement) && !broadening.test(original)) missing.push('new broad audience claim');
  return result(missing.length === 0, missing.length ? 'Missing or broadened qualifiers: ' + [...new Set(missing)].join(', ') + '.' : 'Original plan, billing, audience, time, and approximation qualifiers remain.');
}

function tokenSequence(text: string): string[] { return text.match(/\{\{[^{}]*\}\}|\{%[^%]*%\}|https?:\/\/[^\s<>"']+/g) ?? []; }
function tokenCheck(original: string, replacement: string): CheckResult {
  const before = tokenSequence(original), after = tokenSequence(replacement);
  return result(JSON.stringify(before) === JSON.stringify(after), 'Email Liquid tags and URLs ' + (JSON.stringify(before) === JSON.stringify(after) ? 'retain exact order and occurrences.' : 'changed or moved.'));
}

/** Check the captured/current revision and the actual on-disk source before spending a rejudge call. */
export async function checkPatch(patch: Patch, p: Passage, page: Page, beforeFacts: FactSnapshot, afterFacts: FactSnapshot): Promise<Check[]> {
  const replacement = patch.replacement;
  const evaluated: Partial<Record<CheckName, CheckResult>> = {};
  evaluated.span_confined = replacement ? spanCheck(patch.original, replacement) : result(false, 'No replacement to compare.');
  evaluated.numbers_allowed = replacement ? numbersCheck(patch.original, replacement, patch.target) : result(false, 'No replacement to inspect.');
  evaluated.qualifiers_kept = replacement ? qualifierCheck(patch.original, replacement) : result(false, 'No replacement to inspect.');
  evaluated.fact_fresh = result(afterFacts.phase === 'confirmed' && afterFacts.version === patch.factVersion && beforeFacts.version + 1 === afterFacts.version && beforeFacts.scenarioId === afterFacts.scenarioId && hashRecord(patch.target) === hashRecord(targetForKind(patch.kind, afterFacts)), 'Patch fact version and deterministic target ' + (afterFacts.version === patch.factVersion ? 'match current supplied facts.' : 'do not match current supplied facts.'));
  if (patch.surface === 'email') evaluated.tokens_kept = replacement ? tokenCheck(patch.original, replacement) : result(false, 'No replacement to inspect.');

  let located = false, fresh = false, sourceDetail = '';
  try {
    if (!page.file || assetIdFor(page.surface, page.file) !== page.assetId) throw new Error('No valid editable source path.');
    const root = path.resolve(process.env.MOGS_CONTENT_ROOT ?? path.join(process.cwd(), 'content'));
    const file = path.resolve(root, page.file);
    if (!file.startsWith(root + path.sep)) throw new Error('Source path escapes the content root.');
    const bytes = await readFile(file);
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const asset = parseSource(source, page.file, page.surface);
    const blocks = asset.blocks.filter(block => block.sourceId === patch.sourceId);
    located = patch.passageId === p.id && patch.assetId === page.assetId && patch.url === page.url && patch.surface === page.surface && p.sourceId === patch.sourceId && blocks.length === 1 && blocks[0].text === patch.original && p.text === patch.original && sha256(blocks[0].text) === patch.expectedBlockHash && p.blockHash === patch.expectedBlockHash;
    fresh = located && asset.sourceHash === patch.expectedFileHash && page.sourceHash === patch.expectedFileHash && p.contextHash === patch.expectedContextHash && asset.meta && hashRecord(asset.meta) === patch.expectedMetadataHash && page.metadataHash === patch.expectedMetadataHash;
    sourceDetail = 'File, block, metadata, and rendered context checked against current source.';
  } catch (error) {
    sourceDetail = error instanceof Error ? error.message : 'Unable to read current source.';
  }
  evaluated.source_located = result(located, located ? 'Source ID resolves once with the expected original block.' : 'Source location or original block mismatch: ' + sourceDetail);
  evaluated.source_fresh = result(fresh, fresh ? 'Current file, metadata, and rendered context match expected revision.' : 'Current source revision mismatch: ' + sourceDetail);

  const prerequisites = ['span_confined', 'numbers_allowed', 'qualifiers_kept', 'source_located', 'source_fresh', 'fact_fresh', ...(patch.surface === 'email' ? ['tokens_kept'] : [])] as CheckName[];
  if (!replacement || prerequisites.some(name => !evaluated[name]?.pass)) {
    evaluated.rejudge_consistent = result(false, 'Rejudge skipped because an applicable prerequisite check failed.');
  } else {
    try {
      const heading = p.role === 'heading' ? replacement : p.heading;
      const candidate = PassageSchema.parse({ ...p, text: replacement, blockHash: sha256(replacement), heading, contextHash: contextHashFor(page.meta, p.role, heading, p.before, p.after) });
      const verdict = await judge(patch.runId, candidate, page, beforeFacts, afterFacts);
      const pass = verdict.runId === patch.runId && verdict.passageId === p.id && verdict.factVersion === patch.factVersion && verdict.kind === patch.kind && verdict.escalatedBy === null && ['consistent', 'valid_exception'].includes(verdict.label);
      evaluated.rejudge_consistent = result(pass, 'Replacement rejudge: ' + verdict.label + ', kind ' + verdict.kind + ', adapter ' + verdict.adapter + ', model ' + verdict.model + '.');
    } catch (error) {
      evaluated.rejudge_consistent = result(false, 'Replacement rejudge failed: ' + (error instanceof Error ? error.message : 'unknown provider error'));
    }
  }
  return CheckNameSchema.options.filter(name => name !== 'tokens_kept' || patch.surface === 'email').map(name => ({ name, ...evaluated[name]! }));
}
