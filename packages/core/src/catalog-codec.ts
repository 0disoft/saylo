import { freeze, immutableSnapshot, isDeepFrozen } from './diagnostics.js';
import type { MessageSchema, ParsedCatalog, ParsedMessage, SourcePosition } from './types.js';

type Node = ParsedMessage['ast'][number];
type Point = readonly [number, number, number];
type SimpleNode = readonly [0 | 1, string] | readonly [0 | 1, string, ...Point, ...Point];
type WireMessage = readonly [id: string, source: string, ...position: Point, ast: readonly (Node | SimpleNode)[], schema: number, tags?: readonly string[]];
/** Lossless parser-free catalog wire data; source remains the formatter cache identity. */
export interface CompactCatalog {
  readonly format: 'saylo-catalog-v1';
  readonly locale: string;
  readonly namespace: string;
  readonly sourceName: string;
  readonly schemas: readonly MessageSchema[];
  readonly messages: readonly WireMessage[];
}
const cache = new WeakMap<ParsedCatalog, CompactCatalog>();
const point = (position: SourcePosition): Point => [position.offset, position.line, position.column];
const invalid = () => new TypeError('Invalid Saylo compact catalog.');

export function encodeCatalog(input: ParsedCatalog): CompactCatalog {
  const previous = isDeepFrozen(input) ? cache.get(input) : undefined;
  if (previous) return previous;
  const catalog = immutableSnapshot(input), schemas: MessageSchema[] = [], indices = new Map<string, number>();
  const messages: WireMessage[] = [];
  for (const [id, message] of Object.entries(catalog.messages)) {
    const signature = JSON.stringify(message.arguments);
    let index = indices.get(signature);
    if (index === undefined) { index = schemas.length; schemas.push(message.arguments); indices.set(signature, index); }
    const ast = message.ast.map((node): Node | SimpleNode => node.type === 0 || node.type === 1
      ? node.location ? [node.type, node.value, ...point(node.location.start), ...point(node.location.end)] : [node.type, node.value] : node);
    messages.push(message.richTextTags === undefined ? [id, message.source, ...point(message.position), ast, index]
      : [id, message.source, ...point(message.position), ast, index, message.richTextTags]);
  }
  const packed: CompactCatalog = freeze({ format: 'saylo-catalog-v1', locale: catalog.locale, namespace: catalog.namespace,
    sourceName: catalog.sourceName, schemas, messages });
  if (isDeepFrozen(input)) cache.set(input, packed);
  return packed;
}

function readPoint(values: readonly unknown[], index: number): SourcePosition {
  const [offset, line, column] = values.slice(index, index + 3);
  if (!Number.isSafeInteger(offset) || (offset as number) < 0 || !Number.isSafeInteger(line) || (line as number) < 1
      || !Number.isSafeInteger(column) || (column as number) < 1) throw invalid();
  return { offset: offset as number, line: line as number, column: column as number };
}
function readNode(node: Node | SimpleNode): Node {
  if (!Array.isArray(node)) {
    if (!node || typeof node !== 'object' || !Number.isInteger((node as Node).type) || (node as Node).type < 2 || (node as Node).type > 8) throw invalid();
    return node as Node;
  }
  if ((node.length !== 2 && node.length !== 8) || (node[0] !== 0 && node[0] !== 1) || typeof node[1] !== 'string') throw invalid();
  const value = { type: node[0], value: node[1] };
  if (node.length === 2) return value;
  const start = readPoint(node, 2), end = readPoint(node, 5);
  if (end.offset < start.offset || end.line < start.line || (end.line === start.line && end.column < start.column)) throw invalid();
  return { ...value, location: { start, end } };
}

/** Restore ordinary immutable catalogs, without evaluating or parsing ICU source. */
export function decodeCatalog(value: CompactCatalog): ParsedCatalog {
  const input = immutableSnapshot(value);
  if (!input || input.format !== 'saylo-catalog-v1' || typeof input.locale !== 'string' || !input.locale
      || typeof input.namespace !== 'string' || !input.namespace || /[:/\\\x00-\x1f]/.test(input.namespace)
      || input.namespace === '.' || input.namespace === '..' || typeof input.sourceName !== 'string'
      || !Array.isArray(input.schemas) || !Array.isArray(input.messages)) throw invalid();
  if (Intl.getCanonicalLocales(input.locale)[0] !== input.locale) throw invalid();
  for (const schema of input.schemas) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw invalid();
    for (const argument of Object.values(schema as MessageSchema)) {
      if (!argument || argument.required !== true || !Array.isArray(argument.acceptedTypes) || !argument.acceptedTypes.length
          || !argument.acceptedTypes.every(type => type === 'string' || type === 'number' || type === 'date')
          || new Set(argument.acceptedTypes).size !== argument.acceptedTypes.length) throw invalid();
    }
  }
  const messages: Record<string, ParsedMessage> = Object.create(null);
  for (const message of input.messages) {
    if (!Array.isArray(message) || (message.length !== 7 && message.length !== 8)) throw invalid();
    const [id, source, , , , ast, schema, tags] = message;
    if (typeof id !== 'string' || !id || id.includes(':') || Object.hasOwn(messages, id) || typeof source !== 'string'
        || !Array.isArray(ast) || !Number.isSafeInteger(schema) || schema < 0 || schema >= input.schemas.length) throw invalid();
    if (tags !== undefined && (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(tag))
        || new Set(tags).size !== tags.length)) throw invalid();
    messages[id] = { source, position: readPoint(message, 2), ast: ast.map(readNode), arguments: input.schemas[schema]!,
      ...(tags === undefined ? {} : { richTextTags: tags }) };
  }
  return freeze({ locale: input.locale, namespace: input.namespace, sourceName: input.sourceName, messages });
}
