import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';

// Count actual message parser visits without changing the on-disk package.
const counter = Symbol.for('saylo.catalog-import-benchmark.parses');
globalThis[counter] = 0;
const hook = registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (!url.endsWith('/packages/core/dist/simple-message.js')) return result;
  const signature = 'export function parseSimpleMessage(source, pool) {';
  const source = String(result.source);
  assert.ok(source.includes(signature), 'Rebuild core before running the benchmark.');
  return { ...result, source: source.replace(signature,
    `${signature}\nglobalThis[Symbol.for('saylo.catalog-import-benchmark.parses')]++;`) };
} });
const { parseCatalog } = await import('@0disoft/saylo-core');
const { analyzeCatalogs } = await import('../../packages/typegen/dist/catalog-audit.js');
const { createReviewBaseline } = await import('../../packages/typegen/dist/catalog-review.js');
const { planTranslationImport } = await import('../../packages/typegen/dist/catalog-import.js');

const count = 10000;
const root = path.join(os.tmpdir(), 'saylo-import-benchmark'); // Pure planning; no filesystem writes.
const baseValues = Object.fromEntries(Array.from({ length: count }, (_, i) => [`item${i}`, `{n, number} items for {name} ${i}`]));
const targetValues = Object.fromEntries(Object.keys(baseValues).map(id => [id,
  `{n, plural, one {# old item} other {# old items}} for {name} ${id}`]));
const files = [['ko', baseValues], ['en', targetValues]].map(([locale, values]) => {
  const source = JSON.stringify(values, null, 2) + '\n';
  const sourceName = `${locale}/common.json`;
  return { file: path.join(root, locale, 'common.json'), source,
    catalog: parseCatalog(source, { locale, namespace: 'common', sourceName }) };
});
const inspection = { root, files, localeDirectories: new Map([['ko', 'ko'], ['en', 'en']]), invalidCatalogs: [], diagnostics: [] };
const config = { localesDir: root, baseLocale: 'ko' };
const report = analyzeCatalogs(config, inspection);
assert.equal(report.summary.errors, 0);
const hashes = createReviewBaseline(inspection, 'ko').messages;
const results = [];
for (const changed of [1, count]) {
  const entries = Object.keys(baseValues).slice(0, changed).map(id => ({
    locale: 'en', namespace: 'common', id, reason: 'review', source: baseValues[id],
    sourceHash: hashes[`common:${id}`], originalTranslation: targetValues[id],
    translation: targetValues[id].replaceAll('old', 'new'),
  }));
  const work = { format: 'saylo-translation-work/v1', baseLocale: 'ko', entries };
  const samples = [], messageParses = [];
  for (let round = 0; round < 4; round++) {
    globalThis.gc?.();
    globalThis[counter] = 0;
    const start = performance.now();
    const plan = planTranslationImport(inspection, report, config, work);
    const elapsed = performance.now() - start;
    assert.equal(plan.report.blocked, false);
    assert.equal(plan.report.changes.length, changed);
    if (round) { samples.push(elapsed); messageParses.push(globalThis[counter]); }
  }
  const sorted = [...samples].sort((a, b) => a - b);
  results.push({ messages: count, changed, samplesMs: samples, p50Ms: sorted[1], messageParses });
}
hook.deregister();
console.log(JSON.stringify({ label: process.argv[2] ?? 'current', node: process.version, results }, null, 2));
