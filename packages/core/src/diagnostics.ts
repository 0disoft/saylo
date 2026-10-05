import type { CatalogDiagnostic, DeepReadonly, SourcePosition } from './types.js';

// Only objects traversed by this helper are trusted to be deeply frozen.
const frozen = new WeakSet<object>();
export const isDeepFrozen = (value: object) => frozen.has(value);

export function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object') {
    if (frozen.has(value)) return value as DeepReadonly<T>;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
    frozen.add(value);
  }
  return value as DeepReadonly<T>;
}

export class CatalogError extends Error {
  readonly diagnostics: readonly CatalogDiagnostic[];

  constructor(diagnostics: readonly CatalogDiagnostic[]) {
    super(diagnostics.map(d => `${d.sourceName}${d.id === undefined ? '' : ` [${d.id}]`}: ${d.message}`).join('\n'));
    this.name = 'CatalogError';
    this.diagnostics = freeze([...diagnostics]);
  }
}

/** UTF-16 offsets and columns, matching JS strings and the ICU parser. */
export function createPositionLocator(source: string): (offset: number) => SourcePosition {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\n') lineStarts.push(index + 1);
  }
  return offset => {
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (lineStarts[middle]! <= offset) low = middle;
      else high = middle;
    }
    return { offset, line: low + 1, column: offset - lineStarts[low]! + 1 };
  };
}
