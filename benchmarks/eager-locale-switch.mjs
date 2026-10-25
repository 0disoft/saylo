import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createStore, parseCatalog } from '@0disoft/saylo-core';

// Run after building core: node benchmarks/eager-locale-switch.mjs [messages=10000] [samples=50]
const count = Number(process.argv[2] ?? 10000), samples = Number(process.argv[3] ?? 50);
if (![count, samples].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Expected positive integers.');
const catalogs = ['ko', 'en'].map(locale => parseCatalog(JSON.stringify(Object.fromEntries(
  Array.from({ length: count }, (_, index) => [`key${index}`, `${locale} message ${index} for {name}`]))),
{ locale, namespace: 'common' }));
const store = createStore({ catalogs, baseLocale: 'ko', locale: 'ko' });
const initial = store.getSnapshot();
const maps = new Set(catalogs.map(catalog => catalog.messages));
const nativeKeys = Object.keys;
let enumerations = 0, enumeratedKeys = 0;
try {
  for (let index = 0; index < 5; index++) store.setLocale(store.getSnapshot().locale === 'ko' ? 'en' : 'ko');
  Object.keys = value => {
    const keys = nativeKeys(value);
    if (maps.has(value)) { enumerations++; enumeratedKeys += keys.length; }
    return keys;
  };
  const durations = [];
  for (let index = 0; index < samples; index++) {
    const start = performance.now();
    store.setLocale(store.getSnapshot().locale === 'ko' ? 'en' : 'ko');
    durations.push(performance.now() - start);
    assert.equal(store.t('common:key0', { name: 'Ada' }), `${store.getSnapshot().locale} message 0 for Ada`);
  }
  assert.equal(initial.t('common:key0', { name: 'Ada' }), 'ko message 0 for Ada');
  assert.equal(store.getSnapshot().stateRevision, samples + 5);
  durations.sort((a, b) => a - b);
  console.log(JSON.stringify({ messagesPerLocale: count, locales: catalogs.length, samples,
    medianMs: durations[Math.floor(samples / 2)], p95Ms: durations[Math.ceil(samples * .95) - 1],
    messageMapEnumerations: enumerations, enumeratedKeys }));
} finally { Object.keys = nativeKeys; store.dispose(); }
