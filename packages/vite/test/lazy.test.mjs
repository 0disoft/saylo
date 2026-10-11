import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createI18n, parseCatalog } from '@0disoft/saylo-core';
import { connectDev, createDevCatalogSource, createStaticCatalogSource, createSupportRecorder } from '../dist/client.js';
import { CatalogRegistry } from '../dist/catalog-registry.js';
import { encodeCatalogResult } from '../dist/catalog-wire.js';
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
      const reply = JSON.parse(JSON.stringify({ request, result: encodeCatalogResult(registry.loadDelta(request.locale, request.namespace, request.known)) }));
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

test('initial lazy update and diagnostic observer failures retain the binding and subsequent locale intent', async t => {
  const f = fixture(t);
  const diagnostics = [];
  let updates = 0;
  let stop;
  assert.doesNotThrow(() => {
    stop = connectDev(f.instance, { catalogSource: f.source,
      onUpdate: () => { updates++; throw new Error('update view failed'); },
      onDiagnostic: diagnostic => { diagnostics.push(diagnostic); throw new Error('diagnostic view failed'); }
    });
  });
  assert.equal(typeof stop, 'function');
  assert.equal(f.hot.listenerCount(MANIFEST_EVENT), 1);
  assert.equal(f.source.getSyncState().status, 'connected');
  await assert.doesNotReject(f.instance.setLocale('en'));
  assert.equal(f.instance.t('demo:title'), 'English');
  assert.ok(updates >= 2);
  assert.ok(diagnostics.length >= 2);
  assert.ok(diagnostics.every(d => d.operation === 'observer' && d.message === 'update view failed'));
  stop();
  stop();
  assert.equal(f.hot.listenerCount(MANIFEST_EVENT), 0);
  assert.equal(f.hot.listenerCount(CATALOG_EVENT), 0);
  const count = updates;
  await f.instance.setLocale('ko');
  assert.equal(updates, count, 'No update callbacks after bridge stop');
});

test('one throwing source diagnostic listener does not hide diagnostics from the lazy bridge or recorder', async t => {
  const f = fixture(t);
  const recorder = createSupportRecorder();
  f.source.subscribeDiagnostic(() => { throw new Error('one diagnostic listener failed'); });
  const seen = [];
  connectDev(f.instance, { catalogSource: f.source, onDiagnostic: diagnostic => { seen.push(diagnostic); recorder.onDiagnostic(diagnostic); } });
  const diagnostic = { message: 'invalid catalog', diagnostics: [] };
  assert.doesNotThrow(() => f.hot.emit(DIAGNOSTIC_EVENT, diagnostic));
  assert.deepEqual(seen, [diagnostic]);
  assert.equal(recorder.getReport().events.length, 1);
  await assert.doesNotReject(f.instance.setLocale('en'));
  assert.equal(f.instance.t('demo:title'), 'English');
});

test('custom lazy diagnostic delivery is passive and queued diagnostics are ignored after stop', t => {
  const f = fixture(t);
  let queued;
  const source = { ...f.source, subscribeDiagnostic: listener => {
    queued = listener; return f.source.subscribeDiagnostic(listener);
  } };
  let calls = 0;
  const stop = connectDev(f.instance, { catalogSource: source,
    onDiagnostic: () => { calls++; throw new Error('diagnostic view failed'); }
  });
  assert.doesNotThrow(() => queued({ message: 'current diagnostic', diagnostics: [] }));
  assert.equal(calls, 1);
  stop();
  assert.doesNotThrow(() => queued({ message: 'late diagnostic', diagnostics: [] }));
  assert.equal(calls, 1, 'Queued callbacks must respect the released binding');
});

test('manifest observer failures do not hide lazy translations or replay an accepted registry revision', async t => {
  const f = fixture(t);
  f.source.subscribeManifest(() => { throw new Error('manifest view failed'); });
  const diagnostics = [];
  const recorder = createSupportRecorder();
  const states = [];
  f.source.subscribeSyncState(state => states.push(state.status));
  connectDev(f.instance, { catalogSource: f.source, onDiagnostic: diagnostic => {
    diagnostics.push(diagnostic); recorder.onDiagnostic(diagnostic); throw new Error('diagnostic view failed');
  } });
  await f.instance.setLocale('en');
  const requests = f.sent.filter(entry => entry.event === MANIFEST_REQUEST_EVENT).length;
  states.length = 0;
  assert.doesNotThrow(() => f.replace([catalog('한국어'), catalog('Updated English', 'en'),
    catalog('도움말', 'ko', 'help'), catalog('Help', 'en', 'help')]));
  await tick();
  assert.equal(f.instance.t('demo:title'), 'Updated English');
  assert.equal(f.source.getSyncState().status, 'connected');
  assert.equal(f.sent.filter(entry => entry.event === MANIFEST_REQUEST_EVENT).length, requests,
    'A view failure must not replay the accepted manifest');
  assert.deepEqual(states, []);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].operation, 'observer');
  assert.equal(diagnostics[0].message, 'manifest view failed');
  assert.equal(recorder.getReport().events[0].operation, 'observer');
});

test('an opaque manifest observer error is reported without losing the lazy update', async t => {
  const f = fixture(t);
  f.source.subscribeManifest(() => { throw Object.create(null); });
  const diagnostics = [];
  connectDev(f.instance, { catalogSource: f.source, onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  f.replace([catalog('updated with opaque error'), ...f.records().filter(record => record.locale !== 'ko' || record.namespace !== 'demo')]);
  await tick();
  assert.equal(f.instance.t('demo:title'), 'updated with opaque error');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].operation, 'observer');
  assert.equal(typeof diagnostics[0].message, 'string');
  assert.ok(diagnostics[0].message.length > 0);
});

test('initial queued catalog loads resume when a changed manifest observer throws', { timeout: 2000 }, async t => {
  const f = fixture(t);
  f.restart();
  f.source.subscribeManifest(() => { throw new Error('initial manifest view failed'); });
  const diagnostics = [];
  f.source.subscribeDiagnostic(diagnostic => diagnostics.push(diagnostic));
  const loaded = await f.source.loadCatalog('en', 'demo');
  assert.equal(loaded.status, 'present');
  assert.equal(loaded.catalog.messages.title.source, 'English');
  assert.equal(f.source.readManifest().sessionId, 'two');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].operation, 'observer');
  assert.equal(f.sent.filter(entry => entry.event === MANIFEST_REQUEST_EVENT).length, 1);
  assert.equal(f.sent.filter(entry => entry.event === CATALOG_REQUEST_EVENT).length, 1);
  assert.equal(f.source.getSyncState().status, 'stopped', 'One-off load releases its owned transport');
});

test('source disposal during a manifest notification stops detached views and pending transport', t => {
  const f = fixture(t);
  f.source.subscribeManifest(() => f.source.dispose());
  let late = 0;
  f.source.subscribeManifest(() => { late++; });
  const release = f.source.connect();
  t.after(release);
  f.replace([catalog('changed'), ...f.records().filter(record => record.locale !== 'ko' || record.namespace !== 'demo')]);
  assert.equal(late, 0);
  assert.equal(f.source.getSyncState().status, 'stopped');
  assert.equal(f.hot.listenerCount(MANIFEST_EVENT), 0);
  assert.equal(f.hot.listenerCount(CATALOG_EVENT), 0);
  assert.equal(f.sent.filter(entry => entry.event === MANIFEST_REQUEST_EVENT).length, 1);
});

test('lazy update failures are observer diagnostics while locale and manifest changes commit and recover', async t => {
  const f = fixture(t);
  const recorder = createSupportRecorder();
  const diagnostics = [];
  let fail = false;
  let updates = 0;
  const stop = connectDev(f.instance, { catalogSource: f.source,
    onUpdate: () => { updates++; if (fail) throw new Error('update view failed'); },
    onDiagnostic: diagnostic => { diagnostics.push(diagnostic); recorder.onDiagnostic(diagnostic); }
  });
  await tick();
  fail = true;
  await assert.doesNotReject(f.instance.setLocale('en'));
  assert.equal(f.instance.t('demo:title'), 'English');
  f.replace([catalog('한국어'), catalog('Latest', 'en'), ...f.records().filter(c => c.namespace !== 'demo')]);
  await tick();
  assert.equal(f.instance.t('demo:title'), 'Latest');
  assert.equal(f.source.getSyncState().status, 'connected');
  assert.ok(diagnostics.length >= 2);
  assert.ok(diagnostics.every(d => d.operation === 'observer' && d.message === 'update view failed'));
  assert.ok(recorder.getReport().events.every(event => event.operation === 'observer'));
  fail = false;
  const reports = diagnostics.length;
  const before = updates;
  f.replace([catalog('한국어'), catalog('Recovered', 'en'), ...f.records().filter(c => c.namespace !== 'demo')]);
  await tick();
  assert.equal(f.instance.t('demo:title'), 'Recovered');
  assert.ok(updates > before);
  assert.equal(diagnostics.length, reports);
  stop();
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
  assert.equal(recovered.result.status, 'compact');
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
  assert.equal(full.result.status, 'compact');
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

test('a malformed compact full reply rejects without changing the accepted UI and a later request recovers', async t => {
  const f = fixture(t);
  f.delay(true);
  const stop = f.source.connect();
  t.after(stop);
  const before = f.instance.getSnapshot();
  const pending = f.source.loadCatalog('en', 'demo');
  const rejected = assert.rejects(pending, /Invalid compact/);
  const reply = f.delayed.shift();
  assert.equal(reply.result.status, 'compact');
  reply.result.catalog.messages[0][6] = 99;
  f.hot.emit(CATALOG_EVENT, reply);
  await rejected;
  assert.equal(f.instance.getSnapshot(), before);
  assert.equal(f.sent.filter(e => e.event === CATALOG_REQUEST_EVENT).length, 1);
  const recovered = f.source.loadCatalog('en', 'demo');
  f.hot.emit(CATALOG_EVENT, f.delayed.shift());
  assert.equal((await recovered).catalog.messages.title.source, 'English');
  assert.equal(f.instance.getSnapshot(), before);
});
