import { rename } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const WINDOWS_REPLACE_POLICY = Object.freeze({ maxRetries: 5, initialRetryMs: 20 });

interface Operations {
  readonly platform: NodeJS.Platform;
  readonly rename: typeof rename;
  readonly wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

const operations: Operations = { platform: process.platform, rename,
  wait: (milliseconds, signal) => setTimeout(milliseconds, undefined, signal ? { signal } : {}) };

function waitForRetry(wait: Operations['wait'], milliseconds: number, signal?: AbortSignal): Promise<boolean> {
  if (!signal) return wait(milliseconds).then(() => true);
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (value: boolean) => { if (!done) { done = true; signal.removeEventListener('abort', abort); resolve(value); } };
    const abort = () => finish(false);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    Promise.resolve().then(() => { if (!done) return wait(milliseconds, signal); }).then(() => finish(true), error => {
      if (done) return;
      if (signal.aborted) { finish(false); return; }
      done = true; signal.removeEventListener('abort', abort); reject(error);
    });
  });
}

/** Internal writer helper: preserve the old file while Windows readers briefly prevent replacement. */
export async function replaceGenerated(temp: string, target: string, isCurrent: () => boolean,
  ops: Operations = operations, signal?: AbortSignal): Promise<'written' | 'cancelled'> {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted || !isCurrent()) return 'cancelled';
    try {
      await ops.rename(temp, target);
      return 'written';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (ops.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt >= WINDOWS_REPLACE_POLICY.maxRetries) throw error;
      // Bounded exponential waits. Newer generations and stop() cancel before retrying.
      if (signal?.aborted || !isCurrent()) return 'cancelled';
      if (!await waitForRetry(ops.wait, WINDOWS_REPLACE_POLICY.initialRetryMs * 2 ** attempt, signal)) return 'cancelled';
    }
  }
}
