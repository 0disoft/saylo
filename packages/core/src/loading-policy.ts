export const DEFAULT_CATALOG_REQUEST_TIMEOUT_MS = 5000;
export const CATALOG_LOAD_CONCURRENCY = 8;
export const MAX_TIMER_DURATION_MS = 2147483647;
// Total attempts, including the initial load. These are independent policies.
export const STALE_CATALOG_MAX_ATTEMPTS = 3;
export const SSR_STABILITY_MAX_ATTEMPTS = 3;

export function catalogCacheLimit(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError('maxCachedCatalogs must be a nonnegative safe integer.');
  return value;
}
