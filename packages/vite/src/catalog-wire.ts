import type { CatalogLoadResult, MessageSchema, ParsedCatalog, ParsedMessage, SourcePosition } from '@0disoft/saylo-core';
import type { CatalogPatch, PresentCatalog } from './catalog-patch.js';

type Node = ParsedMessage['ast'][number];
type Point = readonly [offset: number, line: number, column: number];
type SimpleNode = readonly [type: 0 | 1, value: string] | readonly [type: 0 | 1, value: string, ...start: Point, ...end: Point];
type WireMessage = readonly [id: string, source: string, ...position: Point, ast: readonly (Node | SimpleNode)[], schema: number, richTextTags?: readonly string[]];
interface CompactCatalog {
  readonly sourceName: string;
  readonly schemas: readonly MessageSchema[];
  readonly messages: readonly WireMessage[];
}
/** Internal dev socket encoding; core and SSR still receive ordinary outcomes. */
export interface CompactCatalogOutcome extends Omit<PresentCatalog, 'status' | 'catalog'> {
  readonly status: 'compact';
  readonly encoding: 'saylo-catalog-v1';
  readonly catalog: CompactCatalog;
}
export type CatalogWireResult = CatalogLoadResult | CatalogPatch | CompactCatalogOutcome;

// Catalogs are immutable; a new pair version gets a different key and old keys
// can be collected. Cache payloads, never request identities or session stamps.
const cache = new WeakMap<ParsedCatalog, CompactCatalog>();
const point = (p: SourcePosition): Point => [p.offset, p.line, p.column];

export function encodeCatalogResult(result: CatalogLoadResult | CatalogPatch): CatalogWireResult {
  if (result.status !== 'present') return result;
  let catalog = cache.get(result.catalog);
  if (!catalog) {
    const schemas: MessageSchema[] = [];
    const indices = new Map<string, number>();
    const messages: WireMessage[] = [];
    for (const [id, message] of Object.entries(result.catalog.messages)) {
      const signature = JSON.stringify(message.arguments);
      let index = indices.get(signature);
      if (index === undefined) { index = schemas.length; schemas.push(message.arguments); indices.set(signature, index); }
      const ast = message.ast.map((node): Node | SimpleNode => {
        if (node.type !== 0 && node.type !== 1) return node;
        return node.location ? [node.type, node.value, ...point(node.location.start), ...point(node.location.end)] : [node.type, node.value];
      });
      messages.push(message.richTextTags === undefined ? [id, message.source, ...point(message.position), ast, index]
        : [id, message.source, ...point(message.position), ast, index, message.richTextTags]);
    }
    catalog = { sourceName: result.catalog.sourceName, schemas, messages };
    cache.set(result.catalog, catalog);
  }
  return { status: 'compact', encoding: 'saylo-catalog-v1', sessionId: result.sessionId, key: result.key,
    catalogVersion: result.catalogVersion, namespaceSchemaFingerprint: result.namespaceSchemaFingerprint, catalog };
}

const invalid = () => new Error('Invalid compact catalog reply.');
function readPoint(values: readonly unknown[], offset: number): SourcePosition {
  const position = values[offset], line = values[offset + 1], column = values[offset + 2];
  if (!Number.isSafeInteger(position) || (position as number) < 0 ||
      !Number.isSafeInteger(line) || (line as number) < 1 || !Number.isSafeInteger(column) || (column as number) < 1) throw invalid();
  return { offset: position as number, line: line as number, column: column as number };
}
function decodeNode(value: Node | SimpleNode): Node {
  if (!Array.isArray(value)) {
    // Complex ICU nodes retain the existing AST wire shape, including nested
    // options, skeletons and their diagnostic locations. No client ICU parsing.
    if (!value || typeof value !== 'object' || !Number.isInteger((value as Node).type) ||
        (value as Node).type < 2 || (value as Node).type > 8) throw invalid();
    return value as Node;
  }
  if ((value.length !== 2 && value.length !== 8) || (value[0] !== 0 && value[0] !== 1) || typeof value[1] !== 'string') throw invalid();
  const node = { type: value[0], value: value[1] };
  if (value.length === 2) return node;
  const start = readPoint(value, 2), end = readPoint(value, 5);
  if (end.offset < start.offset || end.line < start.line || (end.line === start.line && end.column < start.column)) throw invalid();
  return { ...node, location: { start, end } };
}

export function decodeCatalogResult(result: CatalogWireResult): CatalogLoadResult | CatalogPatch {
  if (result?.status !== 'compact') return result;
  const { catalog } = result;
  if (result.encoding !== 'saylo-catalog-v1' || !result.key || typeof result.key.locale !== 'string' ||
      typeof result.key.namespace !== 'string' || typeof result.sessionId !== 'string' || !result.sessionId ||
      !Number.isSafeInteger(result.catalogVersion) || result.catalogVersion < 1 ||
      typeof result.namespaceSchemaFingerprint !== 'string' || !result.namespaceSchemaFingerprint ||
      !catalog || typeof catalog.sourceName !== 'string' || !Array.isArray(catalog.messages) || !Array.isArray(catalog.schemas)) throw invalid();
  for (const schema of catalog.schemas) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw invalid();
    for (const argument of Object.values(schema as MessageSchema)) {
      if (!argument || argument.required !== true || !Array.isArray(argument.acceptedTypes) || !argument.acceptedTypes.length ||
          !argument.acceptedTypes.every(type => type === 'string' || type === 'number' || type === 'date') ||
          new Set(argument.acceptedTypes).size !== argument.acceptedTypes.length) throw invalid();
    }
  }
  const messages: Record<string, ParsedMessage> = Object.create(null);
  for (const entry of catalog.messages) {
    if (!Array.isArray(entry) || (entry.length !== 7 && entry.length !== 8)) throw invalid();
    const [id, source, , , , ast, index, tags] = entry;
    if (typeof id !== 'string' || !id || id.includes(':') || Object.hasOwn(messages, id) || typeof source !== 'string' ||
        !Array.isArray(ast) || !Number.isSafeInteger(index) || index < 0 || index >= catalog.schemas.length) throw invalid();
    if (tags !== undefined && (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(tag)) ||
        new Set(tags).size !== tags.length)) throw invalid();
    messages[id] = { source, position: readPoint(entry, 2), ast: ast.map(decodeNode), arguments: catalog.schemas[index]!,
      ...(tags === undefined ? {} : { richTextTags: tags }) };
  }
  return { status: 'present', sessionId: result.sessionId, key: result.key, catalogVersion: result.catalogVersion,
    namespaceSchemaFingerprint: result.namespaceSchemaFingerprint,
    catalog: { locale: result.key.locale, namespace: result.key.namespace, sourceName: catalog.sourceName, messages } };
}
