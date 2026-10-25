import { decodeCatalog, encodeCatalog } from '@0disoft/saylo-core';
import type { CatalogLoadResult, CompactCatalog as PackedCatalog } from '@0disoft/saylo-core';
import type { CatalogPatch, PresentCatalog } from './catalog-patch.js';

type CompactCatalog = Pick<PackedCatalog, 'sourceName' | 'schemas' | 'messages'>;
/** Keep the existing socket envelope; core owns the shared catalog representation. */
export interface CompactCatalogOutcome extends Omit<PresentCatalog, 'status' | 'catalog'> {
  readonly status: 'compact';
  readonly encoding: 'saylo-catalog-v1';
  readonly catalog: CompactCatalog;
}
export type CatalogWireResult = CatalogLoadResult | CatalogPatch | CompactCatalogOutcome;
const cache = new WeakMap<PackedCatalog, CompactCatalog>();

export function encodeCatalogResult(result: CatalogLoadResult | CatalogPatch): CatalogWireResult {
  if (result.status !== 'present') return result;
  const packed = encodeCatalog(result.catalog);
  let catalog = cache.get(packed);
  if (!catalog) {
    catalog = { sourceName: packed.sourceName, schemas: packed.schemas, messages: packed.messages };
    cache.set(packed, catalog);
  }
  return { status: 'compact', encoding: 'saylo-catalog-v1', sessionId: result.sessionId, key: result.key,
    catalogVersion: result.catalogVersion, namespaceSchemaFingerprint: result.namespaceSchemaFingerprint, catalog };
}

export function decodeCatalogResult(result: CatalogWireResult): CatalogLoadResult | CatalogPatch {
  if (result?.status !== 'compact') return result;
  try {
    if (result.encoding !== 'saylo-catalog-v1' || !result.key || typeof result.key.locale !== 'string'
        || typeof result.key.namespace !== 'string' || typeof result.sessionId !== 'string' || !result.sessionId
        || !Number.isSafeInteger(result.catalogVersion) || result.catalogVersion < 1
        || typeof result.namespaceSchemaFingerprint !== 'string' || !result.namespaceSchemaFingerprint) throw new Error('Invalid envelope.');
    const catalog = decodeCatalog({ ...result.catalog, format: 'saylo-catalog-v1', locale: result.key.locale, namespace: result.key.namespace });
    return { status: 'present', sessionId: result.sessionId, key: result.key, catalogVersion: result.catalogVersion,
      namespaceSchemaFingerprint: result.namespaceSchemaFingerprint, catalog };
  } catch (cause) { throw new Error('Invalid compact catalog reply.', { cause }); }
}
