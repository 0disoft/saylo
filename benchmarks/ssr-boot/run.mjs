import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const counter = Symbol.for('saylo.ssr-boot-benchmark.builds');
globalThis[counter] = 0;
const hook = registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (!url.endsWith('/packages/core/dist/boot.js')) return result;
  const signature = 'export function createBootSnapshot(input) {';
  const source = String(result.source);
  assert.ok(source.includes(signature), 'Rebuild core before running the benchmark.');
  return { ...result, source: source.replace(signature,
    `${signature}\nglobalThis[Symbol.for('saylo.ssr-boot-benchmark.builds')]++;`) };
} });
const { createBaseSchema, createServerI18n, parseCatalog, serializeBootSnapshot } = await import('@0disoft/saylo-core');

const count = 10000;
const values = Object.fromEntries(Array.from({ length: count }, (_, index) =>
  [`item${index}`, `Item ${index}: {n, number} for {name}`]));
const catalogs = ['ko', 'en'].map(locale => parseCatalog(JSON.stringify(values),
  { locale, namespace: 'common', sourceName: `${locale}/common.json` }));
const fingerprint = createBaseSchema(catalogs[0]).fingerprint;
const outcomes = catalogs.map(catalog => ({ status: 'present', sessionId: 'ssr-benchmark',
  key: { locale: catalog.locale, namespace: 'common' }, catalogVersion: 1,
  namespaceSchemaFingerprint: fingerprint, catalog }));
const manifest = { sessionId: 'ssr-benchmark', registryRevision: 1, baseLocale: 'ko',
  availableLocales: ['ko', 'en'], availableNamespaces: ['common'],
  catalogs: outcomes.map(({ catalog, sessionId, ...metadata }) => metadata) };
const source = { readManifest: () => manifest,
  loadCatalog: async locale => outcomes.find(outcome => outcome.key.locale === locale) };
const samples = [], snapshotBuilds = [];
let wireBytes = 0;
for (let round = 0; round < 4; round++) {
  globalThis.gc?.();
  globalThis[counter] = 0;
  let instance;
  const start = performance.now();
  try {
    instance = await createServerI18n({ catalogSource: source, locale: 'en', initialNamespaces: ['common'], timeZone: 'UTC' });
    const wire = serializeBootSnapshot(instance.getBootSnapshot());
    const elapsed = performance.now() - start;
    if (round) { samples.push(elapsed); snapshotBuilds.push(globalThis[counter]); }
    wireBytes = Buffer.byteLength(wire);
    assert.equal(Object.keys(JSON.parse(wire).baseSchemas[0].keys).length, count);
    assert.equal(instance.t('common:item0', { n: 2, name: 'Saylo' }), 'Item 0: 2 for Saylo');
  } finally { instance?.dispose(); }
}
hook.deregister();
console.log(JSON.stringify({ label: process.argv[2] ?? 'current', node: process.version, messagesPerLocale: count,
  locales: 2, warmup: 1, samplesMs: samples, p50Ms: [...samples].sort((a, b) => a - b)[1],
  snapshotBuilds, wireBytes }, null, 2));
