export type Schedule = (milliseconds: number, callback: () => void) => () => void;
export const schedule: Schedule = (milliseconds, callback) => {
  const timer = setTimeout(callback, milliseconds);
  return () => clearTimeout(timer);
};
export function timeoutDuration(value = 30000): number {
  if (!Number.isFinite(value) || value <= 0 || value > 2147483647)
    throw new RangeError('typegen timeoutMs must be a positive timer duration.');
  return Math.ceil(value);
}
export function deadlineError(label: string, timeoutMs: number): Error {
  return Object.assign(new Error(`${label} timed out after ${timeoutMs}ms.`), { code: 'TIMEOUT' });
}

/** A deadline bounds reporting; the caller still owns the underlying operation. */
export async function withinDeadline<T>(pending: Promise<T>, timeoutMs: number, later: Schedule,
  label: string, controller?: AbortController): Promise<T> {
  let cancel = () => {};
  const timeout = new Promise<never>((_resolve, reject) => {
    cancel = later(timeoutMs, () => {
      const error = deadlineError(label, timeoutMs);
      controller?.abort(error);
      reject(error);
    });
  });
  try { return await Promise.race([pending, timeout]); }
  finally { cancel(); }
}
