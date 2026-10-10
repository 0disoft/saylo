import test from 'node:test';
import assert from 'node:assert/strict';
import i18next from 'i18next';
import { createI18n, serializeBootSnapshot } from '@0disoft/saylo-core/runtime';
import { createCatalogLayerSync } from './catalog-layer.mjs';
import { createLazyLayer, createLazyLayerSync } from './lazy-layer.mjs';
import { createLazyFixture } from './lazy-fixture.mjs';

for (const [name, create] of Object.entries({ core: createI18n, layer: createLazyLayerSync })) {
  test(`${name}: seeded boot translation and object restoration are ready before return`, () => {
    const f = createLazyFixture();
    const instance = create({ catalogSource: f.source, locale: 'ru', timeZone: 'UTC',
      initialNamespaces: ['demo'], initialCatalogs: f.seed('ru') });
    try {
      assert.equal(instance.then, undefined);
      assert.equal(instance.t('demo:greeting', { name: 'Ada' }), 'ru Ada');
      assert.equal(instance.t('demo:rows', { count: 21 }), '21 rows');
      assert.equal(instance.t('demo:when', { at: Date.parse('2026-01-01T00:30:00Z') }), '1/1/2026');
      assert.equal(instance.getSnapshot(), instance.getServerSnapshot());
      const restored = create({ catalogSource: f.source, initialSnapshot: instance.getBootSnapshot() });
      try { assert.equal(restored.t('demo:greeting', { name: 'Ada' }), 'ru Ada'); }
      finally { restored.dispose(); }
      assert.equal(f.calls.length, 0, 'Seeded creation does not start a source load');
    } finally { instance.dispose(); }
  });
  test(`${name}: empty boot is ready synchronously, network scope remains asynchronous`, async () => {
    const f = createLazyFixture();
    const instance = create({ catalogSource: f.source, locale: 'ru', initialNamespaces: [], initialCatalogs: [] });
    try {
      const cold = instance.getSnapshot();
      assert.equal(instance.then, undefined); assert.deepEqual(cold.loadedNamespaces, []);
      assert.throws(() => instance.t('demo:greeting', { name: 'Ada' }), { name: 'NamespaceNotLoadedError' });
      f.hold('ru', 'demo'); const loading = instance.loadNamespace('demo');
      assert.ok(loading instanceof Promise); assert.equal(instance.getSnapshot(), cold);
      await f.wait('ru', 'demo'); f.release('ru', 'demo'); await loading;
      assert.equal(instance.t('demo:greeting', { name: 'Ada' }), 'ru Ada');
      assert.throws(() => cold.t('demo:greeting', { name: 'Ada' }), { name: 'NamespaceNotLoadedError' });
    } finally { instance.dispose(); f.release('ru', 'demo'); }
  });
  test(`${name}: invalid seed fails within the constructor call`, () => {
    const f = createLazyFixture();
    assert.throws(() => create({ catalogSource: f.source, locale: 'ru', initialNamespaces: ['demo'], initialCatalogs: [] }),
      { name: 'CatalogLoadError' });
  });
}
test('sync JSON boot restoration and the existing async factory both remain available', async () => {
  const f = createLazyFixture();
  const instance = createLazyLayerSync({ catalogSource: f.source, locale: 'ru', initialNamespaces: ['demo'], initialCatalogs: f.seed('ru') });
  try {
    const restored = createLazyLayerSync({ catalogSource: f.source, initialSnapshot: serializeBootSnapshot(instance.getBootSnapshot()) });
    try { assert.equal(restored.t('demo:greeting', { name: 'Ada' }), 'ru Ada'); } finally { restored.dispose(); }
    const pending = createLazyLayer({ catalogSource: f.source, locale: 'ru', initialNamespaces: [], initialCatalogs: [] });
    assert.ok(pending instanceof Promise); (await pending).dispose();
    await assert.rejects(createLazyLayer({ catalogSource: f.source, locale: 'ru', initialNamespaces: ['demo'], initialCatalogs: [] }),
      { name: 'CatalogLoadError' });
  } finally { instance.dispose(); }
});
test('non-synchronous resource initialization fails before publishing a replacement', () => {
  const f = createLazyFixture(), catalogs = f.seed('ru').map(outcome => outcome.catalog);
  const layer = createCatalogLayerSync('en', catalogs, 'ru'), before = layer.getSnapshot();
  const original = i18next.createInstance;
  try {
    i18next.createInstance = () => ({ use() { return this; }, init: () => Promise.resolve(), isInitialized: false });
    assert.throws(() => layer.replace(catalogs), /did not initialize synchronously/);
    assert.equal(layer.getSnapshot(), before);
  } finally { i18next.createInstance = original; }
});
