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
  /** Monotonic milliseconds. Defaults to performance.now with the built-in scheduler. */
  readonly now?: () => number;
  /** Soft LRU limit for decoded outcomes; inline initial outcomes remain pinned. Omitted keeps all. */
  readonly maxCachedCatalogs?: number;
}
type Waiter = (error?: unknown, outcome?: CatalogOutcome) => boolean;
interface Flight {
  readonly controller: AbortController;
  readonly waiters: Set<Waiter>;
}

export interface StaticCatalogLoader {
  readonly key: CatalogKey;
  /** The signal aborts when all callers leave. Native imports may ignore it. */
  readonly load: (signal?: AbortSignal) => Promise<CatalogOutcome>;
}

const noop = () => {};
const monotonicNow = () => performance.now();
const invalid = () => new CatalogLoadError('INVALID_STATIC_CATALOG', 'Static catalog does not match its manifest pair.');
const timedOut = () => new CatalogLoadError('TIMEOUT', 'Static catalog load timed out.');

/** Boot pairs are inline; other present pairs are loaded from generated imports on demand. */
export function createStaticCatalogSource(initial: CatalogManifest, initialCatalogs: readonly CatalogOutcome[],
  entries: readonly StaticCatalogLoader[], options: StaticCatalogSourceOptions = {}): DevCatalogSource {
  const timeoutMs = timeoutDuration(options.timeoutMs);
  const later = options.schedule ?? schedule;
  const now = options.now ?? (later === schedule ? monotonicNow : undefined);
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
  const finishFlight = (pair: string, flight: Flight, error?: unknown, outcome?: CatalogOutcome) => {
    if (flights.get(pair) !== flight) return;
    flights.delete(pair);
    let accepted = false;
    for (const wait of flight.waiters) if (wait(error, outcome)) accepted = true;
    if (accepted && outcome) remember(pair, outcome);
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
      const startedAt = now?.() ?? 0;
      let flight = flights.get(pair);
      if (!flight) {
        const created: Flight = { controller: new AbortController(), waiters: new Set() };
        flights.set(pair, created);
        const importSignal = created.controller.signal;
        void Promise.resolve().then(() => {
          importSignal.throwIfAborted();
          return loaders.get(pair)!(importSignal);
        }).then(outcome => {
          if (importSignal.aborted) return;
          if (!outcome || !outcome.key || id(outcome.key) !== pair || !matches(manifest, outcome)) throw invalid();
          return immutable(outcome);
        }).then(outcome => finishFlight(pair, created, undefined, outcome),
          error => finishFlight(pair, created, error));
        flight = created;
      }
      const shared = flight;
      return new Promise<CatalogOutcome>((resolve, reject) => {
        let finished = false;
        let cancelTimer = noop;
        const finish: Waiter = (error, outcome) => {
          if (finished) return false;
          finished = true;
          cancelTimer();
          signal?.removeEventListener('abort', abort);
          shared.waiters.delete(settle);
          if (!shared.waiters.size && flights.get(pair) === shared) {
            flights.delete(pair);
            shared.controller.abort(error);
          }
          if (outcome) { resolve(outcome); return true; }
          reject(error);
          return false;
        };
        // A settled import can reach its callers before their expired timers run.
        const settle: Waiter = (error, outcome) =>
          now && now() - startedAt >= timeoutMs ? finish(timedOut()) : finish(error, outcome);
        const abort = () => finish(aborted());
        shared.waiters.add(settle);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        try { cancelTimer = later(timeoutMs, () => finish(timedOut())); }
        catch (error) { finish(error); }
        // A custom scheduler can abort a caller during registration.
        if (finished) cancelTimer();
      });
    },
  });
}
