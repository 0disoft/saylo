import type { CatalogMetadata } from '@0disoft/saylo-core';
import type { WebSocketClient } from 'vite';
import { CatalogRegistry } from './catalog-registry.js';
import { catalogId, catalogMetadata } from './catalog-outcome.js';
import { encodeCatalogResult } from './catalog-wire.js';
import type { CatalogPush, CatalogScope } from './types.js';

function scope(input: CatalogScope): CatalogScope {
  if (!input || typeof input.owner !== 'string' || !input.owner || input.owner.length > 256 ||
      typeof input.sessionId !== 'string' || !input.sessionId || !Array.isArray(input.catalogs)) throw new Error('Invalid catalog push scope.');
  const seen = new Set<string>();
  const catalogs = input.catalogs.map(meta => {
    if (!meta?.key || typeof meta.key.locale !== 'string' || Intl.getCanonicalLocales(meta.key.locale)[0] !== meta.key.locale ||
        typeof meta.key.namespace !== 'string' || !meta.key.namespace || /[:/\\\x00-\x1f]/.test(meta.key.namespace) ||
        ['.', '..'].includes(meta.key.namespace) || !Number.isSafeInteger(meta.catalogVersion) || meta.catalogVersion < 0 ||
        (meta.status !== 'present' && meta.status !== 'missing') || (meta.status === 'present' &&
          (typeof meta.namespaceSchemaFingerprint !== 'string' || !meta.namespaceSchemaFingerprint))) throw new Error('Invalid catalog push metadata.');
    const id = catalogId(meta.key);
    if (seen.has(id)) throw new Error('Duplicate catalog push key.');
    seen.add(id);
    return Object.freeze({ ...meta, key: Object.freeze({ ...meta.key }) });
  });
  return Object.freeze({ owner: input.owner, sessionId: input.sessionId, catalogs: Object.freeze(catalogs) });
}

/** Per-source subscriptions share Vite's socket without owning it or retaining closed clients. */
export class CatalogPushSubscriptions {
  private clients = new WeakMap<WebSocketClient, Map<string, CatalogScope>>();

  subscribe(client: WebSocketClient, input: CatalogScope) {
    const accepted = scope(input);
    let sources = this.clients.get(client);
    if (!sources) this.clients.set(client, sources = new Map());
    if (!accepted.catalogs.length) sources.delete(accepted.owner);
    else sources.set(accepted.owner, accepted);
  }

  updates(client: WebSocketClient, registry: CatalogRegistry, baseRevision: number): readonly CatalogPush[] {
    const sources = this.clients.get(client);
    if (!sources) return [];
    const manifest = registry.manifest(), metadata = catalogMetadata(manifest);
    const result: CatalogPush[] = [];
    for (const [owner, previous] of sources) {
      const outcomes = [];
      const catalogs: CatalogMetadata[] = [];
      for (const before of previous.catalogs) {
        const after = metadata.get(catalogId(before.key)) ?? { key: before.key, status: 'missing' as const, catalogVersion: 0 };
        catalogs.push(after);
        if (previous.sessionId === manifest.sessionId && before.catalogVersion === after.catalogVersion && before.status === after.status &&
            (before.status !== 'present' || after.status === 'present' && before.namespaceSchemaFingerprint === after.namespaceSchemaFingerprint)) continue;
        outcomes.push(encodeCatalogResult(registry.loadDelta(before.key.locale, before.key.namespace,
          before.status === 'present' ? { sessionId: previous.sessionId, catalogVersion: before.catalogVersion } : undefined)));
      }
      // Advance before sending: synchronous test transports and scope acknowledgements may reenter.
      sources.set(owner, { owner, sessionId: manifest.sessionId, catalogs });
      result.push({ kind: 'patch', owner, baseRevision, manifest, outcomes });
    }
    return result;
  }

  clear() { this.clients = new WeakMap(); }
}
