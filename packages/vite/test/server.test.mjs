import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build, createServer } from 'vite';
import saylo from '../dist/index.js';

async function fixture(t) {
  // Inside this package so the SSR external Node import resolves the actual workspace package.
  const root = await mkdtemp(path.join(fileURLToPath(new URL('../', import.meta.url)), '.ssr-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, ''));
    assert.ok(path.basename(root).startsWith('.ssr-test-'));
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  for (const locale of ['ko', 'en']) {
    await mkdir(path.join(root, 'locales', locale), { recursive: true });
    await writeFile(path.join(root, 'locales', locale, 'demo.json'), JSON.stringify({ title: `${locale}_SSR` }));
  }
  await writeFile(path.join(root, 'main.mjs'), `import { createRequestI18n, catalogSource } from 'virtual:saylo/server';
import { serializeBootSnapshot } from '@0disoft/saylo-core';
export { catalogSource };
export async function render(locale) {
  const instance = await createRequestI18n({ locale });
  try { return { title: instance.getServerSnapshot().t('demo:title'), boot: serializeBootSnapshot(instance.getBootSnapshot()) }; }
  finally { instance.dispose(); }
}`);
  return { root, config: { configFile: false, root, logLevel: 'silent',
    plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', initialNamespaces: ['demo'] })] } };
}

test('Vite SSR dev requests see current catalogs without invalidating the server module, then release the source', async t => {
  const { root, config } = await fixture(t);
  const server = await createServer({ ...config, server: { middlewareMode: true } });
  t.after(() => server.close());
  const module = await server.ssrLoadModule('/main.mjs');
  const [ko, en] = await Promise.all([module.render('ko'), module.render('en')]);
  assert.equal(ko.title, 'ko_SSR');
  assert.equal(en.title, 'en_SSR');
  const file = path.join(root, 'locales', 'ko', 'demo.json');
  await writeFile(file, '{"title":"ko_UPDATED"}');
  // Observe the real watcher; no manual plugin callback and no module reload.
  const deadline = Date.now() + 5000;
  while (module.catalogSource.readManifest().registryRevision === 0 && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(module.catalogSource.readManifest().registryRevision > 0);
  assert.equal((await module.render('ko')).title, 'ko_UPDATED');
  assert.ok(ko.boot.includes('ko_SSR') && !ko.boot.includes('ko_UPDATED'));
  await server.close();
  await assert.rejects(module.render('ko'), /unavailable|closed/);
});

test('Vite production SSR bundle prepares independent requests using static catalog imports', async t => {
  const { root, config } = await fixture(t);
  const result = await build({ ...config, build: { ssr: path.join(root, 'main.mjs'), minify: false,
    rolldownOptions: { external: [], preserveEntrySignatures: 'strict' } }, ssr: { noExternal: ['@0disoft/saylo-core'] } });
  const chunks = result.output.filter(o => o.type === 'chunk');
  assert.equal(chunks.filter(o => o.isDynamicEntry).length, 1);
  const entry = chunks.find(o => o.isEntry);
  assert.ok(!entry.code.includes('getServerCatalogSource') && !entry.code.includes('createDevCatalogSource'));
  const module = await import(pathToFileURL(path.join(root, 'dist', entry.fileName)));
  const [ko, en] = await Promise.all([module.render('ko'), module.render('en')]);
  assert.equal(ko.title, 'ko_SSR');
  assert.equal(en.title, 'en_SSR');
  assert.equal(JSON.parse(ko.boot).locale, 'ko');
  assert.equal(JSON.parse(en.boot).locale, 'en');
});
