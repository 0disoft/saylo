import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'vite';
import saylo from '@0disoft/saylo-vite';
import { thinLayerAstRuntime } from './ast-runtime.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const repository = fileURLToPath(new URL('../..', import.meta.url));
const { values } = parseArgs({ options: { out: { type: 'string', default: 'benchmarks/results/thin-layer-production-current.json' } } });
const root = await mkdtemp(path.join(directory, '.production-probe-'));
const observations = [];
try {
  for (const locale of ['en', 'ru']) await mkdir(path.join(root, 'locales', locale), { recursive: true });
  await writeFile(path.join(root, 'locales/en/demo.json'), JSON.stringify({
    greeting: 'Hello {name}', when: '{at, date} / {at, time, ::HHmm}', rows: '{count, plural, one {one row} other {# rows}}',
  }));
  await writeFile(path.join(root, 'locales/ru/demo.json'), JSON.stringify({ greeting: 'Hi {name}' }));
  for (const variant of ['core', 'layer', 'layer-ast', 'layer-ast-mixed']) {
    const astRuntime = variant.startsWith('layer-ast');
    const mixed = variant === 'layer-ast-mixed';
    const factory = variant === 'core'
      ? `import {createStore} from '@0disoft/saylo-core/runtime';
         const store = createStore({baseLocale,locale:initialLocale,catalogs:initialCatalogs,timeZone});`
      : `import {createCatalogLayer} from ${JSON.stringify(path.join(directory, 'catalog-layer.mjs').replaceAll('\\', '/'))};
         const store = await createCatalogLayer(baseLocale,initialCatalogs,initialLocale,{timeZone});`;
    const entry = path.join(root, `${variant}.mjs`);
    await writeFile(entry, `import {baseLocale,initialLocale,initialCatalogs,timeZone} from 'virtual:saylo';
      ${factory}
      ${mixed ? "import {IntlMessageFormat} from 'intl-messageformat'; export const externalText = new IntlMessageFormat('External {name}', 'en').format({name:'Ada'});" : ''}
      export const snapshot = store.getSnapshot();`);
    const bundle = await build({ configFile: false, root, logLevel: 'silent',
      plugins: [saylo({ localesDir: 'locales', baseLocale: 'en', initialLocale: 'ru', timeZone: 'UTC' }),
        ...(astRuntime ? [thinLayerAstRuntime()] : [])],
      build: { write: false, minify: false, target: 'esnext', lib: { entry, formats: ['es'] } },
    });
    const outputs = Array.isArray(bundle) ? bundle : [bundle];
    assert.equal(outputs.length, 1, 'one build output');
    const chunks = outputs[0].output.filter(item => item.type === 'chunk');
    assert.equal(chunks.length, 1, 'fixture must be a self-contained eager ESM bundle');
    const { code, moduleIds } = chunks[0];
    const { snapshot, externalText } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    if (mixed) assert.equal(externalText, 'External Ada', 'unrelated string formatter retains its parser');
    assert.equal(snapshot.timeZone, 'UTC');
    assert.equal(snapshot.t('demo:greeting', { name: 'Ada' }), 'Hi Ada');
    assert.equal(snapshot.t('demo:rows', { count: 0 }), '0 rows');
    assert.equal(snapshot.t('demo:when', { at: Date.parse('2026-01-01T00:30:00.000Z') }), '1/1/2026 / 00:30');
    assert.throws(() => snapshot.t('demo:absent'), { name: 'UnknownMessageError' });
    assert.throws(() => snapshot.t('demo:greeting'), { name: 'InvalidArgumentError' });
    const parserModules = moduleIds.filter(id => /icu-messageformat-parser[\\/]index\.js(?:\?|$)/.test(id));
    const noParserModules = moduleIds.filter(id => /icu-messageformat-parser[\\/]no-parser\.js(?:\?|$)/.test(id));
    // The parser entry also exports AST types. Graph presence alone cannot
    // prove its parsing implementation survived tree shaking.
    const parserImplementationPresent = code.includes('EXPECT_ARGUMENT_CLOSING_BRACE');
    if (variant === 'core' || variant === 'layer-ast') {
      assert.equal(parserImplementationPresent, false, `${variant} must omit the parser error implementation marker`);
      assert.ok(noParserModules.length, `${variant} AST formatter boundary must apply`);
    } else {
      assert.ok(parserModules.length, 'prototype imports the standard IMF parser entry');
      assert.equal(parserImplementationPresent, true, 'prototype still ships the parser implementation marker');
    }
    observations.push({ variant, astRuntime, unminifiedBytes: Buffer.byteLength(code), gzipBytes: gzipSync(code).length,
      moduleIds, parserModules, noParserModules, parserImplementationPresent,
      bundleSHA256: createHash('sha256').update(code).digest('hex'),
      execution: { timeZone: snapshot.timeZone, translatedText: 'Hi Ada', fallbackPlural: '0 rows',
        fallbackDate: '1/1/2026 / 00:30', unknownKeyRejected: true, missingArgumentRejected: true,
        ...(mixed ? { externalText } : {}) } });
  }
  const files = ['benchmarks/thin-layer/production-probe.mjs', 'benchmarks/thin-layer/ast-format.mjs',
    'benchmarks/thin-layer/ast-runtime.mjs',
    'benchmarks/thin-layer/catalog-layer.mjs', 'benchmarks/thin-layer/package-lock.json',
    'packages/core/dist/formatters.js', 'packages/vite/dist/ast-formatter.js', 'packages/vite/dist/index.js', 'package-lock.json'];
  const codeHashes = Object.fromEntries(await Promise.all(files.map(async file => [file,
    createHash('sha256').update(await readFile(path.join(repository, file))).digest('hex')])));
  await writeFile(path.resolve(repository, values.out), JSON.stringify({ format: 'saylo-thin-layer-production-v2',
    observedAt: new Date().toISOString(), node: process.version, codeHashes,
    scope: 'Real Vite production build of the same small eager AST fixture, executed as self-contained ESM in Node. Unminified and gzip sizes are fixture observations only. Build graph entries are reported separately from the emitted parser error marker, since entry modules also export AST types. No browser/lazy/SSR hydration/large-catalog performance or memory proof.',
    observations }, null, 2) + '\n');
  for (const row of observations) console.log(`${row.variant}: parser marker ${row.parserImplementationPresent}, parser entries ${row.parserModules.length}, no-parser entries ${row.noParserModules.length}, ${row.unminifiedBytes} unminified bytes, ${row.gzipBytes} gzip bytes; execution PASS`);
} finally {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(directory));
  assert.ok(path.basename(resolved).startsWith('.production-probe-'));
  await rm(resolved, { recursive: true, force: true });
}
