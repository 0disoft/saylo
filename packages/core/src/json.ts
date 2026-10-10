import { CatalogError, createPositionLocator } from './diagnostics.js';
import type { CatalogDiagnostic, CatalogOptions } from './types.js';

export interface JsonEntry {
  id: string;
  value: string;
  keyOffset: number;
  valueOffset: number;
  valueLength: number;
}

/** Strict flat JSON. JSON.parse checks syntax; tokens retain decoded duplicate keys. */
export function readJson(source: string, context: Required<CatalogOptions>): JsonEntry[] {
  if (typeof source !== 'string') {
    throw new CatalogError([{ ...context, code: 'INVALID_JSON', message: 'Catalog source must be a JSON string.' }]);
  }
  let object: unknown;
  try {
    object = JSON.parse(source);
  } catch (error) {
    throw new CatalogError([{ ...context, code: 'INVALID_JSON', message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` }]);
  }
  if (object === null || typeof object !== 'object' || Array.isArray(object)) {
    throw new CatalogError([{ ...context, code: 'INVALID_CATALOG', message: 'A catalog must be a flat JSON object of string messages.' }]);
  }
  // Check every value token below, including values overwritten by duplicate keys.
  const entries: JsonEntry[] = [];
  let locate: ReturnType<typeof createPositionLocator> | undefined;
  const positionAt = (offset: number) => (locate ??= createPositionLocator(source))(offset);
  const diagnostics: CatalogDiagnostic[] = [];
  const seen = new Set<string>();
  const strings = /"(?:[^"\\]|\\[\s\S])*"/g;
  const separator = /\s*:\s*/y;
  let key: RegExpExecArray | null;
  while ((key = strings.exec(source)) !== null) {
    const id = JSON.parse(key[0]) as string;
    const afterKey = strings.lastIndex;
    separator.lastIndex = afterKey;
    const valueStart = separator.exec(source);
    const valueOffset = afterKey + (valueStart?.[0].length ?? 0);
    if (!valueStart || source[valueOffset] !== '"') {
      throw new CatalogError([{ ...context, code: 'INVALID_CATALOG', id, position: positionAt(valueOffset), message: 'Every message must be a string; nested objects and other values are unsupported.' }]);
    }
    strings.lastIndex = valueOffset;
    const value = strings.exec(source)!;
    if (seen.has(id)) {
      diagnostics.push({ ...context, code: 'DUPLICATE_ID', id, position: positionAt(key.index), message: `Duplicate message ID ${JSON.stringify(id)}.` });
    }
    seen.add(id);
    // The initial strict parse already decoded these values. Duplicate IDs or
    // overwritten non-string tokens still fail before entries leave this function.
    entries.push({ id, value: (object as Record<string, string>)[id]!, keyOffset: key.index, valueOffset, valueLength: value[0].length });
  }
  if (diagnostics.length) throw new CatalogError(diagnostics);
  return entries;
}

/** Translate an ICU offset in decoded text back to its JSON source string. */
export function messageOffset(entry: JsonEntry, decodedOffset: number, source: string): number {
  let raw = 1;
  for (let decoded = 0; decoded < decodedOffset && raw < entry.valueLength - 1; decoded++) {
    raw += source[entry.valueOffset + raw] === '\\' ? (source[entry.valueOffset + raw + 1] === 'u' ? 6 : 2) : 1;
  }
  return entry.valueOffset + raw;
}
