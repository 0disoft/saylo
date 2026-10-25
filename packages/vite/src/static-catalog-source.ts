import { CatalogLoadError, validateCatalogManifest } from '@0disoft/saylo-core';
import type { CatalogKey, CatalogManifest, CatalogOutcome } from '@0disoft/saylo-core';
import { catalogId as id, catalogMetadata, immutable, matches } from './catalog-outcome.js';
import { catalogCacheLimit } from './cache-policy.js';
import type { DevCatalogSource } from './catalog-source.js';
import { schedule, timeoutDuration } from './scheduling.js';
import type { Schedule } from './scheduling.js';

export interface StaticCatalogSourceOptions {
  readonly timeoutMs?: number;
  readonly schedule?: Schedule;
  /** Soft LRU limit for decoded outcomes; inline initial outcomes remain pinned. Omitted keeps all. */
  readonly maxCachedCatalogs?: number;
}
interface Flight { promise: Promise<CatalogOutcome>; users: number }

export interface StaticCatalogLoader {
  readonly key: CatalogKey;
  readonly load: () => Promise<CatalogOutcome>;
}

const noop = () => {};
const invalid = () => new CatalogLoadError('INVALID_STATIC_CATALOG', 'Static catalog does not match its manifest pair.');

/** Boot pairs are inline; other present pairs are loaded from generated imports on demand. */
export function createStaticCatalogSource(initial: CatalogManifest, initialCatalogs: readonly CatalogOutcome[],
  entries: readonly StaticCatalogLoader[], options: StaticCatalogSourceOptions = {}): DevCatalogSource {
  const timeoutMs = timeoutDuration(options.timeoutMs);
  const maxCachedCatalogs = catalogCacheLimit(options.maxCachedCatalogs);
  const manifest = validateCatalogManifest(initial);
  const metadata = catalogMetadata(manifest);
  const cache = new Map<string, CatalogOutcome>();
  const pinned = new Set<string>();
  const evictable = new Set<string>();
  const loaders = new Map<string, StaticCatalogLoader['load']>();
  const flights = new Map<string, Flight>();
  for (const outcome of initialCatalogs) {
    if (cache.has(id(outcome.key)) || !matches(manifest, outcome)) throw invalid();
    const pair = id(outcome.key);
    pinned.add(pair);
    cache.set(pair, immutable(outcome));
  }
  for (const entry of entries) {
    const key = id(entry.key);
    if (loaders.has(key) || metadata.get(key)?.status !== 'present' || typeof entry.load !== 'function') throw invalid();
    loaders.set(key, entry.load);
  }
  for (const meta of manifest.catalogs) {
    if (meta.status === 'present' && !cache.has(id(meta.key)) && !loaders.has(id(meta.key))) throw invalid();
  }
  const touch = (pair: string, outcome: CatalogOutcome) => {
    cache.delete(pair);
    cache.set(pair, outcome);
    // Boot pins never change. Track only unpinned entries in LRU order so a
    // small budget cannot repeatedly scan the entire inline boot scope.
    if (maxCachedCatalogs !== undefined && !pinned.has(pair)) {
      evictable.delete(pair);
      evictable.add(pair);
    }
  };
  const remember = (pair: string, outcome: CatalogOutcome) => {
    touch(pair, outcome);
    if (maxCachedCatalogs === undefined || cache.size <= maxCachedCatalogs) return;
    for (const cached of evictable) {
      if (cache.size <= maxCachedCatalogs) break;
      cache.delete(cached);
      evictable.delete(cached);
    }
  };
  const cached = (pair: string) => {
    const outcome = cache.get(pair);
    if (outcome) touch(pair, outcome);
    return outcome;
  };
  return Object.freeze({
    readManifest: () => manifest,
    getCatalogs: () => Object.freeze([...cache.values()].flatMap(o => o.status === 'present' ? [o.catalog] : [])),
    subscribeManifest: () => noop, subscribeDiagnostic: () => noop, connect: () => noop, dispose: noop,
    loadCatalog(locale: string, namespace: string, signal?: AbortSignal): Promise<CatalogOutcome> {
      const aborted = () => new CatalogLoadError('ABORTED', 'Catalog request was cancelled.', { cause: signal?.reason });
      if (signal?.aborted) return Promise.reject(aborted());
      const key = { locale, namespace };
      const pair = id(key);
      const hit = cached(pair);
      if (hit) return Promise.resolve(hit);
      const meta = metadata.get(pair);
      if (!meta || meta.status === 'missing') return Promise.resolve(immutable({
        status: 'missing', sessionId: manifest.sessionId, key, catalogVersion: meta?.catalogVersion ?? 0,
      }));
      let flight = flights.get(pair);
      if (!flight) {
        const created: Flight = { users: 0, promise: Promise.resolve().then(() => loaders.get(pair)!()).then(outcome => {
          if (!outcome || !outcome.key || id(outcome.key) !== pair || !matches(manifest, outcome)) throw invalid();
          const accepted = immutable(outcome);
          if (flights.get(pair) === created) remember(pair, accepted);
          return accepted;
        }).finally(() => { if (flights.get(pair) === created) flights.delete(pair); }) };
        flights.set(pair, created);
        flight = created;
      }
      const shared = flight;
      shared.users++;
      return new Promise<CatalogOutcome>((resolve, reject) => {
        let finished = false;
        let cancelTimer = noop;
        const finish = (error?: unknown, outcome?: CatalogOutcome) => {
          if (finished) return;
          finished = true;
          cancelTimer();
          signal?.removeEventListener('abort', abort);
          if (--shared.users === 0 && flights.get(pair) === shared) flights.delete(pair);
          if (outcome) resolve(outcome); else reject(error);
        };
        const abort = () => finish(aborted());
        cancelTimer = (options.schedule ?? schedule)(timeoutMs,
          () => finish(new CatalogLoadError('TIMEOUT', 'Static catalog load timed out.')));
        signal?.addEventListener('abort', abort, { once: true });
        // Imports cannot be interrupted; both handlers also observe orphaned rejections.
        void shared.promise.then(outcome => finish(undefined, outcome), error => finish(error));
        if (signal?.aborted) abort();
      });
    },
  });
}
