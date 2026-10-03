import type { Element } from 'domhandler';
import { limits } from './contracts.ts';

const escapeAttribute = (value: string) => value.replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]!));
const color = (value: string) => /^(?:#[\da-f]{3}|#[\da-f]{6}|[a-z]{3,24})$/i.test(value) && !/^(?:transparent|initial|unset)$/i.test(value);
const length = (value: string, auto = false) => {
  if (value === '0' || (auto && value === 'auto')) return true;
  const match = /^(\d+(?:\.\d+)?)(px|em|rem|%)$/.exec(value);
  return Boolean(match && Number(match[1]) > 0 && Number(match[1]) <= (match[2] === '%' ? 200 : ['em', 'rem'].includes(match[2]) ? 100 : 2400));
};
const lengths = (value: string, count = 4, auto = false) => {
  const values = value.split(/\s+/);
  return values.length <= count && values.every(item => length(item, auto));
};
const border = (value: string) => value === '0' || value === 'none' || /^(\d+(?:\.\d+)?px) (solid|dashed|dotted|double) (#[\da-f]{3}|#[\da-f]{6}|[a-z]{3,24})$/i.test(value) && length(value.split(' ')[0]) && color(value.split(' ')[2]);

/** Only static, local presentation values survive. No CSS escapes, functions, or hidden/positioned content. */
export function safeEmailStyle(source: string | undefined): string {
  if (!source) return '';
  const safe: string[] = [];
  for (const declaration of source.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 1) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim().replace(/\s+/g, ' ');
    if (!value || /[\\<>{}@!()\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || value.includes('/*') || value.includes('*/')) continue;
    let allowed = false;
    if (['color', 'background-color', 'background'].includes(property)) allowed = color(value);
    else if (/^(?:padding|margin)(?:-(?:top|right|bottom|left))?$/.test(property)) allowed = lengths(value, property.includes('-') ? 1 : 4, property.startsWith('margin'));
    else if (['width', 'height', 'max-width', 'min-width', 'min-height'].includes(property)) allowed = length(value, true);
    else if (property === 'font-size') allowed = length(value) && value !== '0';
    else if (property === 'font-family') allowed = /^[a-zA-Z][a-zA-Z ,"'-]{0,160}$/.test(value) || /^['"][a-zA-Z][a-zA-Z ,"'-]{0,158}$/.test(value);
    else if (property === 'font-weight') allowed = /^(normal|bold|[1-9]00)$/.test(value);
    else if (property === 'font-style') allowed = /^(normal|italic|oblique)$/.test(value);
    else if (property === 'line-height') allowed = value === 'normal' || /^(?:[1-3](?:\.\d+)?)$/.test(value) || length(value) && value !== '0';
    else if (property === 'letter-spacing') allowed = value === 'normal' || length(value);
    else if (/^border(?:-(?:top|right|bottom|left))?$/.test(property)) allowed = border(value);
    else if (property === 'border-width' || property === 'border-radius') allowed = lengths(value);
    else if (property === 'border-color') allowed = color(value);
    else if (property === 'border-style') allowed = /^(none|solid|dashed|dotted|double)$/.test(value);
    else if (property === 'border-collapse') allowed = /^(collapse|separate)$/.test(value);
    else if (property === 'border-spacing') allowed = lengths(value, 2);
    else if (property === 'table-layout') allowed = /^(auto|fixed)$/.test(value);
    else if (property === 'text-align') allowed = /^(left|right|center|justify|start|end)$/.test(value);
    else if (property === 'vertical-align') allowed = /^(baseline|top|middle|bottom|text-top|text-bottom)$/.test(value);
    else if (property === 'text-decoration') allowed = /^(none|underline|line-through)$/.test(value);
    else if (property === 'text-transform') allowed = /^(none|uppercase|lowercase|capitalize)$/.test(value);
    else if (property === 'display') allowed = /^(block|inline|inline-block|table|table-row|table-cell)$/.test(value);
    else if (property === 'box-sizing') allowed = /^(border-box|content-box)$/.test(value);
    if (allowed) safe.push(`${property}:${value}`);
  }
  return safe.join(';');
}

/** Attribute names are selected here; source links, handlers, classes, IDs and data attributes never pass through. */
export function safeEmailAttributes(element: Element): string {
  const attributes: string[] = [];
  const style = safeEmailStyle(element.attribs.style);
  if (style) attributes.push(`style="${escapeAttribute(style)}"`);
  if (['table', 'td', 'th', 'img'].includes(element.tagName)) {
    for (const name of ['width', 'height']) {
      const value = element.attribs[name];
      if (value && (/^\d{1,4}$/.test(value) && Number(value) > 0 && Number(value) <= 2400 || /^(?:100|[1-9]?\d)%$/.test(value))) attributes.push(`${name}="${value}"`);
    }
  }
  if (['table', 'tr', 'td', 'th'].includes(element.tagName)) {
    for (const name of ['cellpadding', 'cellspacing', 'colspan', 'rowspan']) {
      const value = element.attribs[name];
      if (value && /^\d{1,2}$/.test(value)) attributes.push(`${name}="${value}"`);
    }
    const align = element.attribs.align;
    if (align && /^(left|center|right)$/.test(align)) attributes.push(`align="${align}"`);
    const valign = element.attribs.valign;
    if (valign && /^(top|middle|bottom|baseline)$/.test(valign)) attributes.push(`valign="${valign}"`);
    const bgcolor = element.attribs.bgcolor;
    if (bgcolor && color(bgcolor)) attributes.push(`bgcolor="${escapeAttribute(bgcolor)}"`);
  }
  return attributes.length ? ` ${attributes.join(' ')}` : '';
}

const maxEmbeddedBytes = 4 * 1024 * 1024;
function rasterDimensions(bytes: Buffer, type: string): [number, number] | null {
  if (type === 'png') {
    if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.toString('ascii', bytes.length - 8, bytes.length - 4) !== 'IEND') return null;
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (type === 'jpeg') {
    if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) return null;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) return null;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) return null;
      const size = bytes.readUInt16BE(offset);
      if (size < 2 || offset + size > bytes.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return size >= 8 ? [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)] : null;
      offset += size;
    }
  }
  if (type === 'webp') {
    if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) return null;
    const format = bytes.toString('ascii', 12, 16);
    if (format === 'VP8X') return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
    if (format === 'VP8 ' && bytes.subarray(23, 26).equals(Buffer.from([157, 1, 42]))) return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
    if (format === 'VP8L' && bytes[20] === 0x2f) return [(bytes.readUInt32LE(21) & 0x3fff) + 1, ((bytes.readUInt32LE(21) >>> 14) & 0x3fff) + 1];
  }
  return null;
}

/** Raster data URLs only, with canonical encoding, matching file header and bounded decoded dimensions. */
export function safeEmbeddedRaster(source: string | undefined): string | null {
  if (!source || source.length > maxEmbeddedBytes * 4 / 3 + 100) return null;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z\d+/]+={0,2})$/.exec(source);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > maxEmbeddedBytes || bytes.toString('base64') !== match[2]) return null;
  const dimensions = rasterDimensions(bytes, match[1]);
  if (!dimensions || dimensions.some(size => size < 1 || size > 10000) || dimensions[0] * dimensions[1] > limits.pixels) return null;
  return source;
}

export function safeEmailImage(element: Element): string {
  const source = safeEmbeddedRaster(element.attribs.src);
  if (!source) return '<span class="omitted">[External or unsupported image omitted from safe email preview]</span>';
  return `<img src="${source}" alt="${escapeAttribute((element.attribs.alt || '').slice(0, 1000))}"${safeEmailAttributes(element)}>`;
}
