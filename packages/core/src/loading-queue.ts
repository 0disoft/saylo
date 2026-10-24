import { CATALOG_LOAD_CONCURRENCY } from './loading-policy.js';

/** One loader owns the queue, across scope changes and manifest generations. */
export class CatalogLoadQueue {
  private active = 0;
  private readonly pending = new Set<() => void>();

  run<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => signal.removeEventListener('abort', abort);
      const abort = () => { this.pending.delete(start); cleanup(); reject(signal.reason); };
      const start = () => {
        this.active++;
        void Promise.resolve().then(() => {
          signal.throwIfAborted();
          return operation();
        }).then(resolve, reject).finally(() => {
          // An ignored abort must not admit more I/O before the source settles.
          cleanup(); this.active--; this.drain();
        });
      };
      signal.addEventListener('abort', abort, { once: true });
      this.pending.add(start);
      this.drain();
    });
  }

  private drain() {
    while (this.active < CATALOG_LOAD_CONCURRENCY && this.pending.size) {
      const start = this.pending.values().next().value!;
      this.pending.delete(start);
      start();
    }
  }
}
