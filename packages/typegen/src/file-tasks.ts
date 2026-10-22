export const FILE_IO_CONCURRENCY = 8;

/** An aborted caller releases its wait, but a running OS operation retains its slot. */
export class FileTaskQueue {
  private active = 0;
  private pending = new Set<() => void>();
  constructor(private readonly concurrency = FILE_IO_CONCURRENCY) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new RangeError('File concurrency must be a positive integer.');
  }
  run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const abort = () => { this.pending.delete(start); cleanup(); reject(signal?.reason); };
      const start = () => {
        this.active++;
        void Promise.resolve().then(() => { signal?.throwIfAborted(); return operation(); }).then(value => {
          cleanup(); resolve(value);
        }, error => { cleanup(); reject(error); }).then(() => { this.active--; this.drain(); });
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.add(start);
      this.drain();
    });
  }
  private drain() {
    while (this.active < this.concurrency && this.pending.size) {
      const start = this.pending.values().next().value!;
      this.pending.delete(start); start();
    }
  }
}

/** Bounded file work with input-order results/errors and no detached active tasks. */
export async function mapFileTasks<T, R>(items: readonly T[], operation: (item: T, index: number) => Promise<R>,
  options: { readonly concurrency?: number; readonly signal?: AbortSignal } = {}): Promise<R[]> {
  const concurrency = options.concurrency ?? FILE_IO_CONCURRENCY;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new RangeError('File concurrency must be a positive integer.');
  options.signal?.throwIfAborted();
  const results = new Array<R>(items.length);
  const failures = new Map<number, unknown>();
  let next = 0, firstFailure = items.length;
  async function work() {
    while (next < firstFailure && !options.signal?.aborted) {
      const index = next++;
      try { results[index] = await operation(items[index]!, index); }
      catch (error) { failures.set(index, error); firstFailure = Math.min(firstFailure, index); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => work()));
  options.signal?.throwIfAborted();
  if (failures.size) throw failures.get(firstFailure);
  return results;
}
