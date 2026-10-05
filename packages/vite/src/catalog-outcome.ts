import type { CatalogKey, CatalogManifest, CatalogOutcome } from '@0disoft/saylo-core';
import { freezeCatalogs } from './freeze.js';

export const catalogId = (key: CatalogKey) => JSON.stringify([key.locale, key.namespace]);

export function matches(manifest: CatalogManifest, result: CatalogOutcome) {
  const known = manifest.catalogs.find(meta => catalogId(meta.key) === catalogId(result.key));
  return result.sessionId === manifest.sessionId && result.catalogVersion === (known?.catalogVersion ?? 0) &&
    result.status === (known?.status ?? 'missing') && (result.status !== 'present' ||
      (known?.status === 'present' && result.namespaceSchemaFingerprint === known.namespaceSchemaFingerprint));
}

export function immutable(result: CatalogOutcome): CatalogOutcome {
  if (result.status === 'present') freezeCatalogs([result.catalog]);
  return Object.freeze({ ...result, key: Object.freeze({ ...result.key }) });
}
