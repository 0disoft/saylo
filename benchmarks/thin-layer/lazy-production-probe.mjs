import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'vite';
import saylo from '@0disoft/saylo-vite';
import { thinLayerAstRuntime } from './ast-runtime.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const repository = fileURLToPath(new URL('../..', import.meta.url));
const { values } = parseArgs({ options: { out: { type: 'string', default: 'benchmarks/results/thin-layer-lazy-production-current.json' } } });
const root = await mkdtemp(path.join(directory, '.lazy-production-'));
const observations = [];
try {
  await writeFile(path.join(root, 'package.json'), '{"private":true,"type":"module"}');
  for (const locale of ['en', 'ru', 'ja']) {
    await mkdir(path.join(root, 'locales', locale), { recursive: true });
    await writeFile(path.join(root, 'locales', locale, 'demo.json'), JSON.stringify({ greeting: `${locale} {name}`,
      ...(locale === 'en' ? { rows: '{count, plural, one {one row} other {# rows}}', when: '{at, date} / {at, time, ::HHmm}' } : {}) }));
    await writeFile(path.join(root, 'locales', locale, 'help.json'), JSON.stringify({ title: `${locale}-help {name}` }));
  }
  for (const variant of ['core', 'layer']) {
    const entry = path.join(root, `${variant}.mjs`), outDir = path.join(root, `dist-${variant}`);
    assert.equal(path.dirname(path.resolve(outDir)), path.resolve(root));
    const factory = variant === 'core'
      ? "import {createI18n as create} from '@0disoft/saylo-core/runtime';"
      : `import {createLazyLayer as create} from ${JSON.stringify(path.join(directory, 'lazy-layer.mjs').replaceAll('\\', '/'))};`;
    await writeFile(entry, `${factory}
      import {catalogSource,initialLocale,initialCatalogs,initialNamespaces,timeZone} from 'virtual:saylo/lazy';
      export const source = catalogSource;
      export const instance = await create({catalogSource,locale:initialLocale,initialCatalogs,initialNamespaces,timeZone});`);
    const result = await build({ configFile: false, root, logLevel: 'silent',
      plugins: [saylo({ localesDir: 'locales', baseLocale: 'en', initialLocale: 'ru', initialNamespaces: [], timeZone: 'UTC' }),
        ...(variant === 'layer' ? [thinLayerAstRuntime()] : [])],
      build: { minify: false, target: 'esnext', outDir, lib: { entry, formats: ['es'] } },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const chunks = outputs.flatMap(output => output.output.filter(item => item.type === 'chunk'));
    assert.ok(chunks.length > 1, 'lazy catalog imports must remain split');
    assert.equal(chunks.some(chunk => chunk.code.includes('EXPECT_ARGUMENT_CLOSING_BRACE')), false);
    const main = chunks.find(chunk => chunk.isEntry);
    const { source, instance } = await import(pathToFileURL(path.join(outDir, main.fileName)));
    const steps = [];
    try {
      const cold = instance.getSnapshot();
      assert.equal(cold.locale, 'ru'); assert.deepEqual(cold.loadedNamespaces, []); assert.equal(source.getCatalogs().length, 0);
      assert.throws(() => instance.t('demo:greeting', { name: 'Ada' }), { name: 'NamespaceNotLoadedError' });
      steps.push({ id: 'cold', cachedCatalogs: 0, loadedNamespaces: [] });
      await instance.loadNamespace('demo');
      const retained = instance.getSnapshot();
      assert.equal(instance.t('demo:greeting', { name: 'Ada' }), 'ru Ada');
      assert.equal(instance.t('demo:rows', { count: 21 }), '21 rows');
      assert.equal(instance.t('demo:when', { at: Date.parse('2026-01-01T00:30:00.000Z') }), '1/1/2026 / 00:30');
      assert.equal(source.getCatalogs().length, 2);
      steps.push({ id: 'load-demo', cachedCatalogs: 2, text: 'ru Ada', fallbackPlural: '21 rows', fallbackDate: '1/1/2026 / 00:30' });
      await instance.setLocale('ja'); assert.equal(instance.t('demo:greeting', { name: 'Ada' }), 'ja Ada');
      assert.equal(source.getCatalogs().length, 3); assert.equal(retained.t('demo:greeting', { name: 'Ada' }), 'ru Ada');
      steps.push({ id: 'select-ja', cachedCatalogs: 3, text: 'ja Ada', retainedText: 'ru Ada' });
      await instance.loadNamespace('help'); assert.equal(instance.t('help:title', { name: 'Ada' }), 'ja-help Ada');
      assert.equal(source.getCatalogs().length, 5); assert.deepEqual(instance.getSnapshot().loadedNamespaces, ['demo', 'help']);
      steps.push({ id: 'load-help', cachedCatalogs: 5, text: 'ja-help Ada', loadedNamespaces: ['demo', 'help'] });
      const accepted = instance.getSnapshot(); await instance.refresh(); assert.equal(instance.getSnapshot(), accepted);
      await assert.rejects(instance.loadNamespace('absent'), RangeError);
      assert.throws(() => instance.t('absent:title'), { name: 'UnknownMessageError' });
      assert.throws(() => cold.t('demo:greeting', { name: 'Ada' }), { name: 'NamespaceNotLoadedError' });
      observations.push({ variant, steps, parserImplementationMarker: false,
        chunks: chunks.map(chunk => ({ fileName: chunk.fileName, isEntry: chunk.isEntry, bytes: Buffer.byteLength(chunk.code),
          gzipBytes: gzipSync(chunk.code).length, sha256: createHash('sha256').update(chunk.code).digest('hex'), moduleIds: chunk.moduleIds })) });
      console.log(`[lazy production] ${variant}: split ${chunks.length} chunks; cached catalogs 0 -> 2 -> 3 -> 5; execution PASS`);
    } finally { instance.dispose(); }
  }
  const files = ['benchmarks/thin-layer/lazy-production-probe.mjs', 'benchmarks/thin-layer/lazy-layer.mjs',
    'benchmarks/thin-layer/lazy-source-cache.mjs', 'benchmarks/thin-layer/catalog-layer.mjs', 'benchmarks/thin-layer/ast-format.mjs',
    'benchmarks/thin-layer/ast-runtime.mjs', 'benchmarks/thin-layer/package-lock.json', 'packages/core/dist/i18n.js',
    'packages/core/dist/boot.js', 'packages/vite/dist/static-catalog-source.js', 'packages/vite/dist/index.js', 'package-lock.json'];
  const codeHashes = Object.fromEntries(await Promise.all(files.map(async file => [file,
    createHash('sha256').update(await readFile(path.join(repository, file))).digest('hex')])));
  await writeFile(path.resolve(repository, values.out), JSON.stringify({ format: 'saylo-thin-layer-lazy-production-v1',
    observedAt: new Date().toISOString(), node: process.version, codeHashes,
    scope: 'Two real Vite production builds using the same six-pair fixture and public static CatalogSource. Empty boot and on-demand catalog chunks execute in Node ESM. Cold/demo/locale/help cache counts prove partial loading, not all catalogs fetched initially. No browser lazy transport, dev reconnect, typegen, large-catalog latency or memory proof. Chunk bytes are small-fixture observations only.',
    observations }, null, 2) + '\n');
} finally {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(directory)); assert.ok(path.basename(resolved).startsWith('.lazy-production-'));
  await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
