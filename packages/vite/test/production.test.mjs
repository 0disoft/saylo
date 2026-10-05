import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'vite';
import { parseCatalog } from '@0disoft/saylo-core';
import saylo from '../dist/index.js';
import { createStaticCatalogSource } from '../dist/client.js';
import { CatalogRegistry } from '../dist/catalog-registry.js';

function registry() {
  const catalog = (locale, namespace, text) => parseCatalog(JSON.stringify({ title: text }), { locale, namespace });
  return new CatalogRegistry('build', 'ko', [catalog('ko', 'demo', 'BOOT_KO'), catalog('en', 'demo', 'LAZY_EN'),
    catalog('ko', 'help', 'FALLBACK_HELP')]);
}
const entries = r => r.manifest().catalogs.filter(m => m.status === 'present' && m.key.locale !== 'ko')
  .map(m => ({ key: m.key, load: async () => r.load(m.key.locale, m.key.namespace) }));
const boot = r => [r.load('ko', 'demo'), r.load('ko', 'help')];

test('static imports dedupe across consumers, cache immutable outcomes, and honor pre-abort', async () => {
  const r = registry();
  let count = 0;
  let release;
  const source = createStaticCatalogSource(r.manifest(), boot(r), [{ key: { locale: 'en', namespace: 'demo' }, load: () => {
    count++;
    return new Promise(resolve => { release = resolve; });
  } }]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(source.loadCatalog('en', 'demo', controller.signal), { code: 'ABORTED' });
  const first = source.loadCatalog('en', 'demo');
  const second = source.loadCatalog('en', 'demo');
  await Promise.resolve();
  assert.equal(count, 1);
  release(r.load('en', 'demo'));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.ok(Object.isFrozen(a.catalog.messages.title.ast));
  assert.equal(await source.loadCatalog('en', 'demo'), a);
  assert.equal(count, 1);
});

test('missing pairs keep manifest tombstones without importing', async () => {
  const r = registry();
  r.replace(boot(r).map(o => o.catalog));
  const source = createStaticCatalogSource(r.manifest(), boot(r), []);
  assert.deepEqual(await source.loadCatalog('en', 'demo'), r.load('en', 'demo'));
  assert.ok((await source.loadCatalog('en', 'demo')).catalogVersion > 0);
  assert.equal((await source.loadCatalog('ja', 'help')).catalogVersion, 0);
});

test('failed or mismatched chunk loads leave the cache untouched and can be retried', async () => {
  const r = registry();
  let count = 0;
  const source = createStaticCatalogSource(r.manifest(), boot(r), [{ key: { locale: 'en', namespace: 'demo' }, load: () => {
    count++;
    if (count === 1) throw new Error('network unavailable');
    const result = r.load('en', 'demo');
    if (count === 2) return Promise.resolve({ ...result, sessionId: 'old-build' });
    if (count === 3) return Promise.resolve(r.load('ko', 'demo'));
    return Promise.resolve(result);
  } }]);
  await assert.rejects(source.loadCatalog('en', 'demo'), /network unavailable/);
  await assert.rejects(source.loadCatalog('en', 'demo'), { code: 'INVALID_STATIC_CATALOG' });
  await assert.rejects(source.loadCatalog('en', 'demo'), { code: 'INVALID_STATIC_CATALOG' });
  assert.equal(source.getCatalogs().length, 2);
  assert.equal((await source.loadCatalog('en', 'demo')).catalog.messages.title.source, 'LAZY_EN');
  assert.equal(source.getCatalogs().length, 3);
  assert.throws(() => createStaticCatalogSource(r.manifest(), boot(r), []), { code: 'INVALID_STATIC_CATALOG' });
  assert.throws(() => createStaticCatalogSource(r.manifest(), [{ ...boot(r)[0], catalogVersion: 9 }], entries(r)),
    { code: 'INVALID_STATIC_CATALOG' });
});

test('real production build emits scoped AST chunks, executes lazy imports, and rejects fresh invalid disk', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-production-'));
  t.after(async () => {
    const target = path.resolve(root);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('saylo-production-'));
    await rm(target, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  for (const locale of ['ko', 'en']) {
    await mkdir(path.join(root, 'locales', locale), { recursive: true });
    for (const namespace of ['demo', 'help']) await writeFile(path.join(root, 'locales', locale, `${namespace}.json`),
      JSON.stringify({ title: `${locale === 'ko' && namespace === 'demo' ? 'BOOT' : 'LAZY'}_${locale}_${namespace}` }));
  }
  await writeFile(path.join(root, 'locales', 'en', 'help.json'), '{}'); // Key fallback inside a present chunk.
  await writeFile(path.join(root, 'main.js'), `import { createI18n } from '@0disoft/saylo-core';
import { catalogSource, initialCatalogs, initialLocale, initialNamespaces } from 'virtual:saylo/lazy';
export const source = catalogSource;
export const instance = createI18n({ catalogSource, initialCatalogs, locale: initialLocale, initialNamespaces });`);
  const config = () => ({ configFile: false, root, logLevel: 'silent',
    plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', initialNamespaces: ['demo'], typegen: { outFile: 'generated.d.ts' } })],
    resolve: { alias: { '@0disoft/saylo-core': fileURLToPath(new URL('../../core/dist/index.js', import.meta.url)),
      '@0disoft/saylo-vite/client': fileURLToPath(new URL('../dist/client.js', import.meta.url)) } },
    build: { minify: false, modulePreload: false,
      rolldownOptions: { input: path.join(root, 'main.js'), preserveEntrySignatures: 'strict' } } });
  const result = await build(config());
  const chunks = result.output.filter(o => o.type === 'chunk');
  const entry = chunks.find(o => o.isEntry);
  const lazy = chunks.filter(o => o.isDynamicEntry);
  assert.equal(lazy.length, 3);
  assert.equal(entry.dynamicImports.length, 3);
  for (const marker of ['LAZY_en_demo', 'LAZY_ko_help']) {
    assert.ok(!entry.code.includes(marker));
    assert.equal(lazy.filter(chunk => chunk.code.includes(marker)).length, 1);
  }
  assert.ok(entry.code.includes('BOOT_ko_demo'));
  assert.ok(!chunks.some(chunk => chunk.code.includes('vite:ws:') || chunk.code.includes('saylo:request-catalog')));
  assert.match(await readFile(path.join(root, 'generated.d.ts'), 'utf8'), /help:title/);
  // Run exactly the emitted modules, not the plugin's pre-bundle strings.
  const { instance, source } = await import(pathToFileURL(path.join(root, 'dist', entry.fileName)));
  t.after(() => instance.dispose());
  assert.equal(source.getCatalogs().length, 1);
  await instance.setLocale('en');
  assert.equal(instance.t('demo:title'), 'LAZY_en_demo');
  await instance.loadNamespace('help');
  assert.equal(instance.t('help:title'), 'LAZY_ko_help');
  assert.equal(source.getCatalogs().length, 4);
  await writeFile(path.join(root, 'locales', 'en', 'demo.json'), '{');
  await assert.rejects(build(config()));
});
