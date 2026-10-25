import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { build } from 'vite';
import { parseCatalog } from '@0disoft/saylo-core';
import saylo from '../dist/index.js';
import { renderCatalogChunk } from '../dist/virtual-modules.js';

const parent = path.resolve(fileURLToPath(new URL('../../../.release/', import.meta.url)));
test('small catalogs retain their original representation without adding a decoder', () => {
  const catalog = parseCatalog('{"hello":"Hello {name}"}', { locale: 'en', namespace: 'demo' });
  const outcome = { status: 'present', key: { locale: 'en', namespace: 'demo' }, sessionId: 'small', catalogVersion: 1,
    namespaceSchemaFingerprint: 'schema', catalog };
  assert.ok(!renderCatalogChunk(outcome).includes('decodeCatalog'));
  assert.throws(() => saylo({ localesDir: 'locales', baseLocale: 'en', compactCatalogs: 'true' }), /compactCatalogs/);
});

test('real compact eager/lazy/SSR builds preserve translation and reduce gzip bytes including decoder cost', async t => {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'compact-build-'));
  t.after(async () => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith('compact-build-'));
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  for (const locale of ['en', 'fr']) {
    await mkdir(path.join(root, 'locales', locale), { recursive: true });
    const messages = Object.fromEntries(Array.from({ length: 3000 }, (_, index) => [`item${index}`, `${locale} item ${index}: {name}`]));
    Object.defineProperty(messages, '__proto__', { value: `${locale} prototype`, enumerable: true });
    await writeFile(path.join(root, 'locales', locale, 'demo.json'), JSON.stringify(messages));
  }
  await writeFile(path.join(root, 'entry.mjs'), `import { createStore, createI18n } from '@0disoft/saylo-core/runtime';
import { initialCatalogs as eager, baseLocale } from 'virtual:saylo';
import { initialCatalogs, catalogSource, initialLocale, initialNamespaces } from 'virtual:saylo/lazy';
export function eagerText(locale) { const store = createStore({ catalogs: eager, baseLocale, locale });
try { return store.t('demo:item2999', { name: 'N' }); } finally { store.dispose(); } }
export async function lazyText(locale) { const instance = createI18n({ catalogSource, initialCatalogs, locale: initialLocale, initialNamespaces });
try { await instance.setLocale(locale); return instance.t('demo:item2999', { name: 'N' }); } finally { instance.dispose(); } }`);
  await writeFile(path.join(root, 'server.mjs'), `import { createRequestI18n } from 'virtual:saylo/server';
export async function render(locale) { const instance = await createRequestI18n({ locale });
try { return instance.t('demo:item2999', { name: 'N' }); } finally { instance.dispose(); } }`);
  const measured = {};
  for (const ssr of [false, true]) for (const compactCatalogs of [false, true]) {
    const label = `${ssr ? 'ssr' : 'browser'}-${compactCatalogs ? 'compact' : 'expanded'}`;
    const result = await build({ root, configFile: false, logLevel: 'silent',
      plugins: [saylo({ localesDir: 'locales', baseLocale: 'en', initialNamespaces: ['demo'], compactCatalogs })],
      build: { ...(ssr ? { ssr: 'server.mjs' } : {}), outDir: label, minify: false, modulePreload: false,
        rolldownOptions: { input: path.join(root, ssr ? 'server.mjs' : 'entry.mjs'), preserveEntrySignatures: 'strict', output: { entryFileNames: 'entry.mjs' } } } });
    const chunks = result.output.filter(output => output.type === 'chunk');
    measured[label] = { raw: chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0),
      gzip: chunks.reduce((sum, chunk) => sum + gzipSync(chunk.code).length, 0) };
    const module = await import(pathToFileURL(path.join(root, label, 'entry.mjs')).href);
    if (ssr) assert.equal(await module.render('fr'), 'fr item 2999: N');
    else {
      assert.equal(module.eagerText('en'), 'en item 2999: N');
      assert.equal(module.eagerText('fr'), 'fr item 2999: N');
      assert.equal(await module.lazyText('fr'), 'fr item 2999: N');
      assert.ok(!chunks.some(chunk => chunk.code.includes('INVALID_UNICODE_ESCAPE_SEQUENCE')));
    }
  }
  t.diagnostic(JSON.stringify(measured));
  assert.ok(measured['browser-compact'].raw < measured['browser-expanded'].raw * 0.65);
  assert.ok(measured['browser-compact'].gzip < measured['browser-expanded'].gzip);
  assert.ok(measured['ssr-compact'].gzip < measured['ssr-expanded'].gzip);
});
