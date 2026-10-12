import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'vite';
import { CatalogError } from '@0disoft/saylo-core';
import saylo from '../dist/index.js';

const parent = fileURLToPath(new URL('../../../.release/', import.meta.url));
async function fixture(t) {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'include-keys-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(parent));
    assert.ok(path.basename(root).startsWith('include-keys-'));
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  for (const locale of ['ko', 'en']) {
    await mkdir(path.join(root, 'locales', locale), { recursive: true });
    const messages = Object.assign(Object.create(null), { title: `${locale} title`, number: '{n, number}' });
    messages.__proto__ = `${locale} prototype key`;
    for (let index = 0; index < 100; index++) messages[`drop${index}`] = `DROP_MARKER_${locale}_${index} ${'unused translation '.repeat(12)}`;
    await writeFile(path.join(root, 'locales', locale, 'demo.json'), JSON.stringify(messages));
  }
  await writeFile(path.join(root, 'locales/ko/help.json'), '{"title":"fallback help","drop":"DROP_MARKER_HELP"}');
  await writeFile(path.join(root, 'locales/ko/other.json'), '{"only":"DROP_MARKER_OTHER"}');
  await writeFile(path.join(root, 'main.mjs'), `import { createI18n, createStore } from '@0disoft/saylo-core/runtime';
import { initialCatalogs as eager, baseLocale, initialLocale as eagerLocale } from 'virtual:saylo';
import { catalogSource, initialCatalogs, initialLocale, initialNamespaces } from 'virtual:saylo/lazy';
export const eagerStore = createStore({ catalogs: eager, baseLocale, locale: eagerLocale });
export const lazy = createI18n({ catalogSource, initialCatalogs, locale: initialLocale, initialNamespaces });
export const source = catalogSource;`);
  await writeFile(path.join(root, 'server.mjs'), `import { createRequestI18n } from 'virtual:saylo/server';
export async function render(locale) {
  const instance = await createRequestI18n({ locale });
  try { return { title: instance.t('demo:title'), boot: instance.getBootSnapshot() }; }
  finally { instance.dispose(); }
}`);
  return root;
}

const config = (root, label, options = {}, ssr = false) => ({ configFile: false, root, logLevel: 'silent',
  plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', initialNamespaces: ['demo'],
    typegen: { outFile: 'generated.d.ts' }, ...options })],
  resolve: { alias: {
    '@0disoft/saylo-core/runtime': fileURLToPath(new URL('../../core/dist/runtime.js', import.meta.url)),
    '@0disoft/saylo-core': fileURLToPath(new URL('../../core/dist/index.js', import.meta.url)),
    'intl-messageformat': fileURLToPath(import.meta.resolve('intl-messageformat')),
    '@0disoft/saylo-vite/client': fileURLToPath(new URL('../dist/client.js', import.meta.url)),
  } },
  ssr: { noExternal: ['@0disoft/saylo-core'] },
  build: { outDir: label, minify: false, modulePreload: false,
    ...(ssr ? { ssr: path.join(root, 'server.mjs') } : {}),
    rolldownOptions: { input: path.join(root, ssr ? 'server.mjs' : 'main.mjs'), preserveEntrySignatures: 'strict' } },
});
async function output(root, label, options, ssr = false) {
  const result = await build(config(root, label, options, ssr));
  const chunks = result.output.filter(value => value.type === 'chunk');
  const entry = chunks.find(value => value.isEntry);
  const module = await import(pathToFileURL(path.join(root, label, entry.fileName)));
  return { module, chunks, bytes: chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0),
    gzipBytes: chunks.reduce((sum, chunk) => sum + gzipSync(chunk.code).byteLength, 0) };
}

test('includeKeys rejects malformed/duplicate configuration and snapshots caller input', async t => {
  for (const includeKeys of [null, 'demo:title', [3], ['title'], [':title'], ['demo:'], ['demo:title:extra'], ['demo:title', 'demo:title']])
    assert.throws(() => saylo({ localesDir: 'locales', baseLocale: 'ko', includeKeys }), /includeKeys/);
  const root = await fixture(t), keys = ['demo:title'];
  const plugin = saylo({ localesDir: 'locales', baseLocale: 'ko', includeKeys: keys });
  t.after(() => plugin.closeBundle());
  keys.push('demo:missing');
  await plugin.configResolved({ root, command: 'build' });
  const eager = plugin.load(plugin.resolveId('virtual:saylo'));
  assert.ok(eager.includes('ko title') && !eager.includes('DROP_MARKER'));
});

test('includeKeys prunes eager and lazy production chunks without changing retained translation/fallback/topology', async t => {
  const root = await fixture(t);
  const full = await output(root, 'full');
  const selected = await output(root, 'selected', { includeKeys: ['demo:title', 'demo:number', 'demo:__proto__', 'help:title'] });
  for (const value of [full.module, selected.module]) t.after(() => { value.eagerStore.dispose(); value.lazy.dispose(); });
  assert.ok(full.chunks.some(chunk => chunk.code.includes('DROP_MARKER_OTHER')));
  assert.ok(selected.chunks.every(chunk => !chunk.code.includes('DROP_MARKER')));
  assert.ok(selected.bytes < full.bytes && selected.gzipBytes < full.gzipBytes);
  assert.ok(selected.chunks.some(chunk => chunk.isDynamicEntry), 'Locale/namespace loading must still use chunks');
  for (const { eagerStore, lazy } of [full.module, selected.module]) {
    assert.equal(eagerStore.t('demo:title'), 'ko title');
    eagerStore.setLocale('en'); assert.equal(eagerStore.t('demo:__proto__'), 'en prototype key');
    await lazy.setLocale('en'); assert.equal(lazy.t('demo:title'), 'en title');
    assert.equal(lazy.t('demo:number', { n: 1234.5 }), eagerStore.t('demo:number', { n: 1234.5 }));
    assert.throws(() => lazy.t('demo:number', { n: 'wrong' }), { name: 'InvalidArgumentError' });
    await lazy.loadNamespace('help'); assert.equal(lazy.t('help:title'), 'fallback help');
    await lazy.loadNamespace('other');
    assert.deepEqual(lazy.getSnapshot().availableNamespaces, ['demo', 'help', 'other']);
    assert.deepEqual(lazy.getSnapshot().availableLocales, ['en', 'ko']);
  }
  for (const instance of [selected.module.eagerStore, selected.module.lazy])
    assert.throws(() => instance.t('demo:drop0'), { name: 'UnknownMessageError' });
  assert.notEqual(full.module.source.readManifest().catalogs[0].namespaceSchemaFingerprint,
    selected.module.source.readManifest().catalogs[0].namespaceSchemaFingerprint);
  assert.ok((await readFile(path.join(root, 'generated.d.ts'), 'utf8')).includes('demo:drop0'), 'Typegen still covers full source schema');
  console.log(`[include-keys] fixture all emitted JS: ${full.bytes} -> ${selected.bytes} bytes; per-chunk gzip sum: ${full.gzipBytes} -> ${selected.gzipBytes} bytes`);
});

test('empty includeKeys emits no messages while preserving locale/namespace loading', async t => {
  const root = await fixture(t);
  const result = await output(root, 'empty', { includeKeys: [] });
  t.after(() => { result.module.eagerStore.dispose(); result.module.lazy.dispose(); });
  assert.ok(result.chunks.every(chunk => !chunk.code.includes('ko title') && !chunk.code.includes('DROP_MARKER')));
  await result.module.lazy.setLocale('en'); await result.module.lazy.loadNamespace('other');
  assert.deepEqual(result.module.lazy.getSnapshot().availableNamespaces, ['demo', 'help', 'other']);
  assert.throws(() => result.module.lazy.t('demo:title'), { name: 'UnknownMessageError' });
});

test('production SSR uses filtered boot schemas for concurrent locale requests', async t => {
  const root = await fixture(t);
  const result = await output(root, 'ssr', { includeKeys: ['demo:title'] }, true);
  assert.ok(result.chunks.every(chunk => !chunk.code.includes('DROP_MARKER')));
  const values = await Promise.all(['ko', 'en'].map(locale => result.module.render(locale)));
  assert.deepEqual(values.map(value => value.title), ['ko title', 'en title']);
  for (const { boot } of values) {
    assert.deepEqual(Object.keys(boot.baseSchemas[0].keys), ['title']);
    assert.ok(boot.catalogOutcomes.filter(value => value.status === 'present')
      .every(value => Object.keys(value.catalog.messages).length === 1));
  }
});

test('unknown keys fail before typegen; pruning cannot hide ordinary or strict source validation errors', async t => {
  const root = await fixture(t);
  const out = path.join(root, 'generated.d.ts'); await writeFile(out, '// Preserve previous types');
  await assert.rejects(build(config(root, 'unknown', { includeKeys: ['demo:missing', 'unknown:title'] })), /absent from the base catalogs/);
  assert.equal(await readFile(out, 'utf8'), '// Preserve previous types');
  await assert.rejects(build(config(root, 'strict', { includeKeys: ['demo:title'], requireCompleteTranslations: true })), error =>
    error instanceof CatalogError && error.diagnostics.some(value => value.code === 'MISSING_NAMESPACE'));
  await writeFile(path.join(root, 'locales/en/demo.json'), '{"title":"en title","drop0":"{unexpected}"}');
  await assert.rejects(build(config(root, 'bad-schema', { includeKeys: ['demo:title'] })), error =>
    error instanceof CatalogError && error.diagnostics.some(value => value.code === 'UNKNOWN_ARGUMENT'));
  await writeFile(path.join(root, 'locales/en/demo.json'), '{broken');
  await assert.rejects(build(config(root, 'bad-json', { includeKeys: [] })), error =>
    error instanceof CatalogError && error.diagnostics.some(value => value.code === 'INVALID_JSON'));
});
