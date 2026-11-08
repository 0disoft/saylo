import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'vite';
import { parseCatalog } from '@0disoft/saylo-core';
import saylo from '../dist/index.js';
import { findIncludedKeys } from '../dist/auto-keys.js';

const parent = fileURLToPath(new URL('../../../.release/', import.meta.url));
async function fixture(t) {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'auto-key-reexports-'));
  t.after(async () => {
    assert.equal(path.dirname(root), parent.replace(/[\\/]$/, ''));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  return root;
}
const messages = { title: 'Hello', one: 'One', two: 'Two', unused: 'Unused' };
const catalogs = [parseCatalog(JSON.stringify(messages), { locale: 'ko', namespace: 'demo' })];

test('wildcard barrel chains and cycles preserve translator aliases and dynamic diagnostics', async t => {
  const root = await fixture(t), main = path.join(root, 'src/main.ts');
  await writeFile(path.join(root, 'src/translators.ts'), 'export const translate = i18n.t;');
  await writeFile(path.join(root, 'src/bridge.ts'), "export * from './translators.js'; export * from './index.js';");
  await writeFile(path.join(root, 'src/index.ts'), "export * from './bridge.js';");
  for (const source of [
    "import * as messages from './index'; messages.translate(`demo:${suffix}`);",
    "import { translate as message } from './index'; message(`demo:${suffix}`);",
    "import * as messages from './index'; const { translate: message } = messages; message(`demo:${suffix}`);",
  ]) {
    await writeFile(main, source);
    assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), Object.keys(messages).map(key => `demo:${key}`).sort());
  }
  await writeFile(main, "import * as messages from './index'; messages.translate(key);");
  await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /Dynamic translation keys/);
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'], dynamicKeys: ['demo:two'] }), ['demo:two']);
  // A local named export overrides the star; ordinary callbacks are not translators.
  await writeFile(path.join(root, 'src/index.ts'), "export * from './bridge.js'; export const translate = (key: string) => key;");
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), []);
});

test('wildcard reexports resolve configured aliases and reject unscanned targets', async t => {
  const root = await fixture(t), translator = path.join(root, 'src/translators.ts');
  await writeFile(translator, 'export const translate = i18n.t;');
  await writeFile(path.join(root, 'src/main.ts'), "import * as messages from './index'; messages.translate(`demo:${suffix}`);");
  const barrel = path.join(root, 'src/index.ts');
  await writeFile(barrel, "export * from '@/translators';");
  const resolve = async id => id === '@/translators' ? translator : undefined;
  assert.deepEqual(await findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }, undefined, resolve), Object.keys(messages).map(key => `demo:${key}`).sort());
  const outside = path.join(root, 'hidden.ts');
  await writeFile(outside, 'intentionally invalid source, never read');
  await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }, undefined,
    async id => id === '@/translators' ? outside : undefined), /outside scanned sources/);
  await writeFile(barrel, "export * from '../hidden';");
  await assert.rejects(findIncludedKeys(root, catalogs, 'ko', { from: ['src'] }), /Wildcard reexport.*scanned sources/);
});

test('real production bundles retain wildcard-reexported template keys in eager and lazy catalogs', async t => {
  const root = await fixture(t);
  for (const locale of ['ko', 'en']) {
    await mkdir(path.join(root, 'locales', locale), { recursive: true });
    await writeFile(path.join(root, 'locales', locale, 'demo.json'), JSON.stringify(locale === 'ko'
      ? { 'retained.hello': 'Hello!', 'retained.fallback': 'Base only', unused: 'STAR_UNUSED_MARKER' }
      : { 'retained.hello': 'English!' }));
  }
  await writeFile(path.join(root, 'src/bridge.ts'), "export * from './translators.js';");
  await writeFile(path.join(root, 'src/index.ts'), "export * from './bridge.js';");
  await writeFile(path.join(root, 'src/main.ts'), `import * as messages from './index';
export { store } from './translators';
export const translate = (suffix = 'hello') => messages.text(\`demo:retained.\${suffix}\`);`);
  for (const lazy of [false, true]) {
    await writeFile(path.join(root, 'src/translators.ts'), lazy
      ? `import { createI18n } from '@0disoft/saylo-core/runtime';
import { catalogSource, initialCatalogs, initialLocale, initialNamespaces } from 'virtual:saylo/lazy';
export const store = createI18n({ catalogSource, initialCatalogs, locale: initialLocale, initialNamespaces });
export const text = store.t;`
      : `import { createStore } from '@0disoft/saylo-core/runtime';
import { initialCatalogs, baseLocale, initialLocale } from 'virtual:saylo';
export const store = createStore({ catalogs: initialCatalogs, baseLocale, locale: initialLocale });
export const text = store.t;`);
    const outDir = lazy ? 'out-lazy' : 'out-eager';
    const result = await build({ configFile: false, root, logLevel: 'silent',
      plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', includeKeys: { from: ['src'] }, typegen: { outFile: 'generated.d.ts' } })],
      resolve: { alias: { '@0disoft/saylo-core/runtime': fileURLToPath(new URL('../../core/dist/runtime.js', import.meta.url)),
        '@0disoft/saylo-vite/client': fileURLToPath(new URL('../dist/client.js', import.meta.url)) } },
      build: { outDir, rolldownOptions: { input: path.join(root, 'src/main.ts'), preserveEntrySignatures: 'strict' } } });
    const chunks = result.output.filter(value => value.type === 'chunk');
    assert.ok(chunks.every(chunk => !chunk.code.includes('STAR_UNUSED_MARKER')));
    const entry = chunks.find(chunk => chunk.isEntry);
    const app = await import(pathToFileURL(path.join(root, outDir, entry.fileName)));
    t.after(() => app.store.dispose());
    assert.equal(app.translate(), 'Hello!');
    await app.store.setLocale('en');
    assert.equal(app.translate(), 'English!');
    assert.equal(app.translate('fallback'), 'Base only');
    assert.throws(() => app.store.t('demo:unused'), { name: 'UnknownMessageError' });
  }
});

