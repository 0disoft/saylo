import { CatalogLoadError } from './loading-errors.js';
import { acceptOutcome, keyId, metadata, stamp } from './loading-registry.js';
import type { CatalogKey, CatalogManifest, CatalogOutcome, CatalogSchedule, CatalogSource } from './loading-types.js';
import { scheduleCatalog } from './loading-runtime.js';

interface Flight {
  readonly key: CatalogKey;
  readonly version: string;
  readonly promise: Promise<CatalogOutcome>;
  cancel(reason: Error): void;
}

/** Dedupes pair/version loads, independently of desired-state generations. */
export class CatalogLoader {
  private readonly cache = new Map<string, CatalogOutcome>();
  private readonly flights = new Map<string, Flight>();

  constructor(private readonly source: CatalogSource, private readonly manifest: () => CatalogManifest,
    private readonly timeoutMs: number, private readonly schedule: CatalogSchedule = scheduleCatalog) {}

  seed(outcomes: readonly CatalogOutcome[]) { for (const outcome of outcomes) this.cache.set(keyId(outcome.key), outcome); }

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
    if (cached && stamp(cached.sessionId, cached) === version) return Promise.resolve(cached);
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
    // Also catches a synchronous source throw, without delaying newer desired scopes.
    Promise.resolve().then(() => {
      if (done) return undefined;
      return this.source.loadCatalog(key.locale, key.namespace, controller.signal);
    }).then(result => {
      if (done) return;
      try {
        if (!result || result.status === 'failed') throw new CatalogLoadError(result?.code ?? 'INVALID_RESULT', result?.message ?? 'Invalid catalog load result.');
        const accepted = acceptOutcome(this.manifest(), key, result);
        this.cache.set(keyId(key), accepted);
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
