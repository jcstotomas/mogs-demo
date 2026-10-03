import path from 'node:path';
import { parseDocument } from 'yaml';
import { load } from 'cheerio';
import { AssetMetadataSchema, PageSchema, PassageSchema, RoleSchema, type AssetMetadata, type Page, type Passage, type Role, type Surface } from '../types';
import { hashRecord, sha256 } from '../hash';

export const SOURCE_FORMAT_VERSION = 'plain-block-v1';
export interface SourceBlock { sourceId: string; role: Role; text: string; textStart: number; textEnd: number }
export interface SourceAsset { assetId: string; file: string; surface: Surface; source: string; sourceHash: string; meta: AssetMetadata; blocks: SourceBlock[] }
export function assetIdFor(surface: Surface, relativeFile: string): string {
  if (relativeFile.includes('\\') || path.posix.normalize(relativeFile) !== relativeFile || relativeFile.startsWith('/') || relativeFile.split('/').includes('..') || !relativeFile.endsWith('.md')) throw new Error('Asset path must be a normalized content-relative POSIX Markdown path.');
  const prefix = surface === 'web' ? 'site/' : 'email/';
  if (!relativeFile.startsWith(prefix)) throw new Error('Asset path does not match surface.');
  return surface + ':' + relativeFile;
}
export function passageIdFor(assetId: string, sourceId: string): string { return assetId + '#' + sourceId; }
export function decodeSource(bytes: Uint8Array): string { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
export function parseSource(source: string, file: string, surface: Surface): SourceAsset {
  if (source.includes('\r') || source.includes('\0')) throw new Error('Source requires UTF-8 text with LF endings and no NUL.');
  const header = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!header) throw new Error('Missing YAML frontmatter.');
  const yaml = parseDocument(header[1], { uniqueKeys: true });
  if (yaml.errors.length) throw new Error('Invalid or duplicate frontmatter keys.');
  const meta = AssetMetadataSchema.parse(yaml.toJSON());
  if (surface === 'email' && !meta.journey) throw new Error('Email metadata requires journey.');
  const body = source.slice(header[0].length);
  const expression = /<!-- source-id: ([a-z][a-z0-9-]*) role: ([a-z_]+) -->\n([^\n]+)\n<!-- \/source-id: \1 -->/g;
  const blocks: SourceBlock[] = [], ids = new Set<string>();
  let consumed = 0, match: RegExpExecArray | null;
  while ((match = expression.exec(body))) {
    if (body.slice(consumed, match.index).trim()) throw new Error('Text outside declared source blocks or malformed markers.');
    const sourceId = match[1], role = RoleSchema.parse(match[2]), text = match[3];
    if (ids.has(sourceId)) throw new Error('Duplicate sourceId: ' + sourceId);
    if (!text.trim() || text.includes('<!--')) throw new Error('Block requires plain single-line text.');
    ids.add(sourceId);
    const textStart = header[0].length + match.index + match[0].indexOf('\n') + 1;
    blocks.push({ sourceId, role, text, textStart, textEnd: textStart + text.length });
    consumed = expression.lastIndex;
  }
  if (body.slice(consumed).trim() || blocks.length === 0) throw new Error('Malformed source blocks or text outside blocks.');
  return { assetId: assetIdFor(surface, file), file, surface, source, sourceHash: sha256(source), meta, blocks };
}
export function escapeHtml(text: string): string { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
export function renderSource(asset: SourceAsset): string {
  const metadata = { assetId: asset.assetId, file: asset.file, surface: asset.surface, editable: true, sourceHash: asset.sourceHash, metadataHash: hashRecord(asset.meta), meta: asset.meta };
  const json = JSON.stringify(metadata).replace(/</g, '\\u003c');
  const blocks = asset.blocks.map(block => {
    const tag = block.role === 'heading' ? 'h2' : block.role === 'list_item' ? 'li' : 'p';
    const element = '<' + tag + ' data-source-id="' + block.sourceId + '" data-role="' + block.role + '">' + escapeHtml(block.text) + '</' + tag + '>';
    return tag === 'li' ? '<ul>' + element + '</ul>' : element;
  }).join('\n');
  return '<!doctype html><html><body><main>' + blocks + '</main><script type="application/json" id="asset-meta">' + json + '</script></body></html>';
}
export function contextHashFor(meta: AssetMetadata, role: Role, heading: string, before: string, after: string): string { return hashRecord({ meta, role, heading, before, after }); }
export function extractRenderedAsset(html: string, url: string, crawledAt = new Date().toISOString()): { page: Page; passages: Passage[] } {
  const $ = load(html), scripts = $('#asset-meta');
  if (scripts.length !== 1) throw new Error('Rendered asset needs exactly one metadata script.');
  const raw = JSON.parse(scripts.text());
  const page = PageSchema.parse({ ...raw, url, crawledAt });
  if (page.metadataHash !== hashRecord(page.meta)) throw new Error('Metadata hash mismatch.');
  const elements = $('main [data-source-id]').toArray();
  const ids = new Set<string>();
  let heading = '';
  const passages = elements.map((element, idx) => {
    const node = $(element), sourceId = node.attr('data-source-id') ?? '', role = RoleSchema.parse(node.attr('data-role'));
    if (!/^[a-z][a-z0-9-]*$/.test(sourceId) || ids.has(sourceId) || node.find('[data-source-id]').length) throw new Error('Invalid, duplicate, or nested rendered sourceId.');
    ids.add(sourceId);
    const text = node.text();
    if (role === 'heading') heading = text;
    const before = idx > 0 ? $(elements[idx - 1]).text() : '';
    const after = idx + 1 < elements.length ? $(elements[idx + 1]).text() : '';
    return PassageSchema.parse({ id: passageIdFor(page.assetId, sourceId), assetId: page.assetId, sourceId, url, surface: page.surface, editable: page.editable, role, idx, text, blockHash: sha256(text), contextHash: contextHashFor(page.meta, role, heading, before, after), heading, before, after });
  });
  if (!passages.length) throw new Error('Rendered asset contains no source blocks.');
  return { page, passages };
}
export interface BlockReplacement { sourceId: string; original: string; replacement: string }
export function replaceSourceBlocks(asset: SourceAsset, replacements: BlockReplacement[], expectedFileHash: string): string {
  if (asset.sourceHash !== expectedFileHash) throw new Error('Source freshness conflict.');
  const used = new Set<string>();
  const edits = replacements.map(edit => {
    if (used.has(edit.sourceId)) throw new Error('Duplicate replacement sourceId.');
    used.add(edit.sourceId);
    const block = asset.blocks.find(item => item.sourceId === edit.sourceId);
    if (!block || block.text !== edit.original) throw new Error('Source block missing or original changed.');
    if (!edit.replacement.trim() || /[\r\n\0]/.test(edit.replacement) || edit.replacement.includes('<!--')) throw new Error('Replacement must preserve the source grammar.');
    return { ...edit, block };
  }).sort((a, b) => b.block.textStart - a.block.textStart);
  let result = asset.source;
  for (const edit of edits) result = result.slice(0, edit.block.textStart) + edit.replacement + result.slice(edit.block.textEnd);
  parseSource(result, asset.file, asset.surface);
  return result;
}
