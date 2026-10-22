import { DEFAULT_CATALOG_REQUEST_TIMEOUT_MS, MAX_TIMER_DURATION_MS } from './loading-policy.js';
import { CatalogLoadError } from './loading-errors.js';
import type { CatalogSchedule } from './loading-types.js';

export const scheduleCatalog: CatalogSchedule = (milliseconds, callback) => {
  const timer = setTimeout(callback, milliseconds);
  return () => clearTimeout(timer);
};

export function timeoutDuration(value = DEFAULT_CATALOG_REQUEST_TIMEOUT_MS): number {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DURATION_MS)
    throw new RangeError('requestTimeoutMs must be a positive timer duration.');
  return Math.ceil(value);
}

export const aborted = (signal: AbortSignal) => new CatalogLoadError('ABORTED', 'Catalog request was cancelled.', { cause: signal.reason });

export function nextRevision(current: number): number {
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER)
    throw new CatalogLoadError('REVISION_OVERFLOW', 'Create a new i18n instance before the state revision exceeds the safe integer range.');
  return current + 1;
}
