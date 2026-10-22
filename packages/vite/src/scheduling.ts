/** Timers are deferred; cancellation remains valid after a callback has fired. */
export type Schedule = (milliseconds: number, callback: () => void) => () => void;

export const schedule: Schedule = (milliseconds, callback) => {
  const timer = setTimeout(callback, milliseconds);
  return () => clearTimeout(timer);
};

export const createRequestId = () => crypto.getRandomValues(new Uint32Array(4)).join('-');

export function timeoutDuration(value = 5000): number {
  if (!Number.isFinite(value) || value <= 0 || value > 2147483647)
    throw new RangeError('requestTimeoutMs must be a positive timer duration.');
  return Math.ceil(value);
}
