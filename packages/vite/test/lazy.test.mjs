import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createI18n, parseCatalog } from '@saylo/core';
import { connectDev, createDevCatalogSource, createStaticCatalogSource } from '../dist/client.js';
import { CatalogRegistry } from '../dist/catalog-registry.js';
import { CATALOG_EVENT, CATALOG_REQUEST_EVENT, DIAGNOSTIC_EVENT, MANIFEST_EVENT, MANIFEST_REQUEST_EVENT, SNAPSHOT_EVENT, isCatalogRequest } from '../dist/types.js';

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
  const replies = [];
  const delayed = [];
  let delayCatalogs = false;
  hot.send = (event, request) => {
    sent.push({ event, request });
    if (event === MANIFEST_REQUEST_EVENT) hot.emit(MANIFEST_EVENT, { kind: 'snapshot', request, manifest: registry.manifest() });
    else {
      assert.equal(event, CATALOG_REQUEST_EVENT);
      assert.ok(isCatalogRequest(request), 'Client catalog frames must satisfy the actual server validator.');
      const reply = JSON.parse(JSON.stringify({ request, result: registry.loadDelta(request.locale, request.namespace, request.known) }));
      replies.push(reply);
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
  return { hot, sent, replies, source, instance, delayed, disposers, initial,
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

test('loaded edits negotiate sparse deltas and reuse immutable unchanged messages', async t => {
  const f = fixture(t);
  const next = text => parseCatalog(JSON.stringify({ title: text, keep: '{name}', extra: 'extra' }), { locale: 'ko', namespace: 'demo' });
  f.replace([next('first'), ...f.records().filter(c => c.locale !== 'ko' || c.namespace !== 'demo')]);
  connectDev(f.instance, { catalogSource: f.source });
  await f.instance.refresh();
  const before = f.source.getCatalogs().find(c => c.locale === 'ko' && c.namespace === 'demo');
  f.replace([next('later'), ...f.records().filter(c => c.locale !== 'ko' || c.namespace !== 'demo')]);
  await f.instance.refresh();
  const reply = f.replies.at(-1);
  assert.equal(reply.result.status, 'patch');
  assert.deepEqual(reply.result.upsert.map(([id]) => id), ['title']);
  assert.equal(reply.result.positions.length, 0);
  const after = f.source.getCatalogs().find(c => c.locale === 'ko' && c.namespace === 'demo');
  assert.equal(after.messages.keep, before.messages.keep);
  assert.equal(f.instance.t('demo:title'), 'later');
  assert.ok(Object.isFrozen(after.messages.title.ast));
});

test('a broken delta retries once with a new full request and ignores the superseded reply', async t => {
  const f = fixture(t);
  connectDev(f.instance, { catalogSource: f.source });
  f.delay(true);
  f.replace([catalog('최신 한국어'), ...f.records().filter(c => c.locale !== 'ko' || c.namespace !== 'demo')]);
  await tick();
  const broken = f.delayed.shift();
  assert.equal(broken.result.status, 'patch');
  f.hot.emit(CATALOG_EVENT, { ...broken, result: { ...broken.result, remove: ['absent'] } });
  const recovered = f.delayed.shift();
  assert.equal(recovered.request.known, undefined);
  assert.notEqual(recovered.request.requestId, broken.request.requestId);
  assert.equal(recovered.result.status, 'present');
  f.hot.emit(CATALOG_EVENT, broken);
  assert.equal(f.instance.t('demo:title'), '한국어');
  f.hot.emit(CATALOG_EVENT, recovered);
  await tick();
  assert.equal(f.instance.t('demo:title'), '최신 한국어');
});

test('a repeatedly malformed patch cannot loop full recovery or mutate the current UI', async t => {
  const f = fixture(t);
  f.delay(true);
  const stop = f.source.connect();
  t.after(stop);
  f.replace([catalog('latest'), ...f.records().filter(c => c.locale !== 'ko' || c.namespace !== 'demo')]);
  const pending = f.source.loadCatalog('ko', 'demo');
  const rejected = assert.rejects(pending, /Unexpected patch/);
  const broken = f.delayed.shift();
  f.hot.emit(CATALOG_EVENT, { ...broken, result: { ...broken.result, upsert: null } });
  const full = f.delayed.shift();
  f.hot.emit(CATALOG_EVENT, { request: full.request, result: broken.result });
  await rejected;
  assert.equal(f.sent.filter(e => e.event === CATALOG_REQUEST_EVENT).length, 2);
  assert.equal(f.instance.t('demo:title'), '한국어');
});

test('shared instances can receive same-baseline patches in reverse order', async t => {
  const f = fixture(t);
  const other = createI18n({ catalogSource: f.source, locale: 'ko', initialNamespaces: ['demo'], initialCatalogs: f.initial });
  t.after(() => other.dispose());
  connectDev(f.instance, { catalogSource: f.source });
  connectDev(other, { catalogSource: f.source });
  f.delay(true);
  f.replace([catalog('shared latest'), ...f.records().filter(c => c.locale !== 'ko' || c.namespace !== 'demo')]);
  await tick();
  assert.equal(f.delayed.length, 2);
  assert.ok(f.delayed.every(reply => reply.result.status === 'patch'));
  for (const reply of f.delayed.reverse()) f.hot.emit(CATALOG_EVENT, reply);
  await tick();
  assert.equal(f.instance.t('demo:title'), 'shared latest');
  assert.equal(other.t('demo:title'), 'shared latest');
});

test('reconnecting with a patch pending uses the new session and retains the last good UI until a full reply', async t => {
  const f = fixture(t);
  connectDev(f.instance, { catalogSource: f.source });
  f.delay(true);
  f.replace([catalog('latest after restart'), ...f.records().filter(c => c.locale !== 'ko' || c.namespace !== 'demo')]);
  await tick();
  const oldPatch = f.delayed.shift();
  assert.equal(oldPatch.result.status, 'patch');
  f.hot.emit('vite:ws:disconnect');
  f.restart();
  f.hot.emit('vite:ws:connect');
  await tick();
  f.hot.emit(CATALOG_EVENT, oldPatch);
  assert.equal(f.instance.t('demo:title'), '한국어');
  const full = f.delayed.at(-1);
  assert.equal(full.result.status, 'present');
  assert.equal(full.result.sessionId, 'two');
  f.hot.emit(CATALOG_EVENT, full);
  await tick();
  assert.equal(f.instance.t('demo:title'), 'latest after restart');
});

test('base and translation schema deltas publish together after both current pairs arrive', async t => {
  const f = fixture(t);
  connectDev(f.instance, { catalogSource: f.source });
  await f.instance.setLocale('en');
  const previous = f.instance.getSnapshot();
  f.delay(true);
  f.replace([catalog('{n, number}'), catalog('items', 'en'), ...f.records().filter(c => c.namespace !== 'demo')]);
  await tick();
  assert.equal(f.delayed.length, 2);
  assert.ok(f.delayed.every(reply => reply.result.status === 'patch'));
  f.hot.emit(CATALOG_EVENT, f.delayed[0]);
  await tick();
  assert.equal(f.instance.getSnapshot(), previous);
  f.hot.emit(CATALOG_EVENT, f.delayed[1]);
  await tick();
  assert.equal(f.instance.t('demo:title', { n: 3 }), 'items');
  assert.throws(() => f.instance.t('demo:title'), /argument/i);
});
