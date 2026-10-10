import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createI18n, serializeBootSnapshot } from '../../packages/core/dist/runtime.js';
import { createLazyLayer } from './lazy-layer.mjs';
import { createLazyFixture } from './lazy-fixture.mjs';

const observations = [];
const factories = { core: options => createI18n(options), layer: createLazyLayer };
const cases = [
  ['empty scope, pair deduplication and old bound namespace errors', async (make, f) => {
    const instance = await make({ initialNamespaces: [], initialCatalogs: [], locale: 'ru' });
    try {
      const old = instance.getSnapshot();
      assert.deepEqual(old.availableNamespaces, ['demo', 'help']); assert.deepEqual(old.loadedNamespaces, []);
      assert.throws(() => old.t('demo:greeting', { name: 'Ada' }), { name: 'NamespaceNotLoadedError' });
      await Promise.all([instance.loadNamespace('demo'), instance.loadNamespace('demo')]);
      assert.equal(f.calls.length, 2); assert.equal(instance.t('demo:greeting', { name: 'Ada' }), 'ru Ada');
      assert.equal(instance.t('demo:rows', { count: 21 }), '21 rows');
      assert.throws(() => old.t('demo:greeting', { name: 'Ada' }), { name: 'NamespaceNotLoadedError' });
      const accepted = instance.getSnapshot(); await instance.refresh(); assert.equal(instance.getSnapshot(), accepted);
    } finally { instance.dispose(); }
  }],
  ['newer locale wins while an older source ignores cancellation', async (make, f) => {
    const instance = await make(); f.hold('ja', 'demo');
    try {
      const pending = instance.setLocale('ja'); const rejected = assert.rejects(pending, { name: 'SupersededRequestError' });
      await f.wait('ja', 'demo'); await instance.setLocale('ru'); await rejected;
      const accepted = instance.getSnapshot(); f.release('ja', 'demo'); await tick();
      assert.equal(instance.getSnapshot(), accepted); assert.equal(instance.t('demo:greeting', { name: 'Ada' }), 'ru Ada');
    } finally { instance.dispose(); f.release('ja', 'demo'); }
  }],
  ['manifest version change aborts an old flight and commits only its newer payload', async (make, f) => {
    const instance = await make(); f.hold('ru', 'demo');
    try {
      const pending = instance.setLocale('ru'); const old = await f.wait('ru', 'demo');
      f.put('ru', 'demo', { greeting: 'Fresh {name}' }); f.unhold('ru', 'demo');
      await Promise.all([pending, instance.refresh()]); assert.equal(old.signal.aborted, true);
      const accepted = instance.getSnapshot(); f.release('ru', 'demo'); await tick();
      assert.equal(instance.getSnapshot(), accepted); assert.equal(instance.t('demo:greeting', { name: 'Ada' }), 'Fresh Ada');
    } finally { instance.dispose(); f.release('ru', 'demo'); }
  }],
  ['invalid translated schema retains last-good and a newer version recovers', async (make, f) => {
    const instance = await make({ locale: 'ru', initialCatalogs: f.seed('ru') });
    try {
      const accepted = instance.getSnapshot(); f.put('ru', 'demo', { greeting: '{unexpected}' });
      await assert.rejects(instance.refresh(), { name: 'CatalogError' }); assert.equal(instance.getSnapshot(), accepted);
      f.put('ru', 'demo', { greeting: 'Recovered {name}' }); await instance.refresh();
      assert.equal(instance.t('demo:greeting', { name: 'Ada' }), 'Recovered Ada');
    } finally { instance.dispose(); }
  }],
  ['locale/namespace removal and namespace addition publish current metadata atomically', async (make, f) => {
    const instance = await make({ locale: 'ru', initialCatalogs: f.seed('ru') });
    try {
      await instance.loadNamespace('help'); const old = instance.getSnapshot();
      f.removeLocale('ru'); await instance.refresh(); assert.equal(instance.getSnapshot().locale, 'en');
      assert.deepEqual(instance.getLocales(), ['en', 'ja']); assert.equal(old.t('help:title', { name: 'Ada' }), 'ru-help Ada');
      f.removeNamespace('help'); await instance.refresh();
      assert.deepEqual(instance.getSnapshot().loadedNamespaces, ['demo']);
      assert.throws(() => instance.t('help:title', { name: 'Ada' }), { name: 'UnknownMessageError' });
      f.put('en', 'extra', { title: 'Extra {name}' }); await instance.refresh();
      assert.deepEqual(instance.getNamespaces(), ['demo', 'extra']);
      assert.throws(() => instance.t('extra:title', { name: 'Ada' }), { name: 'NamespaceNotLoadedError' });
      await instance.loadNamespace('extra'); assert.equal(instance.t('extra:title', { name: 'Ada' }), 'Extra Ada');
    } finally { instance.dispose(); }
  }],
  ['explicit missing pair preserves the selected locale until a translation arrives', async (make, f) => {
    f.remove('ru', 'demo'); const instance = await make({ locale: 'ru', initialCatalogs: f.seed('ru') });
    try {
      const old = instance.getSnapshot(); assert.equal(old.locale, 'ru');
      assert.equal(old.t('demo:greeting', { name: 'Ada' }), 'en Ada');
      f.put('ru', 'demo', { greeting: 'Arrived {name}' }); await instance.refresh();
      assert.equal(instance.getSnapshot().locale, 'ru'); assert.equal(instance.t('demo:greeting', { name: 'Ada' }), 'Arrived Ada');
      assert.equal(old.t('demo:greeting', { name: 'Ada' }), 'en Ada');
    } finally { instance.dispose(); }
  }],
  ['stale registry and retired session are rejected without losing the committed snapshot', async (make, f) => {
    const instance = await make(); const first = f.manifest();
    try {
      f.put('en', 'demo', { greeting: 'Changed {name}' }); await instance.refresh(); const accepted = instance.getSnapshot();
      f.override(first); await assert.rejects(instance.refresh(), { code: 'STALE_MANIFEST' }); assert.equal(instance.getSnapshot(), accepted);
      f.override(undefined); f.switchSession('lazy-second'); await instance.refresh();
      assert.equal(instance.getBootSnapshot().manifest.sessionId, 'lazy-second');
      const second = instance.getSnapshot(); f.override(first);
      await assert.rejects(instance.refresh(), { code: 'STALE_MANIFEST' }); assert.equal(instance.getSnapshot(), second);
    } finally { instance.dispose(); }
  }],
  ['timeout aborts a source that ignores its signal and prevents late publication', async (make, f) => {
    const instance = await make({ requestTimeoutMs: 15 }); f.hold('ru', 'demo');
    try {
      const accepted = instance.getSnapshot(), pending = instance.setLocale('ru');
      const rejected = assert.rejects(pending, { code: 'TIMEOUT' }); const call = await f.wait('ru', 'demo'); await rejected;
      assert.equal(call.signal.aborted, true); f.release('ru', 'demo'); await tick(); assert.equal(instance.getSnapshot(), accepted);
    } finally { instance.dispose(); f.release('ru', 'demo'); }
  }],
  ['disposal aborts loads and attempts every cleanup despite listener failures', async (make, f) => {
    const instance = await make(); f.hold('ru', 'demo');
    const pending = instance.setLocale('ru'), rejected = assert.rejects(pending, { name: 'I18nDisposedError' });
    const call = await f.wait('ru', 'demo'); let cleaned = 0;
    instance.onDispose(() => { throw new Error('cleanup failure'); }); instance.onDispose(() => cleaned++);
    assert.throws(() => instance.dispose(), AggregateError); await rejected; assert.equal(cleaned, 1); assert.equal(call.signal.aborted, true);
    instance.dispose(); f.release('ru', 'demo'); await tick();
    assert.throws(() => instance.subscribe(() => {}), { name: 'I18nDisposedError' });
    await assert.rejects(instance.refresh(), { name: 'I18nDisposedError' });
  }],
  ['independent duplicate subscriptions and post-commit subscriber failures', async (make, f) => {
    const instance = await make(); let duplicates = 0, healthy = 0;
    try {
      const callback = () => duplicates++;
      const unsubscribe = instance.subscribe(callback); instance.subscribe(callback);
      await instance.setLocale('ru'); assert.equal(duplicates, 2); unsubscribe();
      const bad = instance.subscribe(() => { throw new Error('subscriber failure'); }); instance.subscribe(() => healthy++);
      f.put('ru', 'demo', { greeting: 'Committed {name}' }); await assert.rejects(instance.refresh(), AggregateError);
      assert.equal(duplicates, 3); assert.equal(healthy, 1); assert.equal(instance.t('demo:greeting', { name: 'Ada' }), 'Committed Ada');
      bad(); await instance.refresh(); assert.equal(duplicates, 3);
    } finally { instance.dispose(); }
  }],
  ['an unloaded pair update changes boot metadata without publishing or rebuilding an engine', async (make, f) => {
    const instance = await make();
    try {
      const accepted = instance.getSnapshot(); let notifications = 0; instance.subscribe(() => notifications++);
      const before = instance.getProbeStats?.().instances;
      f.put('ru', 'help', { title: 'Unloaded update {name}' }); await instance.refresh();
      assert.equal(instance.getSnapshot(), accepted); assert.equal(notifications, 0);
      assert.equal(instance.getBootSnapshot().manifest.registryRevision, f.manifest().registryRevision);
      assert.equal(instance.getProbeStats?.().instances, before);
      const restored = await make({ initialSnapshot: JSON.parse(serializeBootSnapshot(instance.getBootSnapshot())) });
      assert.equal(restored.t('demo:greeting', { name: 'Ada' }), 'en Ada'); restored.dispose();
    } finally { instance.dispose(); }
  }],
];

for (const [backend, factory] of Object.entries(factories)) for (const [id, run] of cases) test(`${backend}: ${id}`, { timeout: 5000 }, async () => {
  const fixture = createLazyFixture();
  const make = async (options = {}) => factory({ catalogSource: fixture.source, locale: 'en', timeZone: 'UTC',
    initialNamespaces: ['demo'], initialCatalogs: fixture.seed(), ...options });
  await run(make, fixture);
  observations.push({ backend, id, pass: true, sourceLoads: fixture.calls.map(call => ({ id: call.id, sessionId: call.sessionId,
    version: call.version, aborted: call.signal.aborted })) });
});
after(async () => {
  assert.equal(observations.length, cases.length * 2, 'Only a complete passing run may save evidence');
  const files = ['benchmarks/thin-layer/lazy-layer.mjs', 'benchmarks/thin-layer/lazy-source-cache.mjs',
    'benchmarks/thin-layer/lazy-fixture.mjs', 'benchmarks/thin-layer/lazy-contract.test.mjs',
    'benchmarks/thin-layer/catalog-layer.mjs', 'benchmarks/thin-layer/ast-format.mjs', 'benchmarks/thin-layer/package-lock.json',
    'packages/core/dist/i18n.js', 'packages/core/dist/catalog-loader.js', 'packages/core/dist/boot.js',
    'packages/core/dist/loading-registry.js', 'packages/core/dist/schema.js', 'package-lock.json'];
  const root = new URL('../../', import.meta.url);
  const codeHashes = Object.fromEntries(await Promise.all(files.map(async file => [file,
    createHash('sha256').update(await readFile(new URL(file, root))).digest('hex')])));
  await writeFile(new URL('../results/thin-layer-lazy-contracts-2026-10-11.json', import.meta.url), JSON.stringify({
    format: 'saylo-thin-layer-lazy-contracts-v1', observedAt: new Date().toISOString(), node: process.version, codeHashes,
    scope: 'Identical Node public CatalogSource scenarios for Saylo core and an independently implemented i18next lazy coordinator/cache. Both retain Saylo public boot/schema validation. No browser/Vite lazy transport/session-reconnect integration/typegen or performance comparison proof.',
    observations }, null, 2) + '\n');
});
