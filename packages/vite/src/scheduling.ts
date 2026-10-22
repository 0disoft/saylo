import { DEFAULT_DEV_REQUEST_TIMEOUT_MS, MAX_TIMER_DURATION_MS } from './dev-policy.js';

/** Timers are deferred; cancellation remains valid after a callback has fired. */
export type Schedule = (milliseconds: number, callback: () => void) => () => void;

export interface DevRuntime {
  readonly schedule?: Schedule;
  /** Return a unique connection identity; shared sockets require distinct IDs. */
  readonly createId?: () => string;
}

export const schedule: Schedule = (milliseconds, callback) => {
  const timer = setTimeout(callback, milliseconds);
  return () => clearTimeout(timer);
};

export const createRequestId = () => crypto.getRandomValues(new Uint32Array(4)).join('-');

export function timeoutDuration(value = DEFAULT_DEV_REQUEST_TIMEOUT_MS): number {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DURATION_MS)
    throw new RangeError('requestTimeoutMs must be a positive timer duration.');
  return Math.ceil(value);
}
