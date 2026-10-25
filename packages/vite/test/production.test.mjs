import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'vite';
import { CatalogError, parseCatalog } from '@0disoft/saylo-core';
import saylo, { loadProjectConfig } from '../dist/index.js';
import { createStaticCatalogSource } from '../dist/client.js';
import { CatalogRegistry } from '../dist/catalog-registry.js';
import { RESOLVED_LAZY, renderVirtualModule } from '../dist/virtual-modules.js';
import { scheduler } from '../../../scripts/test/helpers/scheduler.mjs';
import { inspectProject } from '../../typegen/dist/catalog-audit.js';

function registry() {
  const catalog = (locale, namespace, text) => parseCatalog(JSON.stringify({ title: text }), { locale, namespace });
  return new CatalogRegistry('build', 'ko', [catalog('ko', 'demo', 'BOOT_KO'), catalog('en', 'demo', 'LAZY_EN'),
    catalog('ko', 'help', 'FALLBACK_HELP')]);
}
const entries = r => r.manifest().catalogs.filter(m => m.status === 'present' && m.key.locale !== 'ko')
  .map(m => ({ key: m.key, load: async () => r.load(m.key.locale, m.key.namespace) }));
const boot = r => [r.load('ko', 'demo'), r.load('ko', 'help')];

test('Vite reads the shared JSON settings independently of its project root', async t => {
  const root = await completeFixture(t);
  const file = path.join(root, 'saylo.config.json');
  await writeFile(file, JSON.stringify({ localesDir: 'locales', baseLocale: 'ko', richText: { demo: { hello: ['link'] } } }));
  await writeFile(path.join(root, 'locales/ko/demo.json'), '{"hello":"<lnik>bad</lnik>"}');
  const plugin = saylo(loadProjectConfig(file));
  try { await assert.rejects(plugin.configResolved({ root: os.tmpdir(), command: 'build' }), error => error.diagnostics?.[0].code === 'INVALID_RICH_TEXT'); }
  finally { await plugin.closeBundle(); }
});

test('misspelled rich policy keys fail before replacing generated declarations', async t => {
  const root = await completeFixture(t);
  const out = path.join(root, 'generated.d.ts');
  await writeFile(out, '// last good types');
  for (const richText of [{ missing: { hello: ['link'] } }, { demo: { typo: ['link'] } }]) {
    const plugin = saylo({ localesDir: 'locales', baseLocale: 'ko', richText, typegen: { outFile: 'generated.d.ts' } });
    try { await assert.rejects(plugin.configResolved({ root, command: 'build' }), /absent from the base catalogs/); }
    finally { await plugin.closeBundle(); }
    assert.equal(await readFile(out, 'utf8'), '// last good types');
  }
});

for (const includeKeys of [undefined, ['demo:hello']]) {
  test(`production watch refreshes catalog-only edits (${includeKeys ? 'manual keys' : 'all keys'})`, { timeout: 20000 }, async t => {
    const root = await completeFixture(t);
    await writeFile(path.join(root, 'main.js'), "export { initialCatalogs } from 'virtual:saylo';");
    const outputs = [], failures = [];
    const watcher = await build({ configFile: false, root, logLevel: 'silent',
      plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', includeKeys, typegen: { outFile: 'generated.d.ts' } }),
        { name: 'watch-output', generateBundle(_options, bundle) {
          outputs.push(Object.values(bundle).filter(value => value.type === 'chunk').map(value => value.code).join('\n'));
        } }],
      resolve: { alias: { '@0disoft/saylo-vite/client': fileURLToPath(new URL('../dist/client.js', import.meta.url)) } },
      build: { outDir: 'out', watch: {}, minify: false,
        rolldownOptions: { input: path.join(root, 'main.js'), preserveEntrySignatures: 'strict' } } });
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
      const before = outputs.length;
      await writeFile(path.join(root, 'locales/ko/demo.json'), '{"hello":"WATCH_REFRESHED","added":"new type"}');
      await waitFor(before + 1);
      assert.match(outputs.at(-1), /WATCH_REFRESHED/);
      assert.doesNotMatch(outputs.at(-1), /ko \{name\}/);
      assert.match(await readFile(path.join(root, 'generated.d.ts'), 'utf8'), /demo:added/);
      if (includeKeys) assert.doesNotMatch(outputs.at(-1), /new type/);
    } finally { await watcher.close(); }
  });
}

test('nested production builds release typegen ownership before the outer closeBundle and refresh on rebuild', async t => {
  const root = await completeFixture(t);
  const outer = saylo({ localesDir: 'locales', baseLocale: 'ko', typegen: { outFile: 'generated.d.ts' } });
  const inner = saylo({ localesDir: 'locales', baseLocale: 'ko', typegen: { outFile: 'generated.d.ts' } });
  const context = { addWatchFile() {} };
  try {
    await outer.configResolved({ root, command: 'build' });
    await outer.buildStart.call(context);
    await inner.configResolved({ root, command: 'build' });
    await inner.buildStart.call(context); // SvelteKit starts client build from SSR writeBundle.
    await writeFile(path.join(root, 'locales/ko/demo.json'), '{"hello":"ko {name}","added":"new"}');
    await outer.buildStart.call(context);
    assert.match(await readFile(path.join(root, 'generated.d.ts'), 'utf8'), /demo:added/);
  } finally { await inner.closeBundle(); await outer.closeBundle(); }
});

test('static cancellation is per caller and abandoned imports cannot overwrite a new flight', async () => {
  const r = registry(), clock = scheduler(), loads = [];
  const source = createStaticCatalogSource(r.manifest(), boot(r), [{ key: { locale: 'en', namespace: 'demo' },
    load: () => new Promise((resolve, reject) => loads.push({ resolve, reject })) }], { timeoutMs: 100, schedule: clock.schedule });
  const a = new AbortController(), b = new AbortController(), reason = new Error('navigation');
  const first = assert.rejects(source.loadCatalog('en', 'demo', a.signal), e => e.code === 'ABORTED' && e.cause === reason);
  const second = source.loadCatalog('en', 'demo', b.signal);
  const secondFailure = assert.rejects(second, { code: 'ABORTED' });
  await Promise.resolve(); a.abort(reason); await first;
  assert.equal(loads.length, 1);
  b.abort(); await secondFailure;
  const fresh = source.loadCatalog('en', 'demo'); await Promise.resolve();
  loads[0].resolve(r.load('en', 'demo'));
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(source.getCatalogs().length, 2);
  const joined = source.loadCatalog('en', 'demo'); await Promise.resolve();
  assert.equal(loads.length, 2);
  loads[1].resolve(r.load('en', 'demo'));
  assert.equal(await fresh, await joined);
  assert.equal(clock.size, 0);
});

test('a static source deadline releases hung imports and keeps other consumers active', async () => {
  const r = registry(), clock = scheduler(), loads = [];
  const source = createStaticCatalogSource(r.manifest(), boot(r), [{ key: { locale: 'en', namespace: 'demo' },
    load: () => new Promise((resolve, reject) => loads.push({ resolve, reject })) }], { timeoutMs: 100, schedule: clock.schedule });
  const a = new AbortController();
  const cancelled = assert.rejects(source.loadCatalog('en', 'demo', a.signal), { code: 'ABORTED' });
  const timeout = assert.rejects(source.loadCatalog('en', 'demo'), { code: 'TIMEOUT' });
  await Promise.resolve(); a.abort(); await cancelled;
  clock.tick(99); assert.equal(loads.length, 1);
  clock.tick(1); await timeout;
  const recovered = source.loadCatalog('en', 'demo'); await Promise.resolve();
  loads[0].reject(new Error('late import rejection'));
  loads[1].resolve(r.load('en', 'demo')); await recovered;
  assert.equal(clock.size, 0);
});

async function completeFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-complete-'));
  t.after(async () => {
    const target = path.resolve(root);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('saylo-complete-'));
    await rm(target, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'locales', 'ko'), { recursive: true });
  await writeFile(path.join(root, 'locales', 'ko', 'demo.json'), '{"hello":"ko {name}","empty":"","__proto__":"literal"}');
  await writeFile(path.join(root, 'locales', 'ko', 'help.json'), '{"title":"Help"}');
  await writeFile(path.join(root, 'main.js'), 'export const marker = "built";');
  return root;
}

const completeConfig = (root, options = {}) => ({ configFile: false, root, logLevel: 'silent',
  plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', initialNamespaces: ['demo'],
    typegen: { outFile: 'generated.d.ts' }, ...options })],
  build: { write: false, rolldownOptions: { input: path.join(root, 'main.js') } },
});

test('real builds report all incomplete namespaces/keys before generation, and pass after repair', async t => {
  const root = await completeFixture(t);
  await mkdir(path.join(root, 'locales', 'en'));
  await writeFile(path.join(root, 'locales', 'en', 'demo.json'), '{"empty":""}');
  for (const requireCompleteTranslations of [undefined, false]) {
    await build(completeConfig(root, { requireCompleteTranslations }));
  }
  const out = path.join(root, 'generated.d.ts');
  await writeFile(out, '// Keep last generated types');
  await assert.rejects(build(completeConfig(root, { requireCompleteTranslations: true })), error => {
    assert.ok(error instanceof CatalogError);
    assert.deepEqual(error.diagnostics.map(d => [d.code, d.locale, d.namespace, d.sourceName, d.id]), [
      ['MISSING_MESSAGE', 'en', 'demo', 'en/demo.json', '__proto__'],
      ['MISSING_MESSAGE', 'en', 'demo', 'en/demo.json', 'hello'],
      ['MISSING_NAMESPACE', 'en', 'help', 'en/help.json', undefined],
    ]);
    assert.ok(error.message.includes('en/demo.json [hello]'));
    assert.ok(error.message.includes('locale "en"'));
    assert.ok(error.message.includes('demo:__proto__'));
    assert.ok(error.diagnostics.every(d => d.position === undefined));
    return true;
  });
  assert.equal(await readFile(out, 'utf8'), '// Keep last generated types');
  await writeFile(path.join(root, 'locales', 'en', 'demo.json'), '{"hello":"Translated without interpolation","empty":"","__proto__":""}');
  await writeFile(path.join(root, 'locales', 'en', 'help.json'), '{"title":""}');
  await build(completeConfig(root, { requireCompleteTranslations: true }));
  assert.ok((await readFile(out, 'utf8')).includes('demo:hello'));
});

test('build completeness covers empty directories and absent initial locales using actual folder names', async t => {
  const root = await completeFixture(t);
  await mkdir(path.join(root, 'locales', 'en-us'));
  await assert.rejects(build(completeConfig(root, { requireCompleteTranslations: true, initialLocale: 'fr' })), error => {
    assert.ok(error instanceof CatalogError);
    assert.deepEqual(error.diagnostics.map(d => [d.code, d.locale, d.sourceName]), [
      ['MISSING_NAMESPACE', 'en-US', 'en-us/demo.json'], ['MISSING_NAMESPACE', 'en-US', 'en-us/help.json'],
      ['MISSING_NAMESPACE', 'fr', 'fr/demo.json'], ['MISSING_NAMESPACE', 'fr', 'fr/help.json'],
    ]);
    return true;
  });
  await writeFile(path.join(root, 'locales', 'en-us', 'demo.json'), '{"hello":"Hello","empty":"","__proto__":""}');
  await writeFile(path.join(root, 'locales', 'en-us', 'help.json'), '{"title":"Help"}');
  await build(completeConfig(root, { requireCompleteTranslations: true, initialLocale: 'en-us' }));
});

test('strict builds retain ordinary schema errors and reject non-boolean configuration', async t => {
  const root = await completeFixture(t);
  assert.throws(() => saylo({ localesDir: 'locales', baseLocale: 'ko', requireCompleteTranslations: 'true' }), TypeError);
  await mkdir(path.join(root, 'locales', 'en'));
  await writeFile(path.join(root, 'locales', 'en', 'demo.json'), '{"hello":"{newArgument}"}');
  await assert.rejects(build(completeConfig(root, { requireCompleteTranslations: true })), error => {
    assert.ok(error instanceof CatalogError);
    assert.ok(error.diagnostics.some(d => d.code === 'UNKNOWN_ARGUMENT'));
    assert.ok(error.diagnostics.every(d => d.code !== 'MISSING_MESSAGE' && d.code !== 'MISSING_NAMESPACE'));
    return true;
  });
});

test('JSON-config release locales match CLI targets even when entire directories are absent', async t => {
  const root = await completeFixture(t);
  await mkdir(path.join(root, 'locales', 'en'));
  await writeFile(path.join(root, 'locales', 'en', 'demo.json'), '{}');
  const configPath = path.join(root, 'saylo.config.json');
  await writeFile(configPath, JSON.stringify({ localesDir: 'locales', baseLocale: 'ko', initialLocale: 'fr',
    checkLocales: ['ko', 'ja'], requireCompleteTranslations: true }));
  const config = loadProjectConfig(configPath);
  const { report } = await inspectProject(config);
  const identities = diagnostics => diagnostics.map(d => [d.code, d.locale, d.namespace, d.id]);
  assert.deepEqual(report.locales, ['ko', 'fr', 'ja']);
  const generated = path.join(root, 'generated.d.ts');
  await writeFile(generated, '// retain existing declarations');
  await assert.rejects(build(completeConfig(root, config)), error => {
    assert.ok(error instanceof CatalogError);
    assert.deepEqual(identities(error.diagnostics), identities(report.diagnostics));
    assert.deepEqual(error.diagnostics.map(d => d.sourceName), ['fr/demo.json', 'fr/help.json', 'ja/demo.json', 'ja/help.json']);
    return true;
  });
  assert.equal(await readFile(generated, 'utf8'), '// retain existing declarations');
  for (const locale of ['fr', 'ja']) {
    await mkdir(path.join(root, 'locales', locale));
    for (const namespace of ['demo', 'help']) await writeFile(path.join(root, 'locales', locale, `${namespace}.json`),
      await readFile(path.join(root, 'locales', 'ko', `${namespace}.json`)));
  }
  await build(completeConfig(root, config));
  assert.equal((await inspectProject(config)).report.summary.errors, 0);
});

test('direct completeness targets are validated, canonicalized and detached from caller arrays', async t => {
  for (const checkLocales of ['en', [null], [''], ['not_locale'], ['en-us', 'en-US']]) {
    assert.throws(() => saylo({ localesDir: 'locales', baseLocale: 'ko', checkLocales }));
  }
  const root = await completeFixture(t);
  const targets = ['en-us'];
  const config = completeConfig(root, { requireCompleteTranslations: true, checkLocales: targets });
  targets.length = 0;
  await assert.rejects(build(config), error => error.diagnostics?.every(d => d.locale === 'en-US')
    && error.diagnostics.length === 2);
  await build(completeConfig(root, { requireCompleteTranslations: true, checkLocales: [] }));
});

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

test('static cache budgets keep boot outcomes pinned and evict only settled imports', async () => {
  const catalog = (locale, namespace, text) => parseCatalog(JSON.stringify({ title: text }), { locale, namespace });
  const r = new CatalogRegistry('budget', 'ko', [catalog('ko', 'demo', 'BOOT'), catalog('en', 'demo', 'EN_DEMO'),
    catalog('ko', 'help', 'HELP'), catalog('en', 'help', 'EN_HELP'), catalog('ko', 'extra', 'EXTRA'),
    catalog('en', 'extra', 'EN_EXTRA')]);
  const counts = new Map();
  const allLoaders = r.manifest().catalogs.filter(meta => meta.status === 'present').map(entry => ({ key: entry.key, load: async () => {
    const pair = `${entry.key.locale}/${entry.key.namespace}`;
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
    return r.load(entry.key.locale, entry.key.namespace);
  } }));
  const loaders = allLoaders.filter(entry => !(entry.key.locale === 'ko' && entry.key.namespace === 'demo'));
  const initial = [r.load('ko', 'demo')];
  const zero = createStaticCatalogSource(r.manifest(), initial, loaders, { maxCachedCatalogs: 0 });
  await zero.loadCatalog('en', 'demo');
  assert.equal(zero.getCatalogs().length, 1, 'the unpinned import is not retained');
  await zero.loadCatalog('en', 'demo');
  assert.equal(counts.get('en/demo'), 2);
  assert.equal((await zero.loadCatalog('ko', 'demo')).catalog.messages.title.source, 'BOOT');

  counts.clear();
  const one = createStaticCatalogSource(r.manifest(), [], allLoaders, { maxCachedCatalogs: 1 });
  await one.loadCatalog('en', 'demo');
  await one.loadCatalog('en', 'help');
  await one.loadCatalog('en', 'help');
  assert.equal(counts.get('en/help'), 1, 'the recent catalog remains cached');
  await one.loadCatalog('en', 'demo');
  await one.loadCatalog('en', 'help');
  assert.equal(counts.get('en/demo'), 2);
  assert.equal(counts.get('en/help'), 2, 'the former LRU entry was reloaded');
  assert.equal(one.getCatalogs().length, 1);

  let active = 0;
  let release;
  const dedupedLoaders = allLoaders.map(entry => entry.key.locale === 'en' && entry.key.namespace === 'demo'
    ? { key: entry.key, load: () => { active++; return new Promise(resolve => { release = resolve; }); } } : entry);
  const deduped = createStaticCatalogSource(r.manifest(), [], dedupedLoaders, { maxCachedCatalogs: 0 });
  const first = deduped.loadCatalog('en', 'demo');
  const second = deduped.loadCatalog('en', 'demo');
  await Promise.resolve();
  assert.equal(active, 1);
  release(r.load('en', 'demo'));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(deduped.getCatalogs().length, 0);

  for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => createStaticCatalogSource(r.manifest(), [], allLoaders, { maxCachedCatalogs: invalid }), RangeError);
});

test('production lazy codegen emits the static cache budget only when configured', () => {
  const r = registry();
  const chunks = new Map(entries(r).map(entry => [`virtual:saylo/catalog/${entry.key.locale}/${entry.key.namespace}`,
    r.load(entry.key.locale, entry.key.namespace)]));
  const context = { production: true, sessionId: 'codegen', baseLocale: 'ko', initialLocale: 'ko', timeZone: 'UTC',
    initialNamespaces: ['demo'], registry: r, chunks, catalogs: [], buildCatalogs: [] };
  const omitted = renderVirtualModule(RESOLVED_LAZY, context);
  assert.ok(!omitted.includes('maxCachedCatalogs'));
  const emitted = renderVirtualModule(RESOLVED_LAZY, { ...context, maxCachedCatalogs: 0 });
  assert.match(emitted, /createStaticCatalogSource\([\s\S]+, \{ maxCachedCatalogs: 0 \}\)/);
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
      JSON.stringify({ title: `${locale === 'ko' && namespace === 'demo' ? 'BOOT' : 'LAZY'}_${locale}_${namespace}`,
        number: '{n, number}', date: '{at, date, short}', time: '{at, time, ::HHmm}',
        plural: '{n, plural, offset:1 =0 {None} one {# one} other {# many}}',
        ordinal: '{n, selectordinal, one {#st} other {#th}}',
        select: '{who, select, a {A} other {Other}}',
        nested: '{n, plural, one {{who, select, a {OneA} other {OneOther}}} other {Other #}}',
        tag: '<b>{name}</b>', rich: '<link>{n, plural, one {<strong># item</strong>} other {<strong># items</strong>}}</link>' }));
  }
  await writeFile(path.join(root, 'locales', 'en', 'help.json'), '{}'); // Key fallback inside a present chunk.
  await writeFile(path.join(root, 'main.js'), `import { createI18n } from '@0disoft/saylo-core/runtime';
import { catalogSource, initialCatalogs, initialLocale, initialNamespaces } from 'virtual:saylo/lazy';
export const source = catalogSource;
export const instance = createI18n({ catalogSource, initialCatalogs, locale: initialLocale, initialNamespaces });`);
  const config = (astRuntime = true) => ({ configFile: false, root, logLevel: 'silent',
    plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', initialNamespaces: ['demo'], timeZone: 'UTC', astRuntime,
      richText: { demo: { rich: ['link', 'strong'] }, help: { rich: ['link', 'strong'] } },
      typegen: { outFile: 'generated.d.ts' } })],
    resolve: { alias: { '@0disoft/saylo-core/runtime': fileURLToPath(new URL('../../core/dist/runtime.js', import.meta.url)),
      '@0disoft/saylo-core': fileURLToPath(new URL('../../core/dist/index.js', import.meta.url)),
      'intl-messageformat': fileURLToPath(import.meta.resolve('intl-messageformat')),
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
  assert.ok(!chunks.some(chunk => chunk.code.includes('EXPECT_ARGUMENT_CLOSING_BRACE')), 'AST runtime must not include the ICU parser');
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
  assert.deepEqual(instance.tParts('demo:rich', { n: 3 }), [{ type: 'tag', name: 'link', children: [
    { type: 'tag', name: 'strong', children: [{ type: 'text', value: '3 items' }] },
  ] }]);
  assert.deepEqual(instance.tParts('help:tag', { name: '<script>literal</script>' }), [
    { type: 'tag', name: 'b', children: [{ type: 'text', value: '<script>literal</script>' }] },
  ]);
  const vectors = [
    ['number', { n: 1234.5 }], ['date', { at: new Date('2024-01-02T03:04:00Z') }],
    ['time', { at: new Date('2024-01-02T03:04:00Z') }], ['plural', { n: 3 }],
    ['ordinal', { n: 1 }], ['select', { who: 'a' }], ['nested', { n: 1, who: 'a' }], ['tag', { name: 'Ada' }],
  ];
  const actual = vectors.map(([id, args]) => instance.t(`demo:${id}`, args));
  const baseline = await build(config(false));
  const normalChunks = baseline.output.filter(o => o.type === 'chunk');
  assert.ok(normalChunks.some(chunk => chunk.code.includes('EXPECT_ARGUMENT_CLOSING_BRACE')));
  const normalEntry = normalChunks.find(o => o.isEntry);
  const normal = await import(pathToFileURL(path.join(root, 'dist', normalEntry.fileName)));
  t.after(() => normal.instance.dispose());
  await normal.instance.setLocale('en');
  assert.deepEqual(normal.instance.tParts('demo:rich', { n: 3 }), instance.tParts('demo:rich', { n: 3 }));
  assert.deepEqual(vectors.map(([id, args]) => normal.instance.t(`demo:${id}`, args)), actual);
  const bytes = values => values.reduce((total, chunk) => total + Buffer.byteLength(chunk.code), 0);
  assert.ok(bytes(chunks) < bytes(normalChunks));
  console.log(`[ast-runtime] fixture unminified JS: ${bytes(normalChunks)} -> ${bytes(chunks)} bytes`);

  // A separate string-based FormatJS user must still have its parser, even with Saylo optimization enabled.
  await writeFile(path.join(root, 'main.js'), `import { IntlMessageFormat } from 'intl-messageformat';
import { createI18n } from '@0disoft/saylo-core/runtime';
import { catalogSource, initialCatalogs, initialLocale, initialNamespaces } from 'virtual:saylo/lazy';
export const externalText = new IntlMessageFormat('Hello {name}', 'en').format({ name: 'Ada' });
export const instance = createI18n({ catalogSource, initialCatalogs, locale: initialLocale, initialNamespaces });`);
  const mixed = await build(config());
  const mixedEntry = mixed.output.find(o => o.type === 'chunk' && o.isEntry);
  const other = await import(pathToFileURL(path.join(root, 'dist', mixedEntry.fileName)));
  t.after(() => other.instance.dispose());
  assert.equal(other.externalText, 'Hello Ada');
  assert.ok(mixed.output.some(o => o.type === 'chunk' && o.code.includes('EXPECT_ARGUMENT_CLOSING_BRACE')));
  await writeFile(path.join(root, 'locales', 'en', 'demo.json'), '{"rich":"<lnik>typo</lnik>"}');
  await assert.rejects(build(config()), error => error.diagnostics?.[0].code === 'INVALID_RICH_TEXT');
  await writeFile(path.join(root, 'locales', 'en', 'demo.json'), '{"rich":"<link>unclosed"}');
  await assert.rejects(build(config()), error => error.diagnostics?.[0].code === 'INVALID_RICH_TEXT');
  await writeFile(path.join(root, 'locales', 'en', 'demo.json'), '{');
  await assert.rejects(build(config()));
});
