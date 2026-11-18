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
  started: boolean;
  cancel(reason: Error): void;
}

export interface CatalogLoaderCacheOptions {
  readonly maxCachedCatalogs?: number;
  /** Immutable scope snapshot; return a new set when protected catalog IDs change. */
  readonly protectedKeys?: () => ReadonlySet<string>;
}

const EMPTY_PROTECTED_KEYS: ReadonlySet<string> = new Set<string>();
const NO_PROTECTED_KEYS = () => EMPTY_PROTECTED_KEYS;

/** Dedupes pair/version loads, independently of desired-state generations. */
export class CatalogLoader {
  private readonly cache = new Map<string, CatalogOutcome>();
  private readonly evictable = new Set<string>();
  private protectionSnapshot: ReadonlySet<string> | undefined;
  private readonly flights = new Map<string, Flight>();
  private readonly maxCachedCatalogs: number | undefined;
  private readonly protectedKeys: () => ReadonlySet<string>;

  constructor(private readonly source: CatalogSource, private readonly manifest: () => CatalogManifest,
    private readonly timeoutMs: number, private readonly schedule: CatalogSchedule = scheduleCatalog,
    cacheOptions: CatalogLoaderCacheOptions = {},
    private readonly queue = new CatalogLoadQueue(),
    // Custom schedulers can use virtual time. Pair them with their own clock when available.
    private readonly now: (() => number) | undefined = schedule === scheduleCatalog ? () => performance.now() : undefined) {
    this.maxCachedCatalogs = catalogCacheLimit(cacheOptions.maxCachedCatalogs);
    this.protectedKeys = cacheOptions.protectedKeys ?? NO_PROTECTED_KEYS;
  }

  seed(outcomes: readonly CatalogOutcome[]) { for (const outcome of outcomes) this.remember(outcome.key, outcome); }

  /** Retain shared queued work and let already-started I/O finish into the cache. */
  discardQueuedOutside(keys: readonly CatalogKey[]) {
    if (!this.flights.size) return;
    const required = new Set(keys.map(keyId));
    for (const flight of this.flights.values()) {
      if (!flight.started && !required.has(keyId(flight.key)))
        flight.cancel(new CatalogLoadError('SCOPE_SUPERSEDED', 'Catalog is outside the requested scope.'));
    }
  }

  /** Apply the inactive LRU budget after desired/committed scope changes. */
  trim() {
    if (this.maxCachedCatalogs === undefined || this.cache.size <= this.maxCachedCatalogs) return;
    this.syncProtection();
    for (const id of this.evictable) {
      if (this.cache.size <= this.maxCachedCatalogs) break;
      this.cache.delete(id);
      this.evictable.delete(id);
    }
  }

  /** Rebuild candidate order once per scope, preserving the cache's global LRU order. */
  private syncProtection(): ReadonlySet<string> {
    const keys = this.protectedKeys();
    if (keys !== this.protectionSnapshot) {
      this.evictable.clear();
      for (const id of this.cache.keys()) if (!keys.has(id)) this.evictable.add(id);
      this.protectionSnapshot = keys;
    }
    return keys;
  }

  private touch(id: string, outcome: CatalogOutcome) {
    this.cache.delete(id);
    this.cache.set(id, outcome);
    if (this.maxCachedCatalogs === undefined) return;
    const keys = this.syncProtection();
    this.evictable.delete(id);
    if (!keys.has(id)) this.evictable.add(id);
  }

  private remember(key: CatalogKey, outcome: CatalogOutcome) {
    this.touch(keyId(key), outcome);
    this.trim();
  }

  invalidate() {
    const current = this.manifest();
    for (const [id, outcome] of this.cache) {
      if (stamp(outcome.sessionId, outcome) !== stamp(current.sessionId, metadata(current, outcome.key))) {
        this.cache.delete(id);
        this.evictable.delete(id);
      }
    }
    for (const flight of this.flights.values()) {
      if (flight.version !== stamp(current.sessionId, metadata(current, flight.key)))
        flight.cancel(new CatalogLoadError('STALE_CATALOG', 'Catalog changed while it was loading.'));
    }
  }

  stop(reason: Error) {
    for (const flight of this.flights.values()) flight.cancel(reason);
    this.cache.clear();
    this.evictable.clear();
    this.protectionSnapshot = undefined;
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
    const now = this.now;
    const startedAt = now?.() ?? 0;
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
    const flight: Flight = { key, version, promise, started: false, cancel: reason => {
      if (done) return;
      finish();
      reject(reason);
      controller.abort(reason);
    } };
    const timeout = () => {
      const error = new CatalogLoadError('TIMEOUT',
        `Catalog ${key.locale}/${key.namespace} did not load within ${this.timeoutMs}ms.`);
      flight.cancel(error);
      return error;
    };
    const expireIfDue = () => {
      if (now && now() - startedAt >= this.timeoutMs) return timeout();
    };
    const cancelTimer = this.schedule(this.timeoutMs, timeout);
    this.flights.set(version, flight);
    // Timer callbacks can run after microtasks that dispatch or settle source I/O.
    this.queue.run(signal => {
      const expired = expireIfDue();
      if (expired) throw expired;
      flight.started = true;
      return this.source.loadCatalog(key.locale, key.namespace, signal);
    }, controller.signal).then(result => {
      if (done || expireIfDue()) return;
      try {
        if (!result || result.status === 'failed') throw new CatalogLoadError(result?.code ?? 'INVALID_RESULT', result?.message ?? 'Invalid catalog load result.');
        const accepted = acceptOutcome(this.manifest(), key, result);
        // Validation and snapshotting can cross the deadline while timers are blocked.
        if (done || expireIfDue()) return;
        this.remember(key, accepted);
        finish();
        resolve(accepted);
      } catch (error) {
        if (done || expireIfDue()) return;
        finish();
        reject(error);
      }
    }, error => {
      if (done || expireIfDue()) return;
      finish();
      reject(new CatalogLoadError('LOAD_FAILED', `Catalog ${key.locale}/${key.namespace} failed to load.`, { cause: error }));
    });
    return promise;
  }
}
