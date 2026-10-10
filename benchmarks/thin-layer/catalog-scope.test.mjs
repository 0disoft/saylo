import test from 'node:test';
import assert from 'node:assert/strict';
import { createBootSnapshot, serializeBootSnapshot, parseCatalog } from '../../packages/core/dist/index.js';
import { createCatalogLayer } from './catalog-layer.mjs';
import { createHydrationLayer } from './hydration-layer.mjs';
import { createSsrFixture } from './ssr-fixture.mjs';

test('valid empty boot restores declared metadata and distinguishes unloaded from unknown namespaces', async () => {
  const fixture = createSsrFixture();
  const boot = createBootSnapshot({ ...fixture.boot, loadedNamespaces: [], catalogOutcomes: [] });
  const layer = await createHydrationLayer(serializeBootSnapshot(boot));
  const snapshot = layer.getSnapshot();
  assert.equal(snapshot.locale, 'ru'); assert.deepEqual(snapshot.availableLocales, ['en', 'ru']);
  assert.deepEqual(snapshot.availableNamespaces, ['demo']); assert.deepEqual(snapshot.loadedNamespaces, []);
  assert.throws(() => snapshot.t('demo:greeting', { name: 'Ada' }), { name: 'NamespaceNotLoadedError' });
  assert.throws(() => snapshot.t('absent:greeting'), { name: 'UnknownMessageError' });
  await layer.replace(fixture.catalogs); layer.finishHydration();
  assert.deepEqual(layer.getSnapshot().loadedNamespaces, ['demo']);
  assert.throws(() => snapshot.t('demo:greeting', { name: 'Ada' }), { name: 'NamespaceNotLoadedError' });
  layer.dispose();
});

test('a new manifest scope adds a locale/namespace and removes selection atomically without changing old snapshots', async () => {
  const catalog = (locale, namespace, title) => parseCatalog(JSON.stringify({ title }), { locale, namespace });
  const base = catalog('en', 'demo', 'Base');
  const layer = await createCatalogLayer('en', [base], 'ru', { availableLocales: ['en', 'ru'],
    availableNamespaces: ['demo', 'help'], loadedNamespaces: ['demo'] });
  const retained = layer.getSnapshot();
  assert.throws(() => retained.t('help:title'), { name: 'NamespaceNotLoadedError' });
  await layer.replace([base, catalog('en', 'help', 'Help'), catalog('ja', 'demo', 'Japanese')], 'ja', {
    availableLocales: ['en', 'ja'], availableNamespaces: ['demo', 'help'], loadedNamespaces: ['demo', 'help'],
  });
  assert.equal(layer.getSnapshot().t('demo:title'), 'Japanese');
  assert.equal(layer.getSnapshot().t('help:title'), 'Help');
  assert.equal(retained.locale, 'ru'); assert.deepEqual(retained.availableLocales, ['en', 'ru']);
  await layer.replace([base], 'ja', { availableLocales: ['en'], availableNamespaces: ['demo'], loadedNamespaces: ['demo'] });
  assert.equal(layer.getSnapshot().locale, 'en'); assert.deepEqual(layer.getSnapshot().availableNamespaces, ['demo']);
});

test('invalid replacement scope retains the last accepted engine and metadata', async () => {
  const catalogs = createSsrFixture().catalogs;
  const layer = await createCatalogLayer('en', catalogs, 'ru');
  const retained = layer.getSnapshot();
  await assert.rejects(layer.replace(catalogs, 'ru', { availableLocales: ['en'], loadedNamespaces: ['demo'] }));
  assert.equal(layer.getSnapshot(), retained);
  await assert.rejects(layer.replace(catalogs, 'ru', { availableNamespaces: ['demo'], loadedNamespaces: ['help'] }));
  assert.equal(layer.getSnapshot(), retained);
});
