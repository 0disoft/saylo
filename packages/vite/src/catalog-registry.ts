import { createBaseSchema } from '@0disoft/saylo-core';
import type { CatalogKey, CatalogManifest, CatalogMetadata, CatalogOutcome, ParsedCatalog } from '@0disoft/saylo-core';
import { createCatalogPatch } from './catalog-patch.js';
import type { CatalogPatch, CatalogStamp } from './catalog-patch.js';
import { catalogId as id, catalogMetadata } from './catalog-outcome.js';

const PATCH_DENSITY_POLICY = Object.freeze({ changedCountFloor: 8, changedFraction: 0.5 });

// Positions belong to the version too, so a delta always has an exact baseline.
function equivalent(before: ParsedCatalog, after: ParsedCatalog) {
  if (before.sourceName !== after.sourceName || Object.keys(before.messages).length !== Object.keys(after.messages).length) return false;
  for (const key in after.messages) {
    if (!Object.hasOwn(after.messages, key)) continue;
    const previous = Object.hasOwn(before.messages, key) ? before.messages[key] : undefined;
    const message = after.messages[key]!;
    if (!previous || previous.source !== message.source || JSON.stringify(previous.richTextTags) !== JSON.stringify(message.richTextTags) || previous.position.offset !== message.position.offset ||
        previous.position.line !== message.position.line || previous.position.column !== message.position.column) return false;
  }
  return true;
}

/** Accepted registry only. Missing tombstones survive deletion and re-creation. */
export class CatalogRegistry {
  private records = new Map<string, ParsedCatalog>();
  private previous = new Map<string, { version: number; catalog: ParsedCatalog }>();
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
      if (!known || !before || !after || (before !== after && !equivalent(before, after))) {
        if (known && before && after) this.previous.set(key, { version: known.version, catalog: before });
        else this.previous.delete(key);
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

  loadDelta(locale: string, namespace: string, known?: CatalogStamp): CatalogOutcome | CatalogPatch {
    const outcome = this.load(locale, namespace);
    if (!known || known.sessionId !== this.sessionId || outcome.status !== 'present') return outcome;
    const previous = this.previous.get(id(outcome.key));
    const baseline = known.catalogVersion === outcome.catalogVersion ? outcome.catalog :
      previous?.version === known.catalogVersion ? previous.catalog : undefined;
    if (!baseline) return outcome;
    const patch = createCatalogPatch(baseline, outcome, known);
    // Dense changes are cheaper and simpler as a full replacement.
    return patch.upsert.length + patch.remove.length > Math.max(PATCH_DENSITY_POLICY.changedCountFloor, patch.messageCount * PATCH_DENSITY_POLICY.changedFraction) ? outcome : patch;
  }

  load(locale: string, namespace: string): CatalogOutcome {
    const key = { locale, namespace };
    const pair = id(key);
    const record = this.records.get(pair);
    const version = this.versions.get(pair)?.version ?? 0;
    const schema = catalogMetadata(this.current).get(pair);
    return Object.freeze({ sessionId: this.sessionId, key: Object.freeze(key), catalogVersion: version,
      ...(record && schema?.status === 'present' ? { status: 'present' as const, namespaceSchemaFingerprint: schema.namespaceSchemaFingerprint,
        catalog: record } : { status: 'missing' as const }) });
  }
}
