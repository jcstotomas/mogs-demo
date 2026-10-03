import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss, { CssSyntaxError, type AtRule, type ChildNode, type Declaration, type Node, type Root, type Rule } from 'postcss';

export interface UiIssue {
  file: string;
  line: number;
  column: number;
  rule: string;
  message: string;
}

type Variables = Record<string, string[]>;
const motionProperties = new Set(['transform', 'translate', 'rotate', 'scale']);
const layoutProperty = /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|(?:margin|padding|inset|gap|row-gap|column-gap)(?:-.+)?|top|right|bottom|left|flex(?:-.+)?|grid(?:-.+)?|font-size|line-height|letter-spacing|word-spacing|border(?:-.+)?-width)$/;
const timingKeyword = /^(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|normal|allow-discrete)$/;
const animationKeyword = /^(?:none|infinite|normal|reverse|alternate|alternate-reverse|forwards|backwards|both|running|paused|auto|initial|inherit|unset|revert|revert-layer)$/;
const timeValue = /^-?(?:\d*\.)?\d+(ms|s)$/i;
const withoutComments = (value: string) => value.replace(/\/\*[\s\S]*?\*\//g, '').trim();

/** Split CSS lists without treating commas/spaces inside functions as separators. */
function split(value: string, separator: ',' | ' '): string[] {
  const parts: string[] = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '\\') { i++; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (depth === 0 && (separator === ',' ? char === ',' : /\s/.test(char))) {
      if (value.slice(start, i).trim()) parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (value.slice(start).trim()) parts.push(value.slice(start).trim());
  return parts;
}

function variablesIn(root: Root): Variables {
  const variables: Variables = {};
  root.walkDecls(decl => {
    if (decl.prop.startsWith('--')) (variables[decl.prop] ??= []).push(withoutComments(decl.value));
  });
  return variables;
}

// Inspect every definition conservatively; this is not a CSS cascade evaluator.
function expandedValues(value: string, variables: Variables, seen = new Set<string>()): string[] {
  const match = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/.exec(value);
  if (!match) return [value];
  const [, name, fallback] = match;
  if (seen.has(name)) return [value];
  const replacements = variables[name] ?? (fallback === undefined ? [] : [fallback]);
  if (!replacements.length) return [value];
  const nextSeen = new Set(seen).add(name);
  return replacements.flatMap(replacement => expandedValues(replacement, variables, nextSeen).flatMap(expanded => {
    const result = value.replace(match[0], expanded);
    // A cycle/unresolved nested value is reported by the caller; do not recurse forever.
    return /var\(/.test(expanded) ? [result] : expandedValues(result, variables, seen);
  }));
}

function mediaAllows(node: ChildNode, feature: string, value: string): boolean {
  const condition = new RegExp(`\\(\\s*${feature}\\s*:\\s*${value}\\s*\\)`, 'i');
  for (let parent: Node | undefined = node.parent; parent; parent = parent.parent) {
    if (parent.type !== 'atrule') continue;
    const media = parent as AtRule;
    if (media.name.toLowerCase() !== 'media') continue;
    const queries = split(withoutComments(media.params), ',');
    // Only conjunctions establish a gate. A negated or alternative feature does not.
    if (queries.length && queries.every(query => !/\b(?:not|or)\b/i.test(query) && condition.test(query))) return true;
  }
  return false;
}

function containingRule(decl: Declaration): Rule | undefined {
  for (let parent: Node | undefined = decl.parent; parent; parent = parent.parent) {
    if (parent.type === 'rule') return parent as Rule;
  }
}

function transitionProperties(value: string, shorthand: boolean): string[] {
  if (/^(?:initial|inherit|unset|revert|revert-layer)$/.test(value)) return ['all'];
  if (!shorthand) return split(value, ',').map(item => item.trim().toLowerCase());
  return split(value, ',').map(item => {
    const property = split(item, ' ').find(token => !timeValue.test(token) && !timingKeyword.test(token) && !token.includes('('));
    return property?.toLowerCase() ?? 'all';
  });
}

function hasAnimationName(value: string, shorthand: boolean): boolean {
  return split(value, ',').some(item => {
    if (!shorthand) return !/^(?:none|initial|inherit|unset|revert|revert-layer)$/.test(item);
    return split(item, ' ').some(token => !timeValue.test(token) && !timingKeyword.test(token) && !animationKeyword.test(token) && !/^[\d.]+$/.test(token) && !token.includes('('));
  });
}

/** A narrow source lint for this console, not computed-style or accessibility proof. */
export function auditCss(file: string, source: string, sharedVariables: Variables = {}): UiIssue[] {
  const issues: UiIssue[] = [];
  let root: Root;
  try { root = postcss.parse(source, { from: file }); }
  catch (error) {
    if (!(error instanceof CssSyntaxError)) throw error;
    return [{ file, line: error.line ?? 1, column: error.column ?? 1, rule: 'valid-css', message: error.reason }];
  }
  const localVariables = variablesIn(root);
  const variables: Variables = { ...sharedVariables };
  for (const [name, values] of Object.entries(localVariables)) variables[name] = [...(variables[name] ?? []), ...values];
  const report = (node: ChildNode, rule: string, message: string) => {
    const start = node.source?.start;
    if (!issues.some(issue => issue.line === start?.line && issue.column === start?.column && issue.rule === rule)) {
      issues.push({ file, line: start?.line ?? 1, column: start?.column ?? 1, rule, message });
    }
  };
  root.walkRules(rule => {
    if (/:hover\b/i.test(rule.selector) && (!mediaAllows(rule, 'hover', 'hover') || !mediaAllows(rule, 'pointer', 'fine'))) {
      report(rule, 'touch-hover', 'Put :hover rules inside (hover: hover) and (pointer: fine) media gates.');
    }
  });
  root.walkDecls(decl => {
    const property = decl.prop.toLowerCase().replace(/^-(?:webkit|moz)-/, '');
    const originalValue = withoutComments(decl.value);
    const rule = containingRule(decl);
    if (property === 'font-family' && !/^(?:var\(\s*--font-ui\s*\)|inherit)$/i.test(originalValue)) {
      report(decl, 'one-font', 'Use font-family: var(--font-ui) or inherit; define the font only in app/globals.css.');
    }
    if (property === 'font' && originalValue !== 'inherit') report(decl, 'one-font', 'Use font-family: var(--font-ui); font shorthand bypasses the shared typography.');
    if (property === '--font-ui' && (file.replaceAll('\\', '/') !== 'app/globals.css' || rule?.selector !== ':root')) {
      report(decl, 'one-font', 'Define --font-ui only on :root in app/globals.css.');
    }
    const literalFontSize = property === 'font-size' ? /^([+-]?(?:\d*\.)?\d+)(px|rem)$/i.exec(originalValue) : null;
    if (literalFontSize && Number(literalFontSize[1]) < (literalFontSize[2].toLowerCase() === 'px' ? 12 : .75)) {
      report(decl, 'readable-type', 'Keep literal font sizes at least 12px or .75rem (assuming the default root font size).');
    }
    // Deliberately universal: this console keeps outlines, even if a rule adds a box-shadow replacement.
    if (['outline', 'outline-style'].includes(property) && split(originalValue.toLowerCase(), ' ').some(token => token === 'none' || /^[+-]?0(?:\.0+)?(?:[a-z]+|%)?$/.test(token))) {
      report(decl, 'visible-focus', 'Keep a visible outline; outline: none/0 is prohibited even when another focus treatment is present.');
    }
    if (property === 'backdrop-filter' && originalValue !== 'none') report(decl, 'restrained-decoration', 'Remove backdrop filtering from the review console.');
    if (property === 'text-shadow' && originalValue !== 'none') report(decl, 'restrained-decoration', 'Remove decorative text shadows from the review console.');

    for (const rawValue of expandedValues(originalValue, variables)) {
      const value = rawValue.toLowerCase();
      if (/(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/i.test(value)) {
        report(decl, 'restrained-decoration', 'Use a solid surface or semantic color instead of a decorative gradient.');
      }
      if ((motionProperties.has(property) && /\bscale(?:x|y|z|3d)?\(\s*[+-]?0(?:\.0+)?(?=[\s,)])/i.test(value)) || (property === 'scale' && /^[+-]?0(?:\.0+)?(?:\s|$)/.test(value))) {
        report(decl, 'visible-scale', 'Do not enter from scale(0); use a visible scale with opacity if motion is justified.');
      }
      const isTransition = property === 'transition' || property.startsWith('transition-');
      const isAnimation = property === 'animation' || property.startsWith('animation-');
      if (!isTransition && !isAnimation && !motionProperties.has(property)) continue;
      if ((isTransition || isAnimation) && /\bease-in\b(?!-out)/.test(value)) report(decl, 'responsive-easing', 'Use the shared ease-out curve for entering/exiting UI; ease-in delays feedback.');
      if ((isTransition || isAnimation) && /var\(/.test(value)) report(decl, 'known-motion-value', 'Use a resolvable motion token; this checker cannot validate this custom property.');
      if ((isTransition || isAnimation) && /\b(?:calc|min|max|clamp)\(/.test(value)) report(decl, 'known-motion-value', 'Use explicit durations or simple duration tokens; timing calculations require manual review.');
      if ((isTransition || isAnimation) && /(?:^|-)duration$/.test(property)) {
        for (const token of split(value, ',')) if (timeValue.test(token) && milliseconds(token) > 300) report(decl, 'short-duration', 'Keep UI durations at or below 300ms.');
      } else if (property === 'transition' || property === 'animation') {
        for (const item of split(value, ',')) {
          const duration = split(item, ' ').find(token => timeValue.test(token));
          if (duration && milliseconds(duration) > 300) report(decl, 'short-duration', 'Keep UI durations at or below 300ms.');
        }
      }
      let properties: string[] = [];
      if (property === 'transition' || property === 'transition-property') {
        properties = transitionProperties(value, property === 'transition');
        if (properties.includes('all')) report(decl, 'explicit-transition', 'Name transition properties explicitly; all (including the implicit default) is prohibited.');
        if (properties.some(name => layoutProperty.test(name))) report(decl, 'compositor-transition', 'Do not transition layout properties; use transform/opacity for movement.');
      }
      if (property === 'transition-duration' && rule && !rule.nodes.some(node => node.type === 'decl' && ['transition', 'transition-property'].includes(node.prop.toLowerCase()))) {
        report(decl, 'explicit-transition', 'This source check requires transition-property or transition shorthand in the same rule; it does not resolve declarations from the cascade.');
      }
      const animationEnabled = (property === 'animation' || property === 'animation-name') && hasAnimationName(value, property === 'animation');
      const isPress = motionProperties.has(property) && !!rule && /:active\b/.test(rule.selector) && value !== 'none';
      if ((properties.some(name => motionProperties.has(name)) || animationEnabled || isPress) && !mediaAllows(decl, 'prefers-reduced-motion', 'no-preference')) {
        report(decl, 'reduced-motion', 'Put movement inside a (prefers-reduced-motion: no-preference) media gate.');
      }
      if (isPress && (!mediaAllows(decl, 'hover', 'hover') || !mediaAllows(decl, 'pointer', 'fine'))) {
        report(decl, 'pointer-press-media', 'Put press transforms inside both (hover: hover) and (pointer: fine) media gates.');
      }
      if (isPress && rule && split(rule.selector, ',').some(selector => /:active\b/.test(selector) && (!/:not\(\s*:focus-visible\s*\)/.test(selector) || !/:not\(\s*:disabled\s*\)/.test(selector)))) {
        report(decl, 'pointer-press', 'Use explicit press selectors with :not(:focus-visible) and :not(:disabled); this source check does not resolve exclusions in nested parent selectors.');
      }
    }
  });
  return issues;
}

function milliseconds(time: string): number { return parseFloat(time) * (time.endsWith('ms') ? 1 : 1000); }

export function auditStyles(directory = process.cwd()): { files: string[]; issues: UiIssue[] } {
  const files: string[] = [];
  function visit(path: string) {
    let entries;
    try { entries = readdirSync(path, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const full = join(path, entry.name);
      if (relative(directory, full).replaceAll('\\', '/') === 'app/api') continue;
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith('.css')) files.push(relative(directory, full).replaceAll('\\', '/'));
    }
  }
  visit(join(directory, 'app'));
  visit(join(directory, 'components'));
  files.sort();
  const sources = new Map(files.map(file => [file, readFileSync(join(directory, file), 'utf8')]));
  let sharedVariables: Variables = {};
  if (sources.has('app/globals.css')) {
    try { sharedVariables = variablesIn(postcss.parse(sources.get('app/globals.css')!)); }
    catch { /* auditCss reports malformed globals with a source location below. */ }
  }
  const issues = files.flatMap(file => auditCss(file, sources.get(file)!, sharedVariables));
  if (!files.length) issues.push({ file: directory, line: 1, column: 1, rule: 'css-scope', message: 'No CSS files found under app/ or components/; the UI guardrail did not run.' });
  return { files, issues };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { files, issues } = auditStyles(process.argv[2] ? resolve(process.argv[2]) : process.cwd());
  for (const issue of issues) console.error(`${issue.file}:${issue.line}:${issue.column} [${issue.rule}] ${issue.message}`);
  if (issues.length) { console.error(`FAIL: ${issues.length} UI guardrail issue(s) across ${files.length} CSS file(s).`); process.exitCode = 1; }
  else console.log(`PASS: UI source guardrails checked ${files.length} CSS file(s). Browser review is still required.`);
}
