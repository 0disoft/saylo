import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'vite';
import { parseCatalog } from '@0disoft/saylo-core';
import saylo from '../dist/index.js';
import { findIncludedKeys, readAutoKeys } from '../dist/auto-keys.js';

const parent = fileURLToPath(new URL('../../../.release/', import.meta.url));
async function fixture(t) {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'auto-keys-'));
  t.after(async () => {
    assert.equal(path.dirname(root), parent.replace(/[\\/]$/, ''));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  return root;
}
const messages = { title: 'Hello', rich: '<b>Rich</b>', one: 'One', two: 'Two', fallback: 'Base only', unused: 'UNUSED_AUTO_KEY_MARKER' };
const catalogs = [parseCatalog(JSON.stringify(messages), { locale: 'ko', namespace: 'demo' })];

test('reverse alias chains and cross-file cycles retain dynamic-call detection', async t => {
  const root = await fixture(t);
  const chain = Array.from({ length: 1500 }, (_, i) => `const alias${i} = ${i === 1499 ? 'i18n.t' : `alias${i + 1}`};`).join('\n');
  await writeFile(path.join(root, 'src/a.ts'), 'let cycleA = cycleB; let cycleB = cycleA; cycleA = alias0; cycleB(key);');
  await writeFile(path.join(root, 'src/z.ts'), chain);
  await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /Dynamic translation keys in src[\\/]a.ts/);
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'], dynamicKeys: ['demo:title'] }), ['demo:title']);
  await writeFile(path.join(root, 'src/a.ts'), 'let cycleA = cycleB; let cycleB = cycleA; cycleB(key);');
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src/a.ts'] }), []);
});

test('repeated template patterns preserve literal regex characters, namespace scope, and sorted unique keys', async t => {
  const root = await fixture(t);
  const data = ['demo', 'help'].map(namespace => parseCatalog('{"part.1":"A","part+2":"B","other":"C"}', { locale: 'ko', namespace }));
  await writeFile(path.join(root, 'src/a.ts'), Array.from({ length: 50 }, () => 't(`demo:part.${suffix}`);').join('\n'));
  await writeFile(path.join(root, 'src/b.ts'), 't(`${namespace}:part.${suffix}`);');
  assert.deepEqual(await findIncludedKeys(root, data, 'ko', { from: ['src/a.ts'] }), ['demo:part.1']);
  assert.deepEqual(await findIncludedKeys(root, data, 'ko', { from: ['src'] }), ['demo:part.1', 'help:part.1']);
});

test('automatic selection parses TS/JSX, aliases, Vue expressions and Svelte control blocks without executing sources', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'src/code.tsx'), `import { t as tr } from './translator';
const { tParts: parts } = useI18n(); const translate = i18n.t;
export const view = <div>{tr('demo:title')}{parts('demo:rich')}{translate('demo:one')}</div>;
// t('demo:unused') must not count as usage.
throw new Error('Sources must never execute during analysis');`);
  await writeFile(path.join(root, 'src/View.vue'), `<script setup lang="ts">const n: number = 1;</script>
<template><p :title="t('demo:two')" :data="{ value: t('demo:one'), n: 1 }" @click="n++; t('demo:two')">{{ t('demo:one') }}</p></template>`);
  await writeFile(path.join(root, 'src/View.svelte'), `<script lang="ts">let name: string = 'x';</script>
{#if name}<p>{t('demo:fallback')}</p>{:else}<p>{tParts('demo:rich')}</p>{/if}`);
  await mkdir(path.join(root, 'src/node_modules'));
  await writeFile(path.join(root, 'src/node_modules/ignored.ts'), `t('demo:unused')`);
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }),
    ['demo:fallback', 'demo:one', 'demo:rich', 'demo:title', 'demo:two']);
});

test('template patterns conservatively preserve every matching key and unresolved dynamic aliases require an explicit list', async t => {
  const root = await fixture(t);
  const file = path.join(root, 'src/main.ts');
  await writeFile(file, 'const a = i18n.t(`demo:${suffix}`);');
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), Object.keys(messages).map(key => `demo:${key}`).sort());
  await writeFile(file, 'const translate = i18n.t; translate(key);');
  await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /Dynamic translation keys/);
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'], dynamicKeys: ['demo:two'] }), ['demo:two']);
  await writeFile(file, `const key: 'demo:one' | 'demo:two' = choose(); t(key);`);
  // Declared dynamic behavior remains explicit even when literal types are visible.
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'], dynamicKeys: ['demo:one', 'demo:two'] }), ['demo:one', 'demo:two']);
});

test('invalid paths, unsupported syntax and incomplete automatic configuration fail before pruning', async t => {
  const root = await fixture(t);
  for (const config of [{}, { from: [] }, { from: [1] }, { from: ['src'], dynamicKeys: ['bad'] }])
    assert.throws(() => readAutoKeys(config), /Automatic includeKeys/);
  await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /No JavaScript/);
  await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['../'] }), /escapes Vite root/);
  await writeFile(path.join(root, 'src/broken.ts'), 'const =');
  await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /Cannot analyze/);
});

test('bound translators and call/apply aliases cannot silently drop dynamic keys', async t => {
  const root = await fixture(t), file = path.join(root, 'src/main.ts');
  for (const code of ['const msg = i18n.t.bind(i18n); msg(key);', 'i18n.t.call(i18n, key);', 'i18n.t.apply(i18n, values);', 'items.map(i18n.t);']) {
    await writeFile(file, code);
    await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /Dynamic translation keys/);
  }
  await writeFile(file, `i18n.t.call(i18n, 'demo:one'); i18n.t.apply(i18n, ['demo:two']);`);
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), ['demo:one', 'demo:two']);
  await rm(file);
  await writeFile(path.join(root, 'src/View.svelte'), `{#each items as item (t('demo:title'))}<p>{item}</p>{/each}`);
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), ['demo:title']);
  await writeFile(path.join(root, 'src/View.svelte'), `{#snippet row(label = t('demo:two'))}<p>{label}</p>{/snippet}`);
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), ['demo:two']);
  await writeFile(path.join(root, 'src/View.vue'), '<template src="./external.html" />');
  await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /External SFC/);
});

test('real automatic production builds prune unused messages and preserve translation, fallback, types and dynamic overrides', async t => {
  const root = await fixture(t);
  for (const locale of ['ko', 'en']) {
    await mkdir(path.join(root, 'locales', locale), { recursive: true });
    await writeFile(path.join(root, 'locales', locale, 'demo.json'), JSON.stringify(locale === 'ko' ? messages : { title: 'English', two: 'Second' }));
  }
  await writeFile(path.join(root, 'src/main.ts'), `import { createStore } from '@0disoft/saylo-core/runtime';
import { initialCatalogs, baseLocale, initialLocale } from 'virtual:saylo';
export const store = createStore({ catalogs: initialCatalogs, baseLocale, locale: initialLocale });
export const title = () => store.t('demo:title');
export const fallback = () => store.t('demo:fallback');
export const dynamic = (key: string) => store.t(key);`);
  const result = await build({ configFile: false, root, logLevel: 'silent',
    plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', includeKeys: { from: ['src'], dynamicKeys: ['demo:two'] }, typegen: { outFile: 'generated.d.ts' } })],
    resolve: { alias: { '@0disoft/saylo-core/runtime': fileURLToPath(new URL('../../core/dist/runtime.js', import.meta.url)),
      '@0disoft/saylo-vite/client': fileURLToPath(new URL('../dist/client.js', import.meta.url)) } },
    build: { outDir: 'out', minify: false, rolldownOptions: { input: path.join(root, 'src/main.ts'), preserveEntrySignatures: 'strict' } } });
  const chunks = result.output.filter(value => value.type === 'chunk');
  assert.ok(chunks.every(chunk => !chunk.code.includes('UNUSED_AUTO_KEY_MARKER')));
  const entry = chunks.find(chunk => chunk.isEntry);
  const app = await import(pathToFileURL(path.join(root, 'out', entry.fileName)));
  t.after(() => app.store.dispose());
  app.store.setLocale('en');
  assert.equal(app.title(), 'English');
  assert.equal(app.fallback(), 'Base only');
  assert.equal(app.dynamic('demo:two'), 'Second');
  assert.throws(() => app.dynamic('demo:unused'), { name: 'UnknownMessageError' });
  assert.match(await readFile(path.join(root, 'generated.d.ts'), 'utf8'), /demo:unused/);
});

test('exported named aliases are followed and escaping translator references require dynamic preservation', async t => {
  const root = await fixture(t), file = path.join(root, 'src/translators.ts');
  await writeFile(file, `const { t } = useI18n(); export { t as message };`);
  await writeFile(path.join(root, 'src/main.ts'), `import { message as msg } from './translators'; msg(key);`);
  await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /Dynamic translation keys/);
  await rm(path.join(root, 'src/main.ts'));
  for (const source of ['export default i18n.t;', 'function translator() { return i18n.t; }', 'function translator() { return i18n.t.bind(i18n); }',
    'consume(i18n.t.bind(i18n));', 'const api = { message: i18n.t };', 'const values = [i18n.t];']) {
    await writeFile(file, source);
    await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /Dynamic translation keys/);
    assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'], dynamicKeys: ['demo:one'] }), ['demo:one']);
  }
});

test('Vite watch rebuilds reanalyze edited source keys and fresh catalog contents', { timeout: 20000 }, async t => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'locales/ko'), { recursive: true });
  const catalog = path.join(root, 'locales/ko/demo.json');
  await writeFile(catalog, JSON.stringify({ title: 'WATCH_TITLE_MARKER', two: 'WATCH_TWO_MARKER', unused: 'WATCH_UNUSED_MARKER' }));
  const main = path.join(root, 'src/main.ts');
  const entry = key => `import { createStore } from '@0disoft/saylo-core/runtime';
import { initialCatalogs, baseLocale, initialLocale } from 'virtual:saylo';
const store = createStore({ catalogs: initialCatalogs, baseLocale, locale: initialLocale });
export const value = () => store.t('${key}');`;
  await writeFile(main, entry('demo:title'));
  const outputs = [], failures = [];
  const watcher = await build({ configFile: false, root, logLevel: 'silent',
    plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', includeKeys: { from: ['src'] }, typegen: { outFile: 'generated.d.ts' } }),
      { name: 'watch-evidence', generateBundle(_options, bundle) { outputs.push(Object.values(bundle).filter(value => value.type === 'chunk').map(value => value.code).join('\n')); } }],
    resolve: { alias: { '@0disoft/saylo-core/runtime': fileURLToPath(new URL('../../core/dist/runtime.js', import.meta.url)),
      '@0disoft/saylo-vite/client': fileURLToPath(new URL('../dist/client.js', import.meta.url)) } },
    build: { outDir: 'out', watch: {}, minify: false, rolldownOptions: { input: main, preserveEntrySignatures: 'strict' } } });
  watcher.on('event', event => {
    if (event.code === 'ERROR') failures.push(event.error);
    if (event.code === 'BUNDLE_END') void event.result.close();
  });
  async function waitFor(count) {
    const deadline = Date.now() + 5000;
    while (outputs.length < count && !failures.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    if (failures.length) throw failures[0];
    assert.ok(outputs.length >= count, `Expected watch build ${count}; got ${outputs.length}`);
  }
  try {
    await waitFor(1);
    assert.match(outputs.at(-1), /WATCH_TITLE_MARKER/);
    assert.doesNotMatch(outputs.at(-1), /WATCH_TWO_MARKER|WATCH_UNUSED_MARKER/);
    const before = outputs.length;
    await writeFile(main, entry('demo:two'));
    await waitFor(before + 1);
    assert.match(outputs.at(-1), /WATCH_TWO_MARKER/);
    assert.doesNotMatch(outputs.at(-1), /WATCH_TITLE_MARKER|WATCH_UNUSED_MARKER/);
    const next = outputs.length;
    await writeFile(catalog, JSON.stringify({ title: 'WATCH_TITLE_MARKER', two: 'WATCH_UPDATED_MARKER', added: 'new type' }));
    await waitFor(next + 1);
    assert.match(outputs.at(-1), /WATCH_UPDATED_MARKER/);
    assert.doesNotMatch(outputs.at(-1), /WATCH_TWO_MARKER/);
    assert.match(await readFile(path.join(root, 'generated.d.ts'), 'utf8'), /demo:added/);
  } finally { await watcher.close(); }
});
