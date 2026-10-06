import { freeze } from './diagnostics.js';
import { CatalogLoadError } from './loading-errors.js';
import { createBaseSchema } from './schema.js';
import { createBoundTranslator } from './translator.js';
import { createLoadedSignature } from './snapshot-signature.js';
import { NamespaceNotLoadedError, UnknownMessageError } from './translation-errors.js';
import type { createTextFormatter } from './formatters.js';
import type { CatalogKey, CatalogManifest, CatalogMetadata, CatalogOutcome } from './loading-types.js';
import type { Schema, StoreSnapshot, Translate } from './types.js';

export function canonicalLocale(value: string): string {
  const locale = Intl.getCanonicalLocales(value)[0];
  if (!locale) throw new RangeError('Locale must not be empty.');
  return locale;
}

export function assertNamespace(value: string) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[:/\\\x00-\x1f]/.test(value))
    throw new RangeError('Namespace must be a nonempty filename without colons or path separators.');
}

export const keyId = (key: CatalogKey) => JSON.stringify([key.locale, key.namespace]);
export const stamp = (sessionId: string, metadata: CatalogMetadata) => JSON.stringify([sessionId, metadata.key,
  metadata.status, metadata.catalogVersion, metadata.status === 'present' ? metadata.namespaceSchemaFingerprint : null]);
const indexes = new WeakMap<CatalogManifest, ReadonlyMap<string, CatalogMetadata>>();

export function readManifest(input: CatalogManifest): CatalogManifest {
  if (!input || !input.sessionId || typeof input.sessionId !== 'string' ||
      !Number.isSafeInteger(input.registryRevision) || input.registryRevision < 0 ||
      !Array.isArray(input.availableLocales) || !Array.isArray(input.availableNamespaces) || !Array.isArray(input.catalogs))
    throw new CatalogLoadError('INVALID_MANIFEST', 'Invalid catalog manifest.');
  const baseLocale = canonicalLocale(input.baseLocale);
  const locales = input.availableLocales.map(canonicalLocale);
  const namespaces = [...input.availableNamespaces];
  namespaces.forEach(assertNamespace);
  if (baseLocale !== input.baseLocale || locales.some((l, i) => l !== input.availableLocales[i]) ||
      !locales.includes(baseLocale) || !namespaces.length ||
      new Set(locales).size !== locales.length || new Set(namespaces).size !== namespaces.length)
    throw new CatalogLoadError('INVALID_MANIFEST', 'Manifest lists must be canonical and unique, with a base locale and namespace.');
  const seen = new Set<string>();
  const catalogs = input.catalogs.map(meta => {
    if (!meta?.key || canonicalLocale(meta.key.locale) !== meta.key.locale ||
        !Number.isSafeInteger(meta.catalogVersion) || meta.catalogVersion < 0 ||
        (meta.status !== 'present' && meta.status !== 'missing'))
      throw new CatalogLoadError('INVALID_MANIFEST', 'Invalid catalog metadata.');
    assertNamespace(meta.key.namespace);
    const id = keyId(meta.key);
    if (seen.has(id)) throw new CatalogLoadError('INVALID_MANIFEST', 'Duplicate catalog metadata.');
    seen.add(id);
    const key = { locale: meta.key.locale, namespace: meta.key.namespace };
    if (meta.status === 'missing') return { key, catalogVersion: meta.catalogVersion, status: 'missing' as const };
    if (!locales.includes(key.locale) || !namespaces.includes(key.namespace) ||
        typeof meta.namespaceSchemaFingerprint !== 'string' || !meta.namespaceSchemaFingerprint)
      throw new CatalogLoadError('INVALID_MANIFEST', 'Present metadata needs an available pair and schema fingerprint.');
    return { key, catalogVersion: meta.catalogVersion, status: 'present' as const, namespaceSchemaFingerprint: meta.namespaceSchemaFingerprint };
  });
  const index = new Map(catalogs.map(c => [keyId(c.key), c]));
  for (const namespace of namespaces) {
    const base = index.get(keyId({ locale: baseLocale, namespace }));
    if (base?.status !== 'present') throw new CatalogLoadError('INVALID_MANIFEST', 'Every namespace needs present base metadata.');
  }
  for (const catalog of catalogs) if (catalog.status === 'present') {
    const base = index.get(keyId({ locale: baseLocale, namespace: catalog.key.namespace }));
    if (base?.status !== 'present' || catalog.namespaceSchemaFingerprint !== base.namespaceSchemaFingerprint)
      throw new CatalogLoadError('INVALID_MANIFEST', 'Every present pair must reference its current base namespace schema.');
  }
  catalogs.sort((a, b) => keyId(a.key).localeCompare(keyId(b.key)));
  const manifest = freeze({ sessionId: input.sessionId, registryRevision: input.registryRevision, baseLocale,
    availableLocales: locales.sort(), availableNamespaces: namespaces.sort(), catalogs });
  indexes.set(manifest, index);
  return manifest;
}

export function metadata(manifest: CatalogManifest, key: CatalogKey): CatalogMetadata {
  return indexes.get(manifest)?.get(keyId(key)) ?? { key, status: 'missing', catalogVersion: 0 };
}

export function assertManifestTransition(previous: CatalogManifest, next: CatalogManifest) {
  if (previous.sessionId !== next.sessionId) return;
  for (const before of previous.catalogs) {
    const after = metadata(next, before.key);
    if (after.catalogVersion < before.catalogVersion ||
        (after.catalogVersion === before.catalogVersion && after.status !== before.status))
      throw new CatalogLoadError('STALE_MANIFEST', 'Known pair versions and missing tombstones must not move backwards.');
    if (before.status === 'present' && after.status === 'present' && before.catalogVersion === after.catalogVersion &&
        before.namespaceSchemaFingerprint !== after.namespaceSchemaFingerprint) {
      const baseKey = { locale: previous.baseLocale, namespace: before.key.namespace };
      const oldBase = metadata(previous, baseKey);
      const newBase = metadata(next, baseKey);
      if (before.key.locale === previous.baseLocale || oldBase.status !== 'present' || newBase.status !== 'present' ||
          oldBase.namespaceSchemaFingerprint === newBase.namespaceSchemaFingerprint)
        throw new CatalogLoadError('INVALID_MANIFEST', 'A schema stamp changed without a newer base catalog.');
    }
  }
}

export function scopeKeys(manifest: CatalogManifest, locale: string, namespaces: readonly string[]): CatalogKey[] {
  return namespaces.flatMap(namespace => [...new Set([manifest.baseLocale, locale])].map(locale => ({ locale, namespace })));
}

export function acceptOutcome(manifest: CatalogManifest, key: CatalogKey, outcome: CatalogOutcome): CatalogOutcome {
  const expected = metadata(manifest, key);
  if (!outcome || outcome.sessionId !== manifest.sessionId || !outcome.key || keyId(outcome.key) !== keyId(key) ||
      outcome.status !== expected.status || outcome.catalogVersion !== expected.catalogVersion ||
      (outcome.status === 'present' && (expected.status !== 'present' ||
        outcome.namespaceSchemaFingerprint !== expected.namespaceSchemaFingerprint)))
    throw new CatalogLoadError('STALE_CATALOG', 'Catalog outcome does not match the current pair version or session.');
  if (outcome.status === 'present') {
    if (!outcome.catalog || outcome.catalog.locale !== key.locale || outcome.catalog.namespace !== key.namespace)
      throw new CatalogLoadError('INVALID_CATALOG', 'Catalog payload does not match the requested pair.');
    if (key.locale === manifest.baseLocale && createBaseSchema(outcome.catalog).fingerprint !== outcome.namespaceSchemaFingerprint)
      throw new CatalogLoadError('INVALID_SCHEMA', 'Base catalog payload does not match its schema fingerprint.');
  }
  return freeze({ ...outcome, key: { ...key } });
}

export function createLoadedSnapshot<S extends Schema>(manifest: CatalogManifest, locale: string,
  namespaces: readonly string[], outcomes: readonly CatalogOutcome[], timeZone: string,
  formatter: ReturnType<typeof createTextFormatter>, stateRevision: number): { snapshot: StoreSnapshot<S>; signature: string } {
  const catalogs = outcomes.filter(o => o.status === 'present').map(o => o.catalog);
  const bases = catalogs.filter(c => c.locale === manifest.baseLocale);
  // Schema compatibility is checked atomically by the translator, after all pairs finish.
  const bound = bases.length ? createBoundTranslator<S>({ locale, timeZone, baseCatalogs: bases,
    translations: locale === manifest.baseLocale ? [] : catalogs.filter(c => c.locale === locale) }, formatter) : undefined;
  const translate = (key: string, args?: Record<string, unknown>) => {
    if (typeof key !== 'string') throw new UnknownMessageError(String(key));
    const separator = key.indexOf(':');
    if (separator <= 0 || separator === key.length - 1 || key.indexOf(':', separator + 1) !== -1) throw new UnknownMessageError(key);
    const namespace = key.slice(0, separator);
    if (!manifest.availableNamespaces.includes(namespace)) throw new UnknownMessageError(key);
    if (!namespaces.includes(namespace)) throw new NamespaceNotLoadedError(namespace, key);
    return (bound!.t as Translate<Schema>)(key, args);
  };
  const signature = createLoadedSignature(manifest, locale, namespaces, catalogs);
  return { signature, snapshot: Object.freeze({ locale, baseLocale: manifest.baseLocale, timeZone, t: translate as Translate<S>,
    stateRevision, availableLocales: manifest.availableLocales, availableNamespaces: manifest.availableNamespaces,
    loadedNamespaces: Object.freeze([...namespaces]) }) };
}
