import { readJson } from './json.js';
import type { JsonEntry } from './json.js';
import type { CatalogOptions, ParsedCatalog } from './types.js';

// Only successful parses create this provenance. Transported or caller-owned
// catalogs take the full strict path, even if their objects are frozen.
const accepted = new WeakMap<ParsedCatalog, { source: string; entries: JsonEntry[] }>();

function prior(previous: ParsedCatalog | undefined, context: Required<CatalogOptions>) {
  const cached = previous ? accepted.get(previous) : undefined;
  return cached && previous!.locale === context.locale && previous!.namespace === context.namespace &&
    previous!.sourceName === context.sourceName ? cached : undefined;
}

export function hasSameCatalogSource(source: string, context: Required<CatalogOptions>, previous?: ParsedCatalog): boolean {
  const cached = prior(previous, context);
  if (!cached || cached.source !== source) return false;
  // Preserve context extensions passed by JS callers; never reuse an old
  // complete result when the context spread would change its public fields.
  const keys = Object.keys(context);
  return Object.keys(previous!).length === keys.length + 1 &&
    keys.every(key => key !== 'messages' && Reflect.get(previous!, key) === Reflect.get(context, key));
}

export function rememberCatalogJson(catalog: ParsedCatalog, source: string, entries: JsonEntry[]): void {
  accepted.set(catalog, { source, entries });
}

export function readCatalogJson(source: string, context: Required<CatalogOptions>, previous?: ParsedCatalog): JsonEntry[] {
  const before = prior(previous, context);
  const edited = typeof source === 'string' && before ? editValue(before.source, source, before.entries) : undefined;
  return edited ?? readJson(source, context);
}

function editValue(before: string, source: string, entries: JsonEntry[]): JsonEntry[] | undefined {
  let start = 0;
  const commonLength = Math.min(before.length, source.length);
  while (start < commonLength && before.charCodeAt(start) === source.charCodeAt(start)) start++;
  if (start === before.length && start === source.length) return entries;
  let end = before.length, nextEnd = source.length;
  while (end > start && nextEnd > start && before.charCodeAt(end - 1) === source.charCodeAt(nextEnd - 1)) { end--; nextEnd--; }
  // Token offsets are ordered by physical source position, including numeric IDs.
  let low = 0, high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (entries[middle]!.valueOffset < start) low = middle + 1;
    else high = middle;
  }
  const index = low - 1;
  const entry = entries[index];
  if (!entry || start < entry.valueOffset + 1 || end > entry.valueOffset + entry.rawValue.length - 1) return;
  const shift = source.length - before.length;
  const rawValue = source.slice(entry.valueOffset, entry.valueOffset + entry.rawValue.length + shift);
  let value: unknown;
  try { value = JSON.parse(rawValue); } catch { return; }
  // Parsing the entire replacement token excludes quote/escape edits that
  // turn a string value into JSON structure. Those edits use the full parser.
  if (typeof value !== 'string') return;
  const next = entries.slice();
  next[index] = { ...entry, value, rawValue };
  if (shift !== 0) for (let i = index + 1; i < next.length; i++) {
    const item = next[i]!;
    next[i] = { ...item, keyOffset: item.keyOffset + shift, valueOffset: item.valueOffset + shift };
  }
  return next;
}
