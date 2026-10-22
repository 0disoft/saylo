import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'vite';
import { parseCatalog } from '@0disoft/saylo-core';
import saylo from '../dist/index.js';
import { findIncludedKeys, readAutoKeys } from '../dist/auto-keys.js';

test('resolved aliases follow named reexports and namespace members while preserving dynamic-call diagnostics', async t => {
  const root = await fixture(t);
  const main = path.join(root, 'src/main.ts');
  const translator = path.join(root, 'src/translators.ts');
  const bridge = path.join(root, 'src/bridge.ts');
  await writeFile(translator, 'const translate = i18n.t; export { translate as message };');
  await writeFile(bridge, `export { message as text } from '@/translators';`);
  const calls = [];
  const resolve = async (id, importer) => {
    calls.push([id, importer]);
    return id === '@/translators' ? translator : id === '$lib/bridge' ? bridge : undefined;
  };
  for (const source of [
    `import { text as msg } from '$lib/bridge'; msg(key);`,
    `import * as messages from '$lib/bridge'; messages.text(key);`,
    `import * as messages from '$lib/bridge'; const { text: msg } = messages; msg(key);`,
  ]) {
    await writeFile(main, source);
    await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }, undefined, resolve), /Dynamic translation keys/);
    assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'], dynamicKeys: ['demo:two'] }, undefined, resolve), ['demo:two']);
  }
  await writeFile(main, "import { text as msg } from '$lib/bridge'; msg(`demo:t${suffix}`);");
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }, undefined, resolve), ['demo:title', 'demo:two']);
  assert.ok(calls.some(([id, importer]) => id === '@/translators' && importer === bridge));
  await writeFile(translator, 'export const message = (key: string) => key;');
  await writeFile(main, "import * as helpers from '$lib/bridge'; helpers.text(key);");
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }, undefined, resolve), []);
});

test('alias resolution never reads unscanned files and preserves resolver failure causes', async t => {
  const root = await fixture(t);
  const main = path.join(root, 'src/main.ts');
  await writeFile(main, "import { message as msg } from '@/hidden'; msg(key);");
  const outside = path.join(root, 'hidden.ts');
  await writeFile(outside, 'this is intentionally not parseable JavaScript');
  await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }, undefined, async () => outside),
    error => /outside scanned sources/.test(error.message) && error.message.includes(main) && error.message.includes(outside));
  const failure = new Error('Resolver failed');
  await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }, undefined, async () => { throw failure; }),
    error => error === failure);
});

test('type-only aliased imports and reexports never resolve or retain runtime keys', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'src/main.ts'), `import type * as types from '@/types';
import type { Message } from '@/types'; import { type Other } from '@/types';
export type { Message } from '@/types'; export { type Other } from '@/types';`);
  const resolve = async () => { assert.fail('Type-only alias reached the runtime resolver'); };
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }, undefined, resolve), []);
});

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

test('typed and inline-bound translator calls preserve dynamic-key diagnostics', async t => {
  const root = await fixture(t), file = path.join(root, 'src/main.tsx');
  for (const source of [
    'const translate = i18n.t as typeof i18n.t; translate(key);',
    'const translate = i18n.t!; translate(key);',
    '(i18n.t satisfies Function)(key);',
    'i18n.t.bind(i18n)(key);',
    '(i18n.t as Function).call(i18n, key);',
    'i18n.t.apply(i18n, values as [string]);',
    'function render({ t: translate }) { return translate(key); }',
    'const { nested: { tParts: parts } } = context; parts(key);',
  ]) {
    await writeFile(file, source);
    await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /Dynamic translation keys/, source);
    assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'], dynamicKeys: ['demo:one'] }), ['demo:one']);
  }
  await writeFile(file, 'const translate = i18n.t as typeof i18n.t; translate(`demo:${suffix}` as string);');
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), Object.keys(messages).map(key => `demo:${key}`).sort());
  await writeFile(file, "(i18n.t as Function).apply(i18n, ['demo:two'] as const);");
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), ['demo:two']);
});

test('translator callbacks passed through JSX, defaults and logical expressions need explicit dynamic preservation', async t => {
  const root = await fixture(t), file = path.join(root, 'src/main.tsx');
  for (const source of [
    'const view = <Widget translate={i18n.t} />;',
    'const view = <Widget translate={i18n.t as Function} />;',
    'const translate = i18n.t || fallback; translate(key);',
    'function render(translate = i18n.t) { return translate(key); }',
    'const translate = (0, i18n.t); translate(key);',
    'const view = new Widget(i18n.t);',
    'const translate = i18n.t; export { translate as default };',
  ]) {
    await writeFile(file, source);
    await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /Dynamic translation keys/, source);
    assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'], dynamicKeys: ['demo:two'] }), ['demo:two']);
  }
  await rm(file);
  for (const [name, source] of [
    ['View.svelte', '<Widget translate={i18n.t} />'],
    ['View.vue', '<template><Widget :translate="i18n.t" /></template>'],
  ]) {
    const component = path.join(root, 'src', name);
    await writeFile(component, source);
    await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /Dynamic translation keys/, name);
    await rm(component);
  }
});

test('template substitutions retain keys containing escaped line terminators', async t => {
  const root = await fixture(t);
  const ids = ['line\nbreak', 'line\rbreak', 'line\u2028break', 'line\u2029break'];
  const data = [parseCatalog(JSON.stringify(Object.fromEntries(ids.map(id => [id, 'Hello']))), { locale: 'ko', namespace: 'demo' })];
  await writeFile(path.join(root, 'src/main.ts'), 't(`demo:${suffix}`);');
  assert.deepEqual(await findIncludedKeys(root, data, 'ko', { from: ['src'] }), ids.map(id => `demo:${id}`).sort());
});

test('SFC comment removal never erases script code and rejects ambiguous template markers', async t => {
  const root = await fixture(t);
  for (const extension of ['vue', 'svelte']) {
    const file = path.join(root, 'src', `View.${extension}`);
    await writeFile(file, '<script>const opening = "<!--"; t(key); const closing = "-->";</script>');
    await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /Dynamic translation keys/, extension);
    await writeFile(file, '<!-- <script>t(key);</script> --><script>const title = "demo:title";</script>');
    assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), ['demo:title']);
    await writeFile(file, '<script SRC="./external.ts"></script>');
    await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /External SFC/, extension);
    await writeFile(file, extension === 'vue'
      ? `<template><p>{{ '<!--' + t(key) + '-->' }}</p></template>`
      : `<p>{'<!--' + t(key) + '-->'}</p>`);
    await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /explicit includeKeys/, extension);
    await writeFile(file, extension === 'vue'
      ? `<template><p :title="'<!--' + t(key) + '-->'"></p></template>`
      : `<p title={'<!--' + t(key) + '-->'}></p>`);
    await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /explicit includeKeys/, extension);
    await rm(file);
  }
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

test('namespace imports retain exported translator aliases without treating unrelated object methods as translators', async t => {
  const root = await fixture(t), file = path.join(root, 'src/main.ts');
  await writeFile(path.join(root, 'src/translators.ts'), 'const translate = i18n.t; export { translate as message };');
  for (const source of [
    "import * as messages from './translators'; messages.message(key);",
    "messages.message(key); import * as messages from './translators';",
    "import * as messages from './translators'; const { message: msg } = messages; msg(key);",
    "import * as messages from './translators'; const msg = messages.message; msg(key);",
    "import * as messages from './translators'; messages.message.bind(messages)(key);",
    "import * as messages from './translators'; const alias = messages; alias.message(key);",
    "import * as messages from './translators'; const first = messages; const alias = first; alias.message(key);",
    "import * as messages from './translators'; const alias = messages; const { message: msg } = alias; msg(key);",
    "import * as messages from './translators'; passToConsumer(messages);",
    "import * as messages from './translators'; export const forwarded = messages;",
    "import * as messages from './translators'; const copy = { ...messages }; copy.message(key);",
    "import * as messages from './translators'; const { ...copy } = messages; copy.message(key);",
    "import * as messages from './translators'; const { [member]: msg } = messages; msg(key);",
    "import * as messages from './translators'; messages[member](key);",
  ]) {
    await writeFile(file, source);
    await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /Dynamic translation keys/, source);
  }
  await writeFile(file, "import * as messages from './translators'; const { message: msg } = messages; msg(`demo:${suffix}`);");
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), Object.keys(messages).map(key => `demo:${key}`).sort());
  await writeFile(file, 'const logger = getLogger(); logger.message(key);');
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), []);
});

test('namespace tracking follows scanned module exports without classifying unrelated namespaces as translators', async t => {
  const root = await fixture(t), file = path.join(root, 'src/main.ts');
  await writeFile(path.join(root, 'src/translators.ts'), 'const translate = i18n.t; export { translate as message };');
  await writeFile(path.join(root, 'src/helpers.ts'), 'const message = (key: string) => key; export { message };');
  await writeFile(file, `import * as React from 'react'; import * as helpers from './helpers';
    const copy = { ...React }; passToConsumer(React); const { ...rest } = React;
    const local = { ...helpers }; helpers.message(key);`);
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), []);
  await writeFile(path.join(root, 'src/bridge.ts'), `import { message as msg } from './translators.js'; export { msg as text };`);
  await writeFile(file, `import * as messages from './bridge'; messages.text(key);`);
  await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /Dynamic translation keys/);
  await writeFile(file, `import * as messages from './bridge'; messages.text(\`demo:\${suffix}\`);`);
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), Object.keys(messages).map(key => `demo:${key}`).sort());
});

test('Vite watch rebuilds reanalyze edited source keys and fresh catalog contents', { timeout: 20000 }, async t => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'locales/ko'), { recursive: true });
  const catalog = path.join(root, 'locales/ko/demo.json');
  await writeFile(catalog, JSON.stringify({ title: 'WATCH_TITLE_MARKER', two: 'WATCH_TWO_MARKER', unused: 'WATCH_UNUSED_MARKER' }));
  const main = path.join(root, 'src/main.ts');
  await writeFile(path.join(root, 'src/translators.ts'), `import { createStore } from '@0disoft/saylo-core/runtime';
import { initialCatalogs, baseLocale, initialLocale } from 'virtual:saylo';
const store = createStore({ catalogs: initialCatalogs, baseLocale, locale: initialLocale });
const message = store.t; export { message };`);
  const entry = key => `import { message as msg } from '@/translators';
export const value = (suffix = ${JSON.stringify(key.at(-1))}) => msg(\`${key.slice(0, -1)}\${suffix}\`);`;
  await writeFile(main, entry('demo:title'));
  const outputs = [], failures = [];
  const watcher = await build({ configFile: false, root, logLevel: 'silent',
    plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', includeKeys: { from: ['src'] }, typegen: { outFile: 'generated.d.ts' } }),
      { name: 'watch-evidence', generateBundle(_options, bundle) { outputs.push(Object.values(bundle).filter(value => value.type === 'chunk').map(value => value.code).join('\n')); } }],
    resolve: { alias: { '@0disoft/saylo-core/runtime': fileURLToPath(new URL('../../core/dist/runtime.js', import.meta.url)),
      '@': path.join(root, 'src'),
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
