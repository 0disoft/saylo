import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createI18n, parseCatalog } from '@saylo/core';
import { connectDev, createDevCatalogSource, createStaticCatalogSource } from '../dist/client.js';
import { CatalogRegistry } from '../dist/catalog-registry.js';
import { CATALOG_EVENT, CATALOG_REQUEST_EVENT, DIAGNOSTIC_EVENT, MANIFEST_EVENT, MANIFEST_REQUEST_EVENT, SNAPSHOT_EVENT } from '../dist/types.js';

const catalog = (text, locale = 'ko', namespace = 'demo') => parseCatalog(JSON.stringify({ title: text }), { locale, namespace });
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t) {
  let records = [catalog('한국어'), catalog('English', 'en'), catalog('도움말', 'ko', 'help'), catalog('Help', 'en', 'help')];
  let registry = new CatalogRegistry('one', 'ko', records);
  const hot = new EventEmitter();
  const disposers = [];
  hot.dispose = fn => disposers.push(fn);
  hot.prune = () => {};
  const sent = [];
  const delayed = [];
  let delayCatalogs = false;
  hot.send = (event, request) => {
    sent.push({ event, request });
    if (event === MANIFEST_REQUEST_EVENT) hot.emit(MANIFEST_EVENT, { kind: 'snapshot', request, manifest: registry.manifest() });
    else {
      assert.equal(event, CATALOG_REQUEST_EVENT);
      const reply = { request, result: registry.load(request.locale, request.namespace) };
      delayCatalogs ? delayed.push(reply) : hot.emit(CATALOG_EVENT, reply);
    }
  };
  const initial = [registry.load('ko', 'demo')];
  const source = createDevCatalogSource(registry.manifest(), initial, { hot, requestTimeoutMs: 100 });
  const instance = createI18n({ catalogSource: source, locale: 'ko', initialNamespaces: ['demo'], initialCatalogs: initial });
  t.after(() => { instance.dispose(); source.dispose(); });
  const replace = next => {
    const baseRevision = registry.manifest().registryRevision;
    records = next; registry.replace(next);
    hot.emit(MANIFEST_EVENT, { kind: 'update', baseRevision, manifest: registry.manifest() });
  };
  return { hot, sent, source, instance, delayed, disposers, initial,
    registry: () => registry, records: () => records, delay(value) { delayCatalogs = value; }, replace,
    restart() { registry = new CatalogRegistry('two', 'ko', records); } };
}

test('lazy connection fetches only the selected scope and newly requested namespaces', async t => {
  const f = fixture(t);
  connectDev(f.instance, { catalogSource: f.source });
  assert.equal(f.hot.listenerCount(SNAPSHOT_EVENT), 0);
  assert.equal(f.sent.filter(e => e.event === CATALOG_REQUEST_EVENT).length, 0);
  await f.instance.setLocale('en');
  assert.deepEqual(f.sent.filter(e => e.event === CATALOG_REQUEST_EVENT).map(e => [e.request.locale, e.request.namespace]), [['en', 'demo']]);
  await f.instance.loadNamespace('help');
  assert.equal(f.instance.t('help:title'), 'Help');
  assert.equal(f.sent.filter(e => e.event === CATALOG_REQUEST_EVENT).length, 3);
  assert.ok(Object.isFrozen(f.source.getCatalogs()[0].messages.title.ast));
});

test('loaded edits refresh the UI while inactive and unloaded edits transfer no AST', async t => {
  const f = fixture(t);
  connectDev(f.instance, { catalogSource: f.source });
  const initial = f.instance.getSnapshot();
  f.replace([catalog('한국어'), catalog('Updated English', 'en'), catalog('새 도움말', 'ko', 'help')]);
  await tick();
  assert.equal(f.instance.getSnapshot(), initial);
  assert.equal(f.sent.filter(e => e.event === CATALOG_REQUEST_EVENT).length, 0);
  f.replace([catalog('새 한국어'), catalog('Updated English', 'en'), catalog('새 도움말', 'ko', 'help')]);
  await tick();
  assert.equal(f.instance.t('demo:title'), '새 한국어');
  assert.deepEqual(f.sent.filter(e => e.event === CATALOG_REQUEST_EVENT).map(e => e.request.locale), ['ko']);
});

test('new namespace is loaded through the generic lookup and deletion leaves a versioned tombstone', async t => {
  const f = fixture(t);
  connectDev(f.instance, { catalogSource: f.source });
  f.replace([...f.records(), catalog('새 항목', 'ko', 'new')]);
  await tick();
  await Promise.all([f.instance.setLocale('en'), f.instance.loadNamespace('new')]);
  assert.equal(f.instance.t('new:title'), '새 항목');
  const before = f.registry().load('en', 'demo');
  f.replace(f.records().filter(c => c.locale !== 'en' || c.namespace !== 'demo'));
  await tick();
  assert.equal(f.instance.t('demo:title'), '한국어');
  const missing = f.registry().load('en', 'demo');
  assert.equal(missing.status, 'missing');
  assert.ok(missing.catalogVersion > before.catalogVersion);
});

test('a stale delayed catalog cannot replace the updated pair and unrelated changes do not resend it', async t => {
  const f = fixture(t);
  connectDev(f.instance, { catalogSource: f.source });
  f.delay(true);
  const pending = f.instance.setLocale('en');
  await tick();
  const old = f.delayed[0];
  f.replace([catalog('한국어'), catalog('English', 'en'), catalog('다른 namespace', 'ko', 'help')]);
  await tick();
  assert.equal(f.delayed.length, 1);
  f.delay(false);
  f.replace([catalog('한국어'), catalog('Latest', 'en'), catalog('다른 namespace', 'ko', 'help')]);
  await pending;
  f.hot.emit(CATALOG_EVENT, old);
  assert.equal(f.instance.t('demo:title'), 'Latest');
});

test('disconnect invalidates reply identity and a new session resumes the existing locale intent', async t => {
  const f = fixture(t);
  connectDev(f.instance, { catalogSource: f.source });
  f.delay(true);
  const pending = f.instance.setLocale('en');
  await tick();
  const old = f.delayed[0];
  f.hot.emit('vite:ws:disconnect');
  f.hot.emit(CATALOG_EVENT, old);
  assert.equal(f.instance.getSnapshot().locale, 'ko');
  f.delay(false);
  f.restart();
  f.hot.emit('vite:ws:connect');
  await pending;
  assert.equal(f.source.readManifest().sessionId, 'two');
  assert.equal(f.instance.t('demo:title'), 'English');
  f.hot.emit(CATALOG_EVENT, old);
  assert.equal(f.instance.t('demo:title'), 'English');
});

test('manifest gaps use the snapshot handshake before loading newer catalog stamps', async t => {
  const f = fixture(t);
  connectDev(f.instance, { catalogSource: f.source });
  f.registry().replace([catalog('中間'), catalog('English', 'en')]);
  f.registry().replace([catalog('最新'), catalog('English', 'en')]);
  f.hot.emit(MANIFEST_EVENT, { kind: 'update', baseRevision: 1, manifest: f.registry().manifest() });
  await tick();
  assert.equal(f.sent.filter(e => e.event === MANIFEST_REQUEST_EVENT).length, 2);
  assert.equal(f.instance.t('demo:title'), '最新');
});

test('shared source survives one instance disposal and releases listeners after the final binding', async t => {
  const f = fixture(t);
  const other = createI18n({ catalogSource: f.source, locale: 'ko', initialNamespaces: ['demo'], initialCatalogs: f.initial });
  t.after(() => other.dispose());
  const stop = connectDev(f.instance, { catalogSource: f.source });
  connectDev(other, { catalogSource: f.source });
  assert.equal(connectDev(f.instance, { catalogSource: f.source }), stop);
  f.instance.dispose();
  assert.equal(f.hot.listenerCount(MANIFEST_EVENT), 1);
  await other.setLocale('en');
  assert.equal(other.t('demo:title'), 'English');
  other.dispose();
  assert.equal(f.hot.listenerCount(MANIFEST_EVENT), 0);
  assert.equal(f.hot.listenerCount(CATALOG_EVENT), 0);
  assert.equal(f.hot.listenerCount(DIAGNOSTIC_EVENT), 0);
});

test('source timeout and module disposal reject pending loads and release listeners', async t => {
  const f = fixture(t);
  f.delay(true);
  await assert.rejects(f.source.loadCatalog('en', 'demo'), /timed out/);
  assert.equal(f.hot.listenerCount(MANIFEST_EVENT), 0);
  const pending = f.source.loadCatalog('en', 'demo');
  const rejected = assert.rejects(pending, /disposed/);
  f.disposers[0]();
  await rejected;
  assert.equal(f.hot.listenerCount(CATALOG_EVENT), 0);
});

test('static chunk source consumes the same catalog contract and loads only desired pairs', async t => {
  const f = fixture(t);
  const registry = f.registry();
  const loaded = [];
  const source = createStaticCatalogSource(registry.manifest(), f.initial, registry.manifest().catalogs
    .filter(m => m.key.locale !== 'ko' || m.key.namespace !== 'demo').map(m => ({ key: m.key, load: async () => {
      loaded.push([m.key.locale, m.key.namespace]);
      return registry.load(m.key.locale, m.key.namespace);
    } })));
  const instance = createI18n({ catalogSource: source, locale: 'ko', initialNamespaces: ['demo'], initialCatalogs: f.initial });
  t.after(() => instance.dispose());
  connectDev(instance, { catalogSource: source });
  assert.deepEqual(loaded, []);
  assert.equal(source.getCatalogs().length, 1);
  await Promise.all([instance.setLocale('en'), instance.loadNamespace('help')]);
  assert.equal(instance.t('help:title'), 'Help');
  assert.deepEqual(loaded.sort(), [['en', 'demo'], ['en', 'help'], ['ko', 'help']]);
  await instance.setLocale('ko');
  await instance.setLocale('en');
  assert.equal(loaded.length, 3);
});
