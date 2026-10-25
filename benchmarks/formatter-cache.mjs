import { performance } from 'node:perf_hooks';
import { createTranslator, parseCatalog } from '@0disoft/saylo-core';

// Run after building core: node benchmarks/formatter-cache.mjs
const results = [];
for (const [literalLength, iterations] of [[80, 100000], [32768, 5000]]) {
  const catalog = parseCatalog(JSON.stringify({ hello: 'x'.repeat(literalLength) + ' {name}' }), { locale: 'en', namespace: 'common' });
  const { t } = createTranslator({ locale: 'en', baseCatalogs: [catalog] });
  for (let i = 0; i < 1000; i++) t('common:hello', { name: 'Saylo' });
  const milliseconds = [];
  let length = 0;
  for (let trial = 0; trial < 5; trial++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) length = t('common:hello', { name: 'Saylo' }).length;
    milliseconds.push(performance.now() - start);
  }
  if (length !== literalLength + 6) throw new Error('Unexpected translation output');
  const sorted = [...milliseconds].sort((a, b) => a - b);
  results.push({ literalLength, iterations, medianMs: Number(sorted[2].toFixed(2)), milliseconds: milliseconds.map(ms => Number(ms.toFixed(2))) });
}
console.log(JSON.stringify({ node: process.version, results }, null, 2));
