import { createHash } from 'node:crypto';
export function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => JSON.stringify(key) + ':' + stableJson(val)).join(',') + '}';
  return JSON.stringify(value);
}
export function hashRecord(value: unknown): string { return sha256(stableJson(value)); }
