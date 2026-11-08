import type { CatalogKey, CatalogMetadata } from '@0disoft/saylo-core';
import type { WebSocketClient } from 'vite';
import { CatalogRegistry } from './catalog-registry.js';
import { catalogId, catalogMetadata } from './catalog-outcome.js';
import { encodeCatalogResult } from './catalog-wire.js';
import type { CatalogPush, CatalogScope } from './types.js';

const MAX_OWNER_LENGTH = 256;

function scopeKey(key: CatalogKey): CatalogKey {
  if (!key || typeof key.locale !== 'string' || Intl.getCanonicalLocales(key.locale)[0] !== key.locale ||
      typeof key.namespace !== 'string' || !key.namespace || /[:/\\\x00-\x1f]/.test(key.namespace) ||
      ['.', '..'].includes(key.namespace)) throw new Error('Invalid catalog push key.');
  return Object.freeze({ locale: key.locale, namespace: key.namespace });
}

function scope(input: CatalogScope): CatalogScope {
  if (!input || typeof input.owner !== 'string' || !input.owner || input.owner.length > MAX_OWNER_LENGTH ||
      typeof input.sessionId !== 'string' || !input.sessionId || !Array.isArray(input.catalogs) ||
      (input.kind !== undefined && input.kind !== 'replace' && input.kind !== 'patch') ||
      (input.removed !== undefined && (input.kind !== 'patch' || !Array.isArray(input.removed)))) throw new Error('Invalid catalog push scope.');
  const seen = new Set<string>();
  const catalogs = input.catalogs.map(meta => {
    if (!meta || !Number.isSafeInteger(meta.catalogVersion) || meta.catalogVersion < 0 ||
        (meta.status !== 'present' && meta.status !== 'missing') || (meta.status === 'present' &&
          (typeof meta.namespaceSchemaFingerprint !== 'string' || !meta.namespaceSchemaFingerprint))) throw new Error('Invalid catalog push metadata.');
    const key = scopeKey(meta.key), id = catalogId(key);
    if (seen.has(id)) throw new Error('Duplicate catalog push key.');
    seen.add(id);
    return Object.freeze({ ...meta, key });
  });
  const removed = (input.removed ?? []).map(value => {
    const key = scopeKey(value), id = catalogId(key);
    if (seen.has(id)) throw new Error('Duplicate catalog push key.');
    seen.add(id);
    return key;
  });
  return Object.freeze({ owner: input.owner, sessionId: input.sessionId, kind: input.kind ?? 'replace',
    catalogs: Object.freeze(catalogs), removed: Object.freeze(removed) });
}

interface Subscription {
  readonly sessionId: string;
  readonly catalogs: Map<string, CatalogMetadata>;
}

/** Per-source subscriptions share Vite's socket without owning it or retaining closed clients. */
export class CatalogPushSubscriptions {
  private clients = new WeakMap<WebSocketClient, Map<string, Subscription>>();

  subscribe(client: WebSocketClient, input: CatalogScope) {
    const accepted = scope(input);
    let sources = this.clients.get(client);
    const previous = sources?.get(accepted.owner);
    if (accepted.kind === 'patch' && previous && previous.sessionId !== accepted.sessionId)
      throw new Error('Catalog push scope patch requires a matching session.');
    if (!sources) this.clients.set(client, sources = new Map());
    const catalogs = accepted.kind === 'patch' && previous ? previous.catalogs : new Map<string, CatalogMetadata>();
    for (const key of accepted.removed ?? []) catalogs.delete(catalogId(key));
    for (const meta of accepted.catalogs) catalogs.set(catalogId(meta.key), meta);
    if (!catalogs.size) sources.delete(accepted.owner);
    else sources.set(accepted.owner, { sessionId: accepted.sessionId, catalogs });
  }

  updates(client: WebSocketClient, registry: CatalogRegistry, baseRevision: number): readonly CatalogPush[] {
    const sources = this.clients.get(client);
    if (!sources) return [];
    const manifest = registry.manifest(), metadata = catalogMetadata(manifest);
    const result: CatalogPush[] = [];
    for (const [owner, previous] of sources) {
      const outcomes = [];
      const catalogs = new Map<string, CatalogMetadata>();
      for (const before of previous.catalogs.values()) {
        const after = metadata.get(catalogId(before.key)) ?? { key: before.key, status: 'missing' as const, catalogVersion: 0 };
        catalogs.set(catalogId(after.key), after);
        if (previous.sessionId === manifest.sessionId && before.catalogVersion === after.catalogVersion && before.status === after.status &&
            (before.status !== 'present' || after.status === 'present' && before.namespaceSchemaFingerprint === after.namespaceSchemaFingerprint)) continue;
        outcomes.push(encodeCatalogResult(registry.loadDelta(before.key.locale, before.key.namespace,
          before.status === 'present' ? { sessionId: previous.sessionId, catalogVersion: before.catalogVersion } : undefined)));
      }
      // Advance before sending: synchronous test transports and scope acknowledgements may reenter.
      sources.set(owner, { sessionId: manifest.sessionId, catalogs });
      result.push({ kind: 'patch', owner, baseRevision, manifest, outcomes });
    }
    return result;
  }

  clear() { this.clients = new WeakMap(); }
}
