import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createI18n, createStore, parseCatalog } from '@0disoft/saylo-core';
import { connectDev, createDevCatalogSource } from '../dist/client.js';
import { CatalogRegistry } from '../dist/catalog-registry.js';
import { REQUEST_EVENT, SNAPSHOT_EVENT, MANIFEST_REQUEST_EVENT, MANIFEST_EVENT, DIAGNOSTIC_EVENT } from '../dist/types.js';

const catalog = text => parseCatalog(JSON.stringify({ hello: text }), { locale: 'ko', namespace: 'demo' });
const view = states => states.map(state => [state.status, state.attempt]);
function fixture(t) {
  const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [catalog('last good')] });
  const hot = new EventEmitter();
  hot.dispose = () => {};
  hot.prune = () => {};
  const requests = [];
  hot.send = (event, request) => { assert.equal(event, REQUEST_EVENT); requests.push(request); };
  t.after(() => store.dispose());
  const reply = (request, text = 'recovered') => ({ kind: 'snapshot', request, sessionId: 'one', revision: 0,
    baseLocale: 'ko', catalogs: [catalog(text)] });
  return { hot, store, requests, reply };
}

test('eager timeouts expose attempts and final failure, then reconnect recovers without stale state events', { timeout: 2000 }, async t => {
  const { hot, store, requests, reply } = fixture(t);
  const states = [];
  const diagnostics = [];
  let failed;
  const done = new Promise(resolve => { failed = resolve; });
  const stop = connectDev(store, { hot, requestTimeoutMs: 10,
    onDiagnostic: value => diagnostics.push(value),
    onSyncState: state => { states.push(state); if (state.status === 'failed') failed(); }
  });
  await done;
  assert.deepEqual(view(states), [['connecting', 1], ['retrying', 2], ['retrying', 3], ['failed', 3]]);
  assert.equal(requests.length, 3);
  assert.equal(store.t('demo:hello'), 'last good');
  assert.match(diagnostics[0].message, /after 3 attempts/);
  assert.equal(diagnostics[0].operation, 'handshake');
  for (const state of states) {
    assert.ok(Object.isFrozen(state));
    assert.equal(state.maxAttempts, 3);
  }
  hot.emit('vite:ws:disconnect');
  hot.send = (_, request) => { requests.push(request); hot.emit(SNAPSHOT_EVENT, reply(request)); };
  hot.emit('vite:ws:connect');
  assert.deepEqual(view(states).slice(-3), [['disconnected', 0], ['connecting', 1], ['connected', 0]]);
  assert.equal(store.t('demo:hello'), 'recovered');
  const late = hot.listeners(SNAPSHOT_EVENT)[0];
  const count = states.length;
  stop();
  late(reply(requests[0], 'old reply'));
  assert.equal(states.length, count, 'No observer callbacks after releasing the bridge');
  assert.equal(store.t('demo:hello'), 'recovered');
});

test('state and diagnostic observer exceptions do not prevent an eager handshake', t => {
  const { hot, store, reply } = fixture(t);
  const states = [];
  let reports = 0;
  hot.send = (_, request) => hot.emit(SNAPSHOT_EVENT, reply(request));
  assert.doesNotThrow(() => connectDev(store, { hot,
    onSyncState: state => { states.push(state); throw new Error('status view failed'); },
    onDiagnostic: diagnostic => { assert.equal(diagnostic.operation, 'observer'); reports++; throw new Error('diagnostic view failed'); }
  }));
  assert.deepEqual(view(states), [['connecting', 1], ['connected', 0]]);
  assert.equal(reports, 2);
  assert.equal(store.t('demo:hello'), 'recovered');
});

test('disposal from a connecting observer prevents a request and releases listeners', t => {
  const { hot, store, requests } = fixture(t);
  const states = [];
  connectDev(store, { hot, onSyncState: state => { states.push(state); store.dispose(); } });
  assert.deepEqual(view(states), [['connecting', 1]]);
  assert.equal(requests.length, 0);
  assert.equal(hot.listenerCount(SNAPSHOT_EVENT), 0);
  assert.equal(hot.listenerCount('vite:ws:disconnect'), 0);
});

test('initial send failure reports failed attempt before releasing a retryable binding', t => {
  const { hot, store, reply } = fixture(t);
  const states = [];
  hot.send = () => { throw new Error('socket unavailable'); };
  assert.throws(() => connectDev(store, { hot, onSyncState: state => states.push(state) }), /socket unavailable/);
  assert.deepEqual(view(states), [['connecting', 1], ['failed', 1]]);
  assert.equal(hot.listenerCount(SNAPSHOT_EVENT), 0);
  hot.send = (_, request) => hot.emit(SNAPSHOT_EVENT, reply(request));
  connectDev(store, { hot, onSyncState: state => states.push(state) });
  assert.equal(store.t('demo:hello'), 'recovered');
  assert.deepEqual(view(states).slice(-2), [['connecting', 1], ['connected', 0]]);
});

test('lazy source and bridge share manifest state while retaining separate catalog diagnostics', { timeout: 2000 }, async t => {
  const registry = new CatalogRegistry('lazy', 'ko', [catalog('initial')]);
  const initial = [registry.load('ko', 'demo')];
  const hot = new EventEmitter();
  hot.dispose = () => {};
  hot.prune = () => {};
  const requests = [];
  hot.send = (event, request) => { assert.equal(event, MANIFEST_REQUEST_EVENT); requests.push(request); };
  const source = createDevCatalogSource(registry.manifest(), initial, { hot, requestTimeoutMs: 10 });
  const instance = createI18n({ catalogSource: source, locale: 'ko', initialNamespaces: ['demo'], initialCatalogs: initial });
  t.after(() => { instance.dispose(); source.dispose(); });
  const states = [];
  const direct = [];
  const diagnostics = [];
  let failed;
  const done = new Promise(resolve => { failed = resolve; });
  source.subscribeSyncState(() => { throw new Error('one observer failed'); });
  source.subscribeSyncState(state => direct.push(state));
  const stop = connectDev(instance, { catalogSource: source,
    onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    onSyncState: state => { states.push(state); if (state.status === 'failed') failed(); }
  });
  await done;
  assert.deepEqual(view(states), [['idle', 0], ['connecting', 1], ['retrying', 2], ['retrying', 3], ['failed', 3]]);
  assert.deepEqual(view(direct), view(states).slice(1));
  assert.equal(source.getSyncState().status, 'failed');
  assert.equal(instance.t('demo:hello'), 'initial');
  hot.emit('vite:ws:disconnect');
  hot.send = (_, request) => hot.emit(MANIFEST_EVENT, { kind: 'snapshot', request, manifest: registry.manifest() });
  hot.emit('vite:ws:connect');
  assert.equal(source.getSyncState().status, 'connected');
  assert.deepEqual(view(states).slice(-3), [['disconnected', 0], ['connecting', 1], ['connected', 0]]);
  hot.emit(DIAGNOSTIC_EVENT, { message: 'invalid locale file', diagnostics: [] });
  assert.equal(source.getSyncState().status, 'connected', 'File validation is distinct from transport state');
  assert.equal(diagnostics.at(-1).message, 'invalid locale file');
  const count = states.length;
  stop();
  assert.equal(source.getSyncState().status, 'stopped');
  assert.equal(states.length, count);
});

test('legacy lazy sources need not implement synchronization observation', t => {
  const registry = new CatalogRegistry('legacy', 'ko', [catalog('legacy')]);
  const initial = [registry.load('ko', 'demo')];
  const source = {
    readManifest: () => registry.manifest(), loadCatalog: (locale, namespace) => Promise.resolve(registry.load(locale, namespace)),
    getCatalogs: () => initial.map(outcome => outcome.catalog), subscribeManifest: () => () => {}, subscribeDiagnostic: () => () => {},
    connect: () => () => {}, dispose: () => {}
  };
  const instance = createI18n({ catalogSource: source, locale: 'ko', initialNamespaces: ['demo'], initialCatalogs: initial });
  t.after(() => instance.dispose());
  let states = 0;
  const stop = connectDev(instance, { catalogSource: source, onSyncState: () => { states++; } });
  assert.equal(states, 0);
  assert.equal(instance.t('demo:hello'), 'legacy');
  stop();
});

for (const disposeAt of ['idle', 'connecting']) {
  test(`lazy observer disposal during ${disposeAt} does not leave a source binding or late updates`, t => {
    const registry = new CatalogRegistry('dispose', 'ko', [catalog('initial')]);
    const initial = [registry.load('ko', 'demo')];
    const hot = new EventEmitter();
    hot.dispose = () => {};
    hot.prune = () => {};
    hot.send = (_, request) => hot.emit(MANIFEST_EVENT, { kind: 'snapshot', request, manifest: registry.manifest() });
    const source = createDevCatalogSource(registry.manifest(), initial, { hot });
    const instance = createI18n({ catalogSource: source, locale: 'ko', initialNamespaces: ['demo'], initialCatalogs: initial });
    t.after(() => { instance.dispose(); source.dispose(); });
    let updates = 0;
    const states = [];
    connectDev(instance, { catalogSource: source,
      onUpdate: () => { updates++; },
      onSyncState: state => { states.push(state.status); if (state.status === disposeAt) instance.dispose(); }
    });
    assert.deepEqual(states, disposeAt === 'idle' ? ['idle'] : ['idle', 'connecting']);
    assert.equal(updates, 0);
    assert.equal(hot.listenerCount(MANIFEST_EVENT), 0);
    assert.equal(hot.listenerCount('vite:ws:disconnect'), 0);
    assert.equal(source.getSyncState().status, disposeAt === 'idle' ? 'idle' : 'stopped');
  });
}
