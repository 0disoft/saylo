import { CatalogError, validateTranslation } from '@0disoft/saylo-core';
import type { CatalogSchema, ParsedCatalog } from '@0disoft/saylo-core';

const filtered = new WeakMap<ParsedCatalog, { fingerprint: string; catalog: ParsedCatalog }>();

/** Keep compatible messages from a previously valid translation after a base edit. */
export function quarantineTranslation(schema: CatalogSchema, catalog: ParsedCatalog): ParsedCatalog {
  const cached = filtered.get(catalog);
  if (cached?.fingerprint === schema.fingerprint) return cached.catalog;
  try { validateTranslation(schema, catalog); return catalog; }
  catch (error) {
    if (!(error instanceof CatalogError) || error.diagnostics.some(d => d.id === undefined)) throw error;
    const rejected = new Set(error.diagnostics.map(d => d.id));
    const messages = Object.freeze(Object.fromEntries(Object.entries(catalog.messages).filter(([id]) => !rejected.has(id))));
    const next = Object.freeze({ ...catalog, messages });
    validateTranslation(schema, next);
    filtered.set(catalog, { fingerprint: schema.fingerprint, catalog: next });
    return next;
  }
}
