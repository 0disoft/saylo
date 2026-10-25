import { CatalogLoadError } from './loading-errors.js';
import { acceptOutcome, keyId, metadata, stamp } from './loading-registry.js';
import type { CatalogKey, CatalogManifest, CatalogOutcome, CatalogSchedule, CatalogSource } from './loading-types.js';
import { scheduleCatalog } from './loading-runtime.js';
import { CatalogLoadQueue } from './loading-queue.js';
import { catalogCacheLimit } from './loading-policy.js';

interface Flight {
  readonly key: CatalogKey;
  readonly version: string;
  readonly promise: Promise<CatalogOutcome>;
  cancel(reason: Error): void;
}

export interface CatalogLoaderCacheOptions {
  readonly maxCachedCatalogs?: number;
  /** Current and desired catalog IDs that cannot be evicted from the inactive cache. */
  readonly protectedKeys?: () => ReadonlySet<string>;
}

const NO_PROTECTED_KEYS = () => new Set<string>();

/** Dedupes pair/version loads, independently of desired-state generations. */
export class CatalogLoader {
  private readonly cache = new Map<string, CatalogOutcome>();
  private readonly flights = new Map<string, Flight>();
  private readonly queue = new CatalogLoadQueue();
  private readonly maxCachedCatalogs: number | undefined;
  private readonly protectedKeys: () => ReadonlySet<string>;

  constructor(private readonly source: CatalogSource, private readonly manifest: () => CatalogManifest,
    private readonly timeoutMs: number, private readonly schedule: CatalogSchedule = scheduleCatalog,
    cacheOptions: CatalogLoaderCacheOptions = {}) {
    this.maxCachedCatalogs = catalogCacheLimit(cacheOptions.maxCachedCatalogs);
    this.protectedKeys = cacheOptions.protectedKeys ?? NO_PROTECTED_KEYS;
  }

  seed(outcomes: readonly CatalogOutcome[]) { for (const outcome of outcomes) this.remember(outcome.key, outcome); }

  /** Apply the inactive LRU budget after desired/committed scope changes. */
  trim() {
    if (this.maxCachedCatalogs === undefined || this.cache.size <= this.maxCachedCatalogs) return;
    const protectedKeys = this.protectedKeys();
    for (const id of this.cache.keys()) {
      if (this.cache.size <= this.maxCachedCatalogs) break;
      if (!protectedKeys.has(id)) this.cache.delete(id);
    }
  }

  private touch(id: string, outcome: CatalogOutcome) {
    this.cache.delete(id);
    this.cache.set(id, outcome);
  }

  private remember(key: CatalogKey, outcome: CatalogOutcome) {
    this.touch(keyId(key), outcome);
    this.trim();
  }

  invalidate() {
    const current = this.manifest();
    for (const [id, outcome] of this.cache) {
      if (stamp(outcome.sessionId, outcome) !== stamp(current.sessionId, metadata(current, outcome.key))) this.cache.delete(id);
    }
    for (const flight of this.flights.values()) {
      if (flight.version !== stamp(current.sessionId, metadata(current, flight.key)))
        flight.cancel(new CatalogLoadError('STALE_CATALOG', 'Catalog changed while it was loading.'));
    }
  }

  stop(reason: Error) {
    for (const flight of this.flights.values()) flight.cancel(reason);
    this.cache.clear();
  }

  load(key: CatalogKey): Promise<CatalogOutcome> {
    const initial = this.manifest();
    const version = stamp(initial.sessionId, metadata(initial, key));
    const cached = this.cache.get(keyId(key));
    if (cached && stamp(cached.sessionId, cached) === version) {
      this.touch(keyId(key), cached);
      return Promise.resolve(cached);
    }
    const existing = this.flights.get(version);
    if (existing) return existing.promise;
    const controller = new AbortController();
    let resolve!: (outcome: CatalogOutcome) => void;
    let reject!: (reason: unknown) => void;
    let done = false;
    const promise = new Promise<CatalogOutcome>((yes, no) => { resolve = yes; reject = no; });
    const finish = () => {
      done = true;
      cancelTimer();
      this.flights.delete(version);
    };
    const flight: Flight = { key, version, promise, cancel: reason => {
      if (done) return;
      finish();
      reject(reason);
      controller.abort(reason);
    } };
    const cancelTimer = this.schedule(this.timeoutMs, () => flight.cancel(new CatalogLoadError('TIMEOUT',
      `Catalog ${key.locale}/${key.namespace} did not load within ${this.timeoutMs}ms.`)));
    this.flights.set(version, flight);
    // The queue retains physical source slots across timeouts and invalidation.
    this.queue.run(() => this.source.loadCatalog(key.locale, key.namespace, controller.signal), controller.signal).then(result => {
      if (done) return;
      try {
        if (!result || result.status === 'failed') throw new CatalogLoadError(result?.code ?? 'INVALID_RESULT', result?.message ?? 'Invalid catalog load result.');
        const accepted = acceptOutcome(this.manifest(), key, result);
        this.remember(key, accepted);
        finish();
        resolve(accepted);
      } catch (error) { finish(); reject(error); }
    }, error => {
      if (done) return;
      finish();
      reject(new CatalogLoadError('LOAD_FAILED', `Catalog ${key.locale}/${key.namespace} failed to load.`, { cause: error }));
    });
    return promise;
  }
}
