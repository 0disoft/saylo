import { createBaseSchema } from '@saylo/core';
import type { CatalogKey, CatalogManifest, CatalogMetadata, CatalogOutcome, ParsedCatalog } from '@saylo/core';

const id = (key: CatalogKey) => JSON.stringify([key.locale, key.namespace]);
const signature = (catalog: ParsedCatalog) => JSON.stringify(Object.keys(catalog.messages).sort().map(k => [k, catalog.messages[k]!.source]));

/** Accepted registry only. Missing tombstones survive deletion and re-creation. */
export class CatalogRegistry {
  private records = new Map<string, ParsedCatalog>();
  private readonly versions = new Map<string, { key: CatalogKey; version: number }>();
  private current!: CatalogManifest;
  private revision = 0;

  constructor(private readonly sessionId: string, private readonly baseLocale: string, catalogs: readonly ParsedCatalog[]) {
    this.replace(catalogs, true);
  }

  replace(catalogs: readonly ParsedCatalog[], initial = false) {
    const next = new Map(catalogs.map(c => [id(c), c]));
    for (const key of new Set([...this.records.keys(), ...next.keys()])) {
      const before = this.records.get(key);
      const after = next.get(key);
      const known = this.versions.get(key);
      if (!known || !before || !after || (before !== after && signature(before) !== signature(after))) {
        const catalog = after ?? before!;
        this.versions.set(key, { key: { locale: catalog.locale, namespace: catalog.namespace }, version: (known?.version ?? 0) + 1 });
      }
    }
    this.records = next;
    if (!initial) this.revision++;
    const schemas = new Map(catalogs.filter(c => c.locale === this.baseLocale).map(c => [c.namespace, createBaseSchema(c).fingerprint]));
    const metadata: CatalogMetadata[] = [...this.versions].map(([key, value]) => {
      const record = this.records.get(key);
      return Object.freeze({ key: Object.freeze(value.key), catalogVersion: value.version,
        ...(record ? { status: 'present' as const, namespaceSchemaFingerprint: schemas.get(record.namespace)! } : { status: 'missing' as const }) });
    });
    this.current = Object.freeze({ sessionId: this.sessionId, registryRevision: this.revision, baseLocale: this.baseLocale,
      availableLocales: Object.freeze([...new Set(catalogs.map(c => c.locale))].sort()),
      availableNamespaces: Object.freeze([...schemas.keys()].sort()), catalogs: Object.freeze(metadata) });
  }

  manifest() { return this.current; }

  load(locale: string, namespace: string): CatalogOutcome {
    const key = { locale, namespace };
    const record = this.records.get(id(key));
    const version = this.versions.get(id(key))?.version ?? 0;
    const schema = this.current.catalogs.find(c => c.key.locale === locale && c.key.namespace === namespace);
    return Object.freeze({ sessionId: this.sessionId, key: Object.freeze(key), catalogVersion: version,
      ...(record && schema?.status === 'present' ? { status: 'present' as const, namespaceSchemaFingerprint: schema.namespaceSchemaFingerprint,
        catalog: record } : { status: 'missing' as const }) });
  }
}
