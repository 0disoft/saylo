export function catalogCacheLimit(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError('maxCachedCatalogs must be a nonnegative safe integer.');
  return value;
}
