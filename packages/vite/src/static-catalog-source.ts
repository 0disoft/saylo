import { CatalogLoadError, validateCatalogManifest } from '@0disoft/saylo-core';
import type { CatalogKey, CatalogManifest, CatalogOutcome } from '@0disoft/saylo-core';
import { catalogId as id, immutable, matches } from './catalog-outcome.js';
import type { DevCatalogSource } from './catalog-source.js';

export interface StaticCatalogLoader {
  readonly key: CatalogKey;
  readonly load: () => Promise<CatalogOutcome>;
}

const noop = () => {};
const invalid = () => new CatalogLoadError('INVALID_STATIC_CATALOG', 'Static catalog does not match its manifest pair.');

/** Boot pairs are inline; other present pairs are loaded from generated imports on demand. */
export function createStaticCatalogSource(initial: CatalogManifest, initialCatalogs: readonly CatalogOutcome[],
  entries: readonly StaticCatalogLoader[]): DevCatalogSource {
  const manifest = validateCatalogManifest(initial);
  const metadata = new Map(manifest.catalogs.map(meta => [id(meta.key), meta]));
  const cache = new Map<string, CatalogOutcome>();
  const loaders = new Map<string, StaticCatalogLoader['load']>();
  const flights = new Map<string, Promise<CatalogOutcome>>();
  for (const outcome of initialCatalogs) {
    if (cache.has(id(outcome.key)) || !matches(manifest, outcome)) throw invalid();
    cache.set(id(outcome.key), immutable(outcome));
  }
  for (const entry of entries) {
    const key = id(entry.key);
    if (loaders.has(key) || metadata.get(key)?.status !== 'present' || typeof entry.load !== 'function') throw invalid();
    loaders.set(key, entry.load);
  }
  for (const meta of manifest.catalogs) {
    if (meta.status === 'present' && !cache.has(id(meta.key)) && !loaders.has(id(meta.key))) throw invalid();
  }
  return Object.freeze({
    readManifest: () => manifest,
    getCatalogs: () => Object.freeze([...cache.values()].flatMap(o => o.status === 'present' ? [o.catalog] : [])),
    subscribeManifest: () => noop, subscribeDiagnostic: () => noop, connect: () => noop, dispose: noop,
    loadCatalog(locale: string, namespace: string, signal?: AbortSignal): Promise<CatalogOutcome> {
      if (signal?.aborted) return Promise.reject(new CatalogLoadError('ABORTED', 'Catalog request was cancelled.'));
      const key = { locale, namespace };
      const pair = id(key);
      const cached = cache.get(pair);
      if (cached) return Promise.resolve(cached);
      const meta = metadata.get(pair);
      if (!meta || meta.status === 'missing') return Promise.resolve(immutable({
        status: 'missing', sessionId: manifest.sessionId, key, catalogVersion: meta?.catalogVersion ?? 0,
      }));
      const pending = flights.get(pair);
      if (pending) return pending;
      // Import cannot be cancelled. Core guards timeout/disposal; its result may still seed the shared source cache.
      const promise = Promise.resolve().then(() => loaders.get(pair)!()).then(outcome => {
        if (!outcome || !outcome.key || id(outcome.key) !== pair || !matches(manifest, outcome)) throw invalid();
        const accepted = immutable(outcome);
        cache.set(pair, accepted);
        return accepted;
      }).finally(() => { flights.delete(pair); });
      flights.set(pair, promise);
      return promise;
    },
  });
}
