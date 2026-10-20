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

test('automatic selection parses TS/JSX, aliases, Vue expressions and Svelte control blocks without executing sources', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'src/code.tsx'), `import { t as tr } from './translator';
const { tParts: parts } = useI18n(); const translate = i18n.t;
export const view = <div>{tr('demo:title')}{parts('demo:rich')}{translate('demo:one')}</div>;
// t('demo:unused') must not count as usage.
throw new Error('Sources must never execute during analysis');`);
  await writeFile(path.join(root, 'src/View.vue'), `<script setup lang="ts">const n: number = 1;</script>
<template><p :title="t('demo:two')">{{ t('demo:one') }}</p></template>`);
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
