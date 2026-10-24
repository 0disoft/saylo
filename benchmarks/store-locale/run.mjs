import { performance } from 'node:perf_hooks';
import { createStore, parseCatalog } from '@0disoft/saylo-core';

const warmup = 5, samples = 25;

function measure(keysPerCatalog) {
  const source = JSON.stringify(Object.fromEntries(Array.from({ length: keysPerCatalog },
    (_, i) => [`key${i}`, `Message ${i} {name}`])));
  const catalogs = ['en', 'ko'].map(locale => parseCatalog(source, { locale, namespace: 'common' }));
  const store = createStore({ baseLocale: 'en', locale: 'ko', catalogs });
  const before = store.getSnapshot(), messageMaps = new Set(catalogs.map(c => c.messages));
  const nativeKeys = Object.keys, times = [];
  let messageEnumerations = 0, notifications = 0;
  store.subscribe(() => notifications++);
  try {
    for (let i = 0; i < warmup; i++) store.setLocale('ko');
    Object.keys = value => {
      if (messageMaps.has(value)) messageEnumerations++;
      return nativeKeys(value);
    };
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      store.setLocale('ko');
      times.push(performance.now() - start);
    }
  } finally { Object.keys = nativeKeys; store.dispose(); }
  times.sort((a, b) => a - b);
  return { keysPerCatalog, catalogs: catalogs.length, messageEnumerations, notifications,
    snapshotStable: store.getSnapshot() === before, p50Ms: times[Math.floor(samples / 2)],
    p95Ms: times[Math.ceil(samples * 0.95) - 1] };
}

console.log(JSON.stringify({ node: process.version, operation: 'setLocale(currentLocale)', warmup, samples,
  results: [100, 10000].map(measure) }, null, 2));
