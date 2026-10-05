import type { CatalogOutcome, ParsedCatalog, ParsedMessage, SourcePosition } from '@saylo/core';

export type PresentCatalog = Extract<CatalogOutcome, { status: 'present' }>;
export interface CatalogStamp {
  readonly sessionId: string;
  readonly catalogVersion: number;
}
/** Request-scoped delta. Core still receives a complete immutable CatalogOutcome. */
export interface CatalogPatch extends CatalogStamp {
  readonly status: 'patch';
  readonly key: PresentCatalog['key'];
  readonly namespaceSchemaFingerprint: string;
  readonly base: CatalogStamp;
  readonly sourceName: string;
  readonly upsert: readonly (readonly [string, ParsedMessage])[];
  readonly remove: readonly string[];
  readonly positions: readonly (readonly [string, SourcePosition])[];
}

const samePosition = (a: SourcePosition, b: SourcePosition) =>
  a.offset === b.offset && a.line === b.line && a.column === b.column;

export function createCatalogPatch(before: ParsedCatalog, after: PresentCatalog, base: CatalogStamp): CatalogPatch {
  const upsert: [string, ParsedMessage][] = [];
  const positions: [string, SourcePosition][] = [];
  const remove = Object.keys(before.messages).filter(id => !Object.hasOwn(after.catalog.messages, id));
  for (const [id, message] of Object.entries(after.catalog.messages)) {
    const previous = Object.hasOwn(before.messages, id) ? before.messages[id] : undefined;
    if (!previous || previous.source !== message.source) upsert.push([id, message]);
    else if (!samePosition(previous.position, message.position)) positions.push([id, message.position]);
  }
  return { status: 'patch', sessionId: after.sessionId, key: after.key, catalogVersion: after.catalogVersion,
    namespaceSchemaFingerprint: after.namespaceSchemaFingerprint, base, sourceName: after.catalog.sourceName,
    upsert, remove, positions };
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
      typeof patch.sourceName !== 'string' || !Array.isArray(patch.upsert) || !Array.isArray(patch.remove) || !Array.isArray(patch.positions))
    throw new Error('Catalog patch has no matching immutable baseline.');
  const messages: Record<string, ParsedMessage> = Object.assign(Object.create(null), before.catalog.messages);
  const seen = new Set<string>();
  const claim = (id: string) => {
    if (typeof id !== 'string' || !id || id.includes(':') || seen.has(id)) throw new Error('Invalid or duplicate catalog patch ID.');
    seen.add(id);
  };
  for (const id of patch.remove) {
    claim(id);
    if (!Object.hasOwn(messages, id)) throw new Error('Catalog patch removes an unknown message.');
    delete messages[id];
  }
  for (const entry of patch.upsert) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Invalid catalog patch message entry.');
    const [id, message] = entry;
    claim(id);
    if (!message || typeof message.source !== 'string' || !position(message.position) ||
        !Array.isArray(message.ast) || !message.arguments || typeof message.arguments !== 'object' || Array.isArray(message.arguments))
      throw new Error('Invalid catalog patch message.');
    messages[id] = message;
  }
  for (const entry of patch.positions) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Invalid catalog patch position entry.');
    const [id, nextPosition] = entry;
    claim(id);
    if (!Object.hasOwn(messages, id) || !position(nextPosition)) throw new Error('Invalid catalog patch source position.');
    messages[id] = { ...messages[id]!, position: nextPosition };
  }
  return { status: 'present', sessionId: patch.sessionId, key: patch.key, catalogVersion: patch.catalogVersion,
    namespaceSchemaFingerprint: patch.namespaceSchemaFingerprint,
    catalog: { locale: patch.key.locale, namespace: patch.key.namespace, sourceName: patch.sourceName, messages } };
}
