import { readJson } from './json.js';
import type { JsonEntry } from './json.js';
import type { CatalogOptions, ParsedCatalog } from './types.js';

// Only successful parses create this provenance. Transported or caller-owned
// catalogs take the full strict path, even if their objects are frozen.
interface JsonSpans { source: string; ids: string[]; offsets: Uint32Array }
const accepted = new WeakMap<ParsedCatalog, JsonSpans>();

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
  const keys = Reflect.ownKeys(context);
  return Reflect.ownKeys(previous!).length === keys.length + 1 &&
    keys.every(key => key !== 'messages' && Reflect.get(previous!, key) === Reflect.get(context, key));
}

export function rememberCatalogJson(catalog: ParsedCatalog, source: string, entries: JsonEntry[]): void {
  if (source.length > 0xffffffff) return; // Never truncate an offset on a future engine with larger strings.
  const ids = new Array<string>(entries.length);
  const offsets = new Uint32Array(entries.length * 3);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    ids[i] = entry.id;
    offsets[i * 3] = entry.keyOffset;
    offsets[i * 3 + 1] = entry.valueOffset;
    offsets[i * 3 + 2] = entry.valueLength;
  }
  // Do not retain regex token slices, decoded value dictionaries or one
  // JS record per token alongside the catalog's existing message records.
  accepted.set(catalog, { source, ids, offsets });
}

export function readCatalogJson(source: string, context: Required<CatalogOptions>, previous?: ParsedCatalog): JsonEntry[] {
  const before = prior(previous, context);
  const edited = typeof source === 'string' && before ? editValue(before, source, previous!) : undefined;
  return edited ?? readJson(source, context);
}

function editValue(spans: JsonSpans, source: string, previous: ParsedCatalog): JsonEntry[] | undefined {
  const before = spans.source;
  let start = 0;
  const commonLength = Math.min(before.length, source.length);
  while (start < commonLength && before.charCodeAt(start) === source.charCodeAt(start)) start++;
  let end = before.length, nextEnd = source.length;
  while (end > start && nextEnd > start && before.charCodeAt(end - 1) === source.charCodeAt(nextEnd - 1)) { end--; nextEnd--; }
  // Token offsets are ordered by physical source position, including numeric IDs.
  let low = 0, high = spans.ids.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (spans.offsets[middle * 3 + 1]! < start) low = middle + 1;
    else high = middle;
  }
  const index = low - 1;
  const valueOffset = spans.offsets[index * 3 + 1];
  const valueLength = spans.offsets[index * 3 + 2];
  if (valueOffset === undefined || valueLength === undefined || start < valueOffset + 1 || end > valueOffset + valueLength - 1) return;
  const shift = source.length - before.length;
  const rawValue = source.slice(valueOffset, valueOffset + valueLength + shift);
  let value: unknown;
  try { value = JSON.parse(rawValue); } catch { return; }
  // Parsing the entire replacement token excludes quote/escape edits that
  // turn a string value into JSON structure. Those edits use the full parser.
  if (typeof value !== 'string') return;
  const next = new Array<JsonEntry>(spans.ids.length);
  for (let i = 0; i < next.length; i++) {
    const id = spans.ids[i]!;
    const delta = i > index ? shift : 0;
    next[i] = { id, value: i === index ? value : previous.messages[id]!.source,
      keyOffset: spans.offsets[i * 3]! + delta, valueOffset: spans.offsets[i * 3 + 1]! + delta,
      valueLength: i === index ? rawValue.length : spans.offsets[i * 3 + 2]! };
  }
  return next;
}
