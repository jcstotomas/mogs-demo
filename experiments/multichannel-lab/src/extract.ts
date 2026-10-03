import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as cheerio from 'cheerio';
import type { AnyNode, Element, Text } from 'domhandler';
import { limits, type Context, type Extraction, type Unit } from './contracts.ts';
import { safeEmailAttributes, safeEmailImage } from './email-preview.ts';

export const EXTRACTOR_VERSION = 'cheerio-pdfplumber-poppler-tesseract-v4';
const run = promisify(execFile);
const bundledPython = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
const PYTHON = process.env.MOGS_LAB_PYTHON || (existsSync(bundledPython) ? bundledPython : 'python3');
const blockTags = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'td', 'th', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'body']);
const omittedTags = new Set(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'canvas', 'video', 'audio', 'head']);
const safeTags = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'p', 'span', 'b', 'strong', 'em', 'i', 'u', 's', 'del', 'small', 'sup', 'sub', 'br', 'hr', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code']);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]!));
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
const isElement = (node: AnyNode): node is Element => 'tagName' in node;

function domPath(node: AnyNode): string {
  if (!isElement(node)) return domPath(node.parent!);
  const siblings = node.parent && 'children' in node.parent ? node.parent.children.filter(sibling => isElement(sibling) && sibling.tagName === node.tagName) : [node];
  const part = `${node.tagName}:nth-of-type(${siblings.indexOf(node) + 1})`;
  return node.parent && isElement(node.parent) ? `${domPath(node.parent)} > ${part}` : part;
}

async function extractEmail(bytes: Buffer, context: Context, outputDir: string): Promise<Extraction> {
  let html: string;
  try { html = new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { throw new Error('Email must be valid UTF-8 HTML'); }
  if (!/<[a-z][\s\S]*>/i.test(html) || html.includes('\u0000')) throw new Error('Invalid HTML email input');
  const $ = cheerio.load(html);
  const units: Unit[] = [];
  const warnings: string[] = [];
  const nodeUnits = new Map<AnyNode, string>();
  type TextGroup = {element: Element; nodes: Text[]; parts: string[]; occurrence: number};
  const groups: TextGroup[] = [];
  const occurrences = new Map<Element, number>();
  let activeGroup: TextGroup | undefined;
  const conditional = /{%\s*(?:if|unless|case|for|capture|include|render|layout|extends|block)\b|{{[#^/]|<%|\[if\s/i.test([html, context.subject, context.preheader, context.plainText].join('\n'));
  if (conditional) warnings.push('Unresolved template/conditional branches: all email corrections are withheld until rendered variants are provided.');
  const unsupportedCount = $('img,svg,canvas,iframe,object,embed,video,audio').length;
  if (unsupportedCount) warnings.push(`${unsupportedCount} visual or embedded region(s) have no reliable text extraction.`);
  if (/content\s*:/i.test($('style').text())) warnings.push('CSS-generated content is excluded from extraction coverage.');
  if ($('template').length) warnings.push('HTML template content is inert and excluded from rendered text coverage.');
  if ($('input,textarea,select,button').length) warnings.push('Interactive controls are excluded from email preview/extraction coverage.');
  function add(unit: Unit) {
    if (units.length >= limits.units) throw new Error('Content unit limit exceeded');
    units.push(unit);
  }
  function metadata(field: 'subject' | 'preheader' | 'plainText', text: string) {
    if (!text.trim()) return;
    const chunks = field === 'plainText' ? text.split(/\n\s*\n/).filter(part => part.trim()) : [text];
    chunks.forEach((chunk, index) => add({id: `email-${field}-${index + 1}`, text: chunk, role: field === 'plainText' ? 'plain_text' : field, locator: {kind: 'html', field, path: `metadata.${field}${field === 'plainText' ? `[${index}]` : ''}`}, context: chunk, confidence: null, uncertain: conditional || /{%|{{[#^/]/.test(chunk)}));
  }
  metadata('subject', context.subject || $('head > title').text());
  metadata('preheader', context.preheader);
  metadata('plainText', context.plainText);
  function visit(node: AnyNode, current: Element | null): void {
    if (isElement(node)) {
      if (omittedTags.has(node.tagName) || ['template', 'input', 'textarea', 'select', 'button'].includes(node.tagName)) return;
      if (node.tagName === 'br') { activeGroup?.parts.push('\n'); return; }
      const isBlock = blockTags.has(node.tagName);
      const block = isBlock ? node : current;
      if (isBlock) activeGroup = undefined;
      for (const child of node.children) visit(child, block);
      if (isBlock) activeGroup = undefined;
    } else if (node.type === 'text' && current) {
      if (!activeGroup || activeGroup.element !== current) {
        if (!node.data.trim()) return;
        const occurrence = (occurrences.get(current) ?? 0) + 1;
        occurrences.set(current, occurrence);
        activeGroup = {element: current, nodes: [], parts: [], occurrence};
        groups.push(activeGroup);
      }
      activeGroup.nodes.push(node);
      activeGroup.parts.push(node.data);
    }
  }
  const body = $('body').get(0)!;
  visit(body, body);
  for (const {element, nodes, parts, occurrence} of groups) {
    const text = normalize(parts.join(''));
    if (!text) continue;
    const id = `email-block-${units.length + 1}`;
    nodes.forEach(node => nodeUnits.set(node, id));
    // Parent scope preserves a containing card/section without mixing sibling sections.
    // At body/table level retain this block alone; shared headings are not eligibility.
    const parent = element.parent;
    const parentContext = parent && isElement(parent) && !['body', 'html', 'table', 'tbody', 'tr'].includes(parent.tagName) ? groups.filter(group => {
      let ancestor: AnyNode | null = group.element;
      while (ancestor) { if (ancestor === parent) return true; ancestor = ancestor.parent; }
      return false;
    }).map(group => normalize(group.parts.join(''))).filter(Boolean).join('\n') : text;
    const localContext = parentContext || text;
    const role = /^h[1-6]$/.test(element.tagName) ? 'heading' : element.tagName === 'li' ? 'list_item' : 'body';
    add({id, text, role, locator: {kind: 'html', path: `${domPath(element)}::text-run(${occurrence})`}, context: localContext, confidence: null, uncertain: conditional});
  }
  if (!units.length) warnings.push('No reliable text extracted; this email has partial coverage.');
  function render(node: AnyNode): string {
    if (node.type === 'text') {
      const text = escapeHtml(node.data);
      const id = nodeUnits.get(node);
      return id ? `<span data-unit-id="${id}">${text}</span>` : text;
    }
    if (!isElement(node)) return '';
    if (omittedTags.has(node.tagName) || ['template', 'input', 'textarea', 'select', 'button'].includes(node.tagName)) return '';
    if (node.tagName === 'img') return safeEmailImage(node);
    const tag = safeTags.has(node.tagName) ? node.tagName : 'span';
    const attributes = safeEmailAttributes(node);
    if (tag === 'br' || tag === 'hr') return `<${tag}${attributes}>`;
    return `<${tag}${attributes}>${node.children.map(render).join('')}</${tag}>`;
  }
  const metadataHtml = units.filter(unit => unit.locator.kind === 'html' && unit.locator.field).map(unit => `<section class="metadata"><strong>${escapeHtml(unit.role)}</strong><p data-unit-id="${unit.id}">${escapeHtml(unit.text)}</p></section>`).join('');
  const preview = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Inert email preview</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#243332;background:#fff;margin:0;overflow-wrap:break-word}.email-content{padding:24px}table{border-collapse:collapse;max-width:100%}td,th{text-align:left}img{max-width:100%;height:auto}p{white-space:pre-wrap}.email-metadata{padding:24px;border-top:1px solid #ded9c9;background:#f4f4ed}.email-metadata h2{font-size:16px;margin:0 0 16px}.metadata{margin:0 0 16px}.metadata:last-child{margin-bottom:0}.metadata strong{font-size:12px;text-transform:uppercase}.metadata p{margin:4px 0 0}.omitted{display:block;color:#766a50;padding:12px;border:1px solid #ded9c9}[data-unit-id]{scroll-margin:20px}[data-unit-id]:target{background:#fce9a9}</style></head><body><div class="email-content"${safeEmailAttributes(body)}>${body.children.map(render).join('')}</div>${metadataHtml ? `<section class="email-metadata" aria-label="Email metadata"><h2>Email metadata</h2>${metadataHtml}</section>` : ''}</body></html>`;
  const previewFile = path.join(outputDir, 'page-1.html');
  await writeFile(previewFile, preview, 'utf8');
  return {surface: 'email', extractor: 'cheerio-inert-html-v4', units, previews: [{page: 1, file: previewFile, mime: 'text/html', width: 800, height: 0}], status: warnings.length ? 'partial' : 'complete', warnings, pages: 1};
}

export async function extractAsset(input: {file: string; filename: string; mime: string; context: Context; outputDir: string}): Promise<Extraction> {
  const info = await stat(input.file);
  if (!info.isFile() || !info.size || info.size > limits.fileBytes) throw new Error('Asset is empty or exceeds file size limit');
  const bytes = await readFile(input.file);
  const pdf = bytes.subarray(0, 5).toString() === '%PDF-';
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const expected = pdf ? 'application/pdf' : png ? 'image/png' : jpeg ? 'image/jpeg' : 'text/html';
  if (input.mime !== expected) throw new Error(`Media type does not match file bytes (${input.mime})`);
  await mkdir(input.outputDir, {recursive: true});
  if (input.mime === 'text/html') return extractEmail(bytes, input.context, input.outputDir);
  const surface = pdf ? 'deck' : 'creative';
  try {
    const {stdout} = await run(PYTHON, [fileURLToPath(new URL('./extract-python.py', import.meta.url)), input.file, surface, input.outputDir, JSON.stringify(limits)], {timeout: limits.timeoutMs, maxBuffer: 12 * 1024 * 1024, env: {...process.env, PYTHONIOENCODING: 'utf-8'}});
    const result = JSON.parse(stdout) as Extraction;
    if (result.surface !== surface || !Array.isArray(result.units) || !Array.isArray(result.previews) || result.units.length > limits.units) throw new Error('Invalid extractor response');
    return result;
  } catch (error) {
    const detail = error as Error & {stderr?: string; killed?: boolean};
    throw new Error(detail.killed ? 'Extraction timed out' : `Extraction failed: ${(detail.stderr || detail.message).trim().slice(0, 1000)}`);
  }
}
