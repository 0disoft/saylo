import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createBaseSchema, createI18n, parseCatalog, validateCatalogManifest } from '@0disoft/saylo-core';

// Run after building core: node benchmarks/manifest-refresh.mjs [namespaces=1000] [samples=50]
const namespaceCount = Number(process.argv[2] ?? 1000), samples = Number(process.argv[3] ?? 50);
if (![namespaceCount, samples].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Expected positive integers.');
const locales = ['ko', 'en', 'fr', 'de', 'es', 'it', 'ja', 'zh', 'pt', 'ar', 'ru', 'nl', 'sv', 'da', 'fi', 'pl', 'cs', 'tr', 'uk', 'vi'];
const namespaces = ['common', ...Array.from({ length: namespaceCount - 1 }, (_, index) => `page${index}`)];
const catalog = parseCatalog('{"title":"Hello"}', { locale: 'ko', namespace: 'common' });
const fingerprint = createBaseSchema(catalog).fingerprint;
const manifest = validateCatalogManifest({ sessionId: 'benchmark', registryRevision: 1, baseLocale: 'ko',
  availableLocales: locales, availableNamespaces: namespaces,
  catalogs: namespaces.flatMap(namespace => locales.map(locale => ({ key: { locale, namespace }, status: 'present',
    catalogVersion: 1, namespaceSchemaFingerprint: fingerprint }))) });
let sourceLoads = 0;
const source = { readManifest: () => manifest, loadCatalog: async () => { sourceLoads++; throw new Error('Unexpected I/O'); } };
const i18n = createI18n({ catalogSource: source, locale: 'ko', initialNamespaces: ['common'],
  initialCatalogs: [{ sessionId: manifest.sessionId, key: { locale: 'ko', namespace: 'common' }, status: 'present',
    catalogVersion: 1, namespaceSchemaFingerprint: fingerprint, catalog }] });
const initial = i18n.getSnapshot();
const stringify = JSON.stringify;
const manifestBytes = Buffer.byteLength(stringify(manifest));
let serializations = 0;
try {
  for (let index = 0; index < 5; index++) await i18n.refresh();
  JSON.stringify = function (value, ...args) {
    if (value === manifest) serializations++;
    return stringify(value, ...args);
  };
  const durations = [];
  for (let index = 0; index < samples; index++) {
    const start = performance.now();
    await i18n.refresh();
    durations.push(performance.now() - start);
  }
  assert.equal(i18n.getSnapshot(), initial);
  assert.equal(i18n.t('common:title'), 'Hello');
  assert.equal(sourceLoads, 0);
  durations.sort((a, b) => a - b);
  console.log(stringify({ manifestEntries: manifest.catalogs.length, manifestBytes, samples,
    medianMs: durations[Math.floor(samples / 2)], p95Ms: durations[Math.ceil(samples * .95) - 1],
    manifestSerializationsPerRefresh: serializations / samples,
    manifestSerializedBytesPerRefresh: manifestBytes * serializations / samples, sourceLoads }));
} finally { JSON.stringify = stringify; i18n.dispose(); }
