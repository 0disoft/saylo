import type { CatalogOutcome, ParsedCatalog, ParsedMessage, SourcePosition } from '@0disoft/saylo-core';

export type PresentCatalog = Extract<CatalogOutcome, { status: 'present' }>;
export interface CatalogStamp {
  readonly sessionId: string;
  readonly catalogVersion: number;
}
interface PositionShift {
  readonly offsetDelta: number;
  readonly lineDelta: number;
  readonly columnDelta: number;
}
/** Request-scoped delta. Core still receives a complete immutable CatalogOutcome. */
export interface CatalogPatch extends CatalogStamp {
  readonly status: 'patch';
  readonly key: PresentCatalog['key'];
  readonly namespaceSchemaFingerprint: string;
  readonly base: CatalogStamp;
  readonly sourceName: string;
  readonly messageCount: number;
  readonly upsert: readonly (readonly [string, ParsedMessage])[];
  readonly remove: readonly string[];
  readonly positions: readonly (readonly [string, SourcePosition])[];
  /** Uniform movement of unchanged messages, with positions overriding individual IDs. */
  readonly positionShift?: PositionShift;
}

const samePosition = (a: SourcePosition, b: SourcePosition) =>
  a.offset === b.offset && a.line === b.line && a.column === b.column;

export function createCatalogPatch(before: ParsedCatalog, after: PresentCatalog, base: CatalogStamp): CatalogPatch {
  const upsert: [string, ParsedMessage][] = [];
  const positions: [string, SourcePosition][] = [];
  let shift: PositionShift | undefined;
  let uniform = true;
  let count = 0;
  const remove: string[] = [];
  for (const id of Object.keys(before.messages)) {
    if (!Object.hasOwn(after.catalog.messages, id)) remove.push(id);
  }
  for (const id of Object.keys(after.catalog.messages)) {
    const message = after.catalog.messages[id]!;
    count++;
    const previous = Object.hasOwn(before.messages, id) ? before.messages[id] : undefined;
    if (!previous || (previous !== message && (previous.source !== message.source ||
        (previous.richTextTags !== message.richTextTags && JSON.stringify(previous.richTextTags) !== JSON.stringify(message.richTextTags))))) upsert.push([id, message]);
    else {
      const offsetDelta = message.position.offset - previous.position.offset;
      const lineDelta = message.position.line - previous.position.line;
      const columnDelta = message.position.column - previous.position.column;
      if (!shift) shift = { offsetDelta, lineDelta, columnDelta };
      else if (shift.offsetDelta !== offsetDelta || shift.lineDelta !== lineDelta || shift.columnDelta !== columnDelta) uniform = false;
      if (!samePosition(previous.position, message.position)) positions.push([id, message.position]);
    }
  }
  const compressed = uniform && positions.length > 1 ? shift : undefined;
  return { status: 'patch', sessionId: after.sessionId, key: after.key, catalogVersion: after.catalogVersion,
    namespaceSchemaFingerprint: after.namespaceSchemaFingerprint, base, sourceName: after.catalog.sourceName,
    messageCount: count, upsert, remove, positions: compressed ? [] : positions, ...(compressed ? { positionShift: compressed } : {}) };
}

function position(value: SourcePosition) {
  return value && Number.isSafeInteger(value.offset) && value.offset >= 0 &&
    Number.isSafeInteger(value.line) && value.line >= 1 && Number.isSafeInteger(value.column) && value.column >= 1;
}

/** No partial mutation escapes a rejected delta, including prototype-like literal IDs. */
export function applyCatalogPatch(before: PresentCatalog | undefined, patch: CatalogPatch): PresentCatalog {
  if (!before || patch.base?.sessionId !== before.sessionId || patch.base.catalogVersion !== before.catalogVersion ||
      patch.sessionId !== before.sessionId || patch.catalogVersion < before.catalogVersion ||
      patch.key?.locale !== before.key.locale || patch.key.namespace !== before.key.namespace ||
      typeof patch.sourceName !== 'string' || !Number.isSafeInteger(patch.messageCount) || patch.messageCount < 0 ||
      !Array.isArray(patch.upsert) || !Array.isArray(patch.remove) || !Array.isArray(patch.positions))
    throw new Error('Catalog patch has no matching immutable baseline.');
  const messages: Record<string, ParsedMessage> = Object.create(null);
  const ids = Object.keys(before.catalog.messages);
  for (const id of ids) messages[id] = before.catalog.messages[id]!;
  let count = ids.length;
  const seen = new Set<string>();
  const claim = (id: string) => {
    if (typeof id !== 'string' || !id || id.includes(':') || seen.has(id)) throw new Error('Invalid or duplicate catalog patch ID.');
    seen.add(id);
  };
  for (const id of patch.remove) {
    claim(id);
    if (!Object.hasOwn(messages, id)) throw new Error('Catalog patch removes an unknown message.');
    delete messages[id];
    count--;
  }
  for (const entry of patch.upsert) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Invalid catalog patch message entry.');
    const [id, message] = entry;
    claim(id);
    if (!message || typeof message.source !== 'string' || !position(message.position) ||
        !Array.isArray(message.ast) || !message.arguments || typeof message.arguments !== 'object' || Array.isArray(message.arguments))
      throw new Error('Invalid catalog patch message.');
    if (!Object.hasOwn(messages, id)) count++;
    messages[id] = message;
  }
  for (const entry of patch.positions) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Invalid catalog patch position entry.');
    const [id, nextPosition] = entry;
    claim(id);
    if (!Object.hasOwn(messages, id) || !position(nextPosition)) throw new Error('Invalid catalog patch source position.');
    messages[id] = { ...messages[id]!, position: nextPosition };
  }
  if (patch.positionShift !== undefined) {
    const shift = patch.positionShift;
    if (!shift || !Number.isSafeInteger(shift.offsetDelta) || !Number.isSafeInteger(shift.lineDelta) || !Number.isSafeInteger(shift.columnDelta))
      throw new Error('Invalid uniform catalog position shift.');
    for (const id of Object.keys(messages)) if (!seen.has(id)) {
      const message = messages[id]!;
      const next = { offset: message.position.offset + shift.offsetDelta, line: message.position.line + shift.lineDelta,
        column: message.position.column + shift.columnDelta };
      if (!position(next)) throw new Error('Catalog position shift moves outside the source.');
      messages[id] = { ...message, position: next };
    }
  }
  if (count !== patch.messageCount) throw new Error('Catalog patch message count differs.');
  return { status: 'present', sessionId: patch.sessionId, key: patch.key, catalogVersion: patch.catalogVersion,
    namespaceSchemaFingerprint: patch.namespaceSchemaFingerprint,
    catalog: { locale: patch.key.locale, namespace: patch.key.namespace, sourceName: patch.sourceName, messages } };
}
