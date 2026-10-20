import type { CatalogKey, CatalogManifest, CatalogMetadata, CatalogOutcome } from '@0disoft/saylo-core';
import { freezeCatalogs } from './freeze.js';

export const catalogId = (key: CatalogKey) => JSON.stringify([key.locale, key.namespace]);

const indexes = new WeakMap<CatalogManifest, ReadonlyMap<string, CatalogMetadata>>();

/** Internal callers supply immutable manifests from validation or CatalogRegistry. */
export function catalogMetadata(manifest: CatalogManifest): ReadonlyMap<string, CatalogMetadata> {
  let index = indexes.get(manifest);
  if (!index) {
    index = new Map(manifest.catalogs.map(meta => [catalogId(meta.key), meta]));
    indexes.set(manifest, index);
  }
  return index;
}

export function matches(manifest: CatalogManifest, result: CatalogOutcome) {
  const known = catalogMetadata(manifest).get(catalogId(result.key));
  return result.sessionId === manifest.sessionId && result.catalogVersion === (known?.catalogVersion ?? 0) &&
    result.status === (known?.status ?? 'missing') && (result.status !== 'present' ||
      (known?.status === 'present' && result.namespaceSchemaFingerprint === known.namespaceSchemaFingerprint));
}

export function immutable(result: CatalogOutcome): CatalogOutcome {
  if (result.status === 'present') freezeCatalogs([result.catalog]);
  return Object.freeze({ ...result, key: Object.freeze({ ...result.key }) });
}
