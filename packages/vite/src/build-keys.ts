import type { ParsedCatalog, ParsedMessage } from '@0disoft/saylo-core';

/** Copy configuration once; later caller mutations cannot change build output. */
export function readIncludedKeys(value: readonly string[] | undefined): readonly string[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new TypeError('includeKeys must be an array of namespace:messageId strings.');
  const seen = new Set<string>();
  for (const key of value) {
    if (typeof key !== 'string' || !/^[^:]+:[^:]+$/.test(key))
      throw new TypeError('includeKeys entries must have exactly one colon between a namespace and message ID.');
    if (seen.has(key)) throw new RangeError(`includeKeys contains a duplicate key: ${JSON.stringify(key)}.`);
    seen.add(key);
  }
  return Object.freeze([...seen]);
}

/** Source validation precedes this projection. Locale/namespace topology stays intact. */
export function selectBuildCatalogs(catalogs: readonly ParsedCatalog[], baseLocale: string,
  keys: readonly string[] | undefined): readonly ParsedCatalog[] {
  if (keys === undefined) return catalogs;
  const available = new Set(catalogs.filter(catalog => catalog.locale === baseLocale)
    .flatMap(catalog => Object.keys(catalog.messages).map(id => `${catalog.namespace}:${id}`)));
  const missing = keys.filter(key => !available.has(key));
  if (missing.length) throw new RangeError(`includeKeys contains keys absent from the base catalogs: ${missing.map(key => JSON.stringify(key)).join(', ')}.`);
  const selected = new Set(keys);
  return Object.freeze(catalogs.map(catalog => {
    const messages: Record<string, ParsedMessage> = Object.create(null);
    for (const id of Object.keys(catalog.messages)) {
      if (selected.has(`${catalog.namespace}:${id}`)) messages[id] = catalog.messages[id]!;
    }
    return Object.freeze({ ...catalog, messages: Object.freeze(messages) });
  }));
}
