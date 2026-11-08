import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { IntlMessageFormat } from 'intl-messageformat';
import { createTranslator, parseCatalog } from '@0disoft/saylo-core';

// Time real translation calls without instrumentation; count constructions in a separate run.
const warmupRounds = 10, rounds = 400, trials = 5;
const args = { n: 1234.5, name: 'Saylo' };
const results = [];
const variants = [{ name: 'current', createTranslator, parseCatalog }];
const parent = fileURLToPath(new URL('../.release/', import.meta.url));
let reference;
try {
  if (process.argv.includes('--compare-lru')) {
    await mkdir(parent, { recursive: true });
    reference = await mkdtemp(path.join(parent, 'formatter-lru-'));
    await writeFile(path.join(reference, 'package.json'), '{"type":"module"}');
    await cp(new URL('../packages/core/dist/', import.meta.url), path.join(reference, 'dist'), { recursive: true });
    const file = path.join(reference, 'dist/formatters.js');
    const source = await readFile(file, 'utf8');
    assert.equal(source.split('new MessageCache').length - 1, 3);
    await writeFile(file, source.replaceAll('new MessageCache', 'new BoundedCache'));
    const baseline = await import(pathToFileURL(path.join(reference, 'dist/index.js')));
    variants.unshift({ name: 'lru-reference', createTranslator: baseline.createTranslator, parseCatalog: baseline.parseCatalog });
  }
  for (const count of [256, 257, 512]) {
    const source = JSON.stringify(Object.fromEntries(Array.from({ length: count }, (_, i) =>
      [`m${i}`, `Message ${i}: {n, number} for {name}`])));
    const keys = Array.from({ length: count }, (_, i) => 'cycle:m' + i);
    const cases = variants.map(variant => ({ ...variant, samples: [],
      catalog: variant.parseCatalog(source, { locale: 'en', namespace: 'cycle' }) }));
    const run = (translate, repeat) => {
      let last;
      for (let pass = 0; pass < repeat; pass++) for (const key of keys) last = translate(key, args);
      assert.equal(last, `Message ${count - 1}: 1,234.5 for Saylo`);
    };
    for (let trial = 0; trial < trials; trial++) {
      // Alternate execution order to reduce drift between separate before/after runs.
      for (const variant of trial % 2 ? [...cases].reverse() : cases) {
        const translator = variant.createTranslator({ locale: 'en', baseCatalogs: [variant.catalog] });
        run(translator.t, warmupRounds);
        const start = performance.now();
        run(translator.t, rounds);
        variant.samples.push(performance.now() - start);
      }
    }
    for (const variant of cases) {
      const resolveLocale = IntlMessageFormat.resolveLocale;
      let constructions = 0;
      // The installed FormatJS constructor invokes this hook exactly once per instance.
      IntlMessageFormat.resolveLocale = (...values) => { constructions++; return resolveLocale(...values); };
      try {
        const translator = variant.createTranslator({ locale: 'en', baseCatalogs: [variant.catalog] });
        run(translator.t, warmupRounds);
        constructions = 0;
        run(translator.t, rounds);
      } finally { IntlMessageFormat.resolveLocale = resolveLocale; }
      const calls = count * rounds;
      results.push({ variant: variant.name, messages: count, callsPerTrial: calls, formatterConstructions: constructions,
        hitRate: 1 - constructions / calls,
        medianMicrosecondsPerCall: [...variant.samples].sort((a, b) => a - b)[Math.floor(trials / 2)] * 1000 / calls,
        milliseconds: variant.samples });
    }
  }
  const flag = process.argv.indexOf('--label');
  const report = { measuredAt: new Date().toISOString(), node: process.version, platform: process.platform,
    comparison: reference ? 'Same process, alternating order; LRU reference replaces only the three message cache classes in a temporary copy of the current compiled core.' : 'Single implementation',
    label: flag === -1 ? 'current' : process.argv[flag + 1], warmupRounds, rounds, trials,
    messageEntryLimit: 256, nativeIntlEntryLimit: 128, results };
  const output = JSON.stringify(report, null, 2) + '\n';
  const outFlag = process.argv.indexOf('--out-file');
  if (outFlag !== -1) { assert.ok(process.argv[outFlag + 1]); await writeFile(process.argv[outFlag + 1], output); }
  process.stdout.write(output);
} finally {
  if (reference) {
    assert.equal(path.dirname(reference), path.resolve(parent));
    assert.ok(path.basename(reference).startsWith('formatter-lru-'));
    await rm(reference, { recursive: true, force: true });
  }
}
