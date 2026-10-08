import { TYPE } from '@formatjs/icu-messageformat-parser/no-parser.js';
import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser';
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

// Callers follow children before sealing; share the helper across fresh ASTs.
function seal<T extends object>(value: T): DeepReadonly<T> {
  Object.freeze(value);
  frozen.add(value);
  return value as DeepReadonly<T>;
}

/** Only for fresh ASTs owned by the catalog parser, with FormatJS node shapes. */
export function freezeMessageAst(ast: MessageFormatElement[]): DeepReadonly<MessageFormatElement[]> {
  // Each call below follows its children; numeric/string leaves need no walk.
  for (const element of ast) {
    if (element.type === TYPE.literal || element.type === TYPE.argument) {
      if (element.location && !frozen.has(element.location)) {
        seal(element.location.start);
        seal(element.location.end);
        seal(element.location);
      }
      seal(element);
    } else freeze(element); // Includes nested branches, tags and skeletons.
  }
  return seal(ast);
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
  for (let index = source.indexOf('\n'); index !== -1; index = source.indexOf('\n', index + 1)) {
    lineStarts.push(index + 1);
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
