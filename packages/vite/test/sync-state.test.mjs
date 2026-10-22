import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { scheduler } from '../../../scripts/test/helpers/scheduler.mjs';
import { createI18n, createStore, parseCatalog } from '@0disoft/saylo-core';
import { connectDev, createDevCatalogSource } from '../dist/client.js';
import { CatalogRegistry } from '../dist/catalog-registry.js';
import { REQUEST_EVENT, SNAPSHOT_EVENT, MANIFEST_REQUEST_EVENT, MANIFEST_EVENT, DIAGNOSTIC_EVENT, CATALOG_REQUEST_EVENT, CATALOG_EVENT } from '../dist/types.js';

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

test('injected handshake timers bound retries at exact deadlines and use explicit identities', t => {
  const f = fixture(t), clock = scheduler(), states = [];
  const stop = connectDev(f.store, { hot: f.hot, requestTimeoutMs: 1.5,
    runtime: { schedule: clock.schedule, createId: () => 'test-eager' }, onSyncState: state => states.push(state) });
  assert.equal(f.requests[0].requestId, 'test-eager:1');
  clock.tick(1); assert.equal(f.requests.length, 1);
  clock.tick(1); assert.equal(f.requests.length, 2);
  clock.tick(2); assert.equal(f.requests.length, 3);
  clock.tick(2); assert.equal(states.at(-1).status, 'failed');
  clock.tick(100); assert.equal(f.requests.length, 3); assert.equal(clock.size, 0);
  f.hot.emit('vite:ws:disconnect');
  f.hot.send = (_, request) => f.hot.emit(SNAPSHOT_EVENT, f.reply(request));
  f.hot.emit('vite:ws:connect');
  assert.equal(f.store.t('demo:hello'), 'recovered'); assert.equal(clock.size, 0);
  stop(); assert.equal(clock.size, 0);
});

test('lazy catalog timeout is normalized, abort cleans timers, and late replies cannot win', async t => {
  const registry = new CatalogRegistry('lazy-timer', 'ko', [catalog('initial')]);
  const hot = new EventEmitter(), clock = scheduler(), requests = []; let identity = 0;
  hot.dispose = hot.prune = () => {};
  hot.send = (event, request) => {
    if (event === MANIFEST_REQUEST_EVENT) hot.emit(MANIFEST_EVENT, { kind: 'snapshot', request, manifest: registry.manifest() });
    else { assert.equal(event, CATALOG_REQUEST_EVENT); requests.push(request); }
  };
  const source = createDevCatalogSource(registry.manifest(), [], { hot, requestTimeoutMs: 1.5,
    runtime: { schedule: clock.schedule, createId: () => `lazy-${++identity}` } });
  t.after(() => source.dispose());
  const stop = source.connect();
  let settled = false;
  const first = source.loadCatalog('ko', 'demo').finally(() => { settled = true; });
  const failed = assert.rejects(first, { code: 'TIMEOUT' });
  clock.tick(1); await Promise.resolve(); assert.equal(settled, false);
  clock.tick(1); await failed; assert.equal(clock.size, 0);
  const controller = new AbortController();
  const cancelled = assert.rejects(source.loadCatalog('ko', 'demo', controller.signal), { code: 'ABORTED' });
  controller.abort(); await cancelled; assert.equal(clock.size, 0);
  hot.emit(CATALOG_EVENT, { request: requests[0], result: registry.load('ko', 'demo') });
  assert.equal(source.getCatalogs().length, 0);
  const ready = source.loadCatalog('ko', 'demo');
  hot.emit(CATALOG_EVENT, { request: requests.at(-1), result: registry.load('ko', 'demo') });
  assert.equal((await ready).status, 'present'); assert.equal(clock.size, 0);
  stop();
});

test('lazy stopped observers can reconnect after final release and one-shot catalog completion', async t => {
  for (const trigger of ['release', 'catalog']) await t.test(trigger, async t => {
    const english = parseCatalog('{"hello":"English"}', { locale: 'en', namespace: 'demo' });
    const registry = new CatalogRegistry('reentrant-stop', 'ko', [catalog('initial'), english]);
    const hot = new EventEmitter(), clock = scheduler(), requests = [];
    hot.dispose = hot.prune = () => {};
    let identity = 0;
    hot.send = (event, request) => {
      requests.push(event);
      if (event === MANIFEST_REQUEST_EVENT) hot.emit(MANIFEST_EVENT, { kind: 'snapshot', request, manifest: registry.manifest() });
      else {
        assert.equal(event, CATALOG_REQUEST_EVENT);
        hot.emit(CATALOG_EVENT, { request, result: registry.load(request.locale, request.namespace) });
      }
    };
    const source = createDevCatalogSource(registry.manifest(), [registry.load('ko', 'demo')], { hot,
      runtime: { schedule: clock.schedule, createId: () => `reentrant-${++identity}` } });
    t.after(() => source.dispose());
    let reconnectOnce = true, releaseReconnected;
    source.subscribeSyncState(state => {
      if (state.status === 'stopped' && reconnectOnce) {
        reconnectOnce = false;
        releaseReconnected = source.connect();
      }
    });
    const observed = [];
    source.subscribeSyncState(state => observed.push(state.status));
    if (trigger === 'release') source.connect()();
    else assert.equal((await source.loadCatalog('en', 'demo')).status, 'present');
    assert.equal(typeof releaseReconnected, 'function');
    assert.equal(source.getSyncState().status, 'connected');
    assert.equal(observed.at(-1), 'connected', 'An old stop notification cannot follow the new connection.');
    assert.equal(requests.filter(event => event === MANIFEST_REQUEST_EVENT).length, 2);
    assert.equal(hot.listenerCount(MANIFEST_EVENT), 1);
    assert.equal(hot.listenerCount(CATALOG_EVENT), 1);
    const baseRevision = registry.manifest().registryRevision;
    registry.replace([catalog('after reconnect'), english]);
    hot.emit(MANIFEST_EVENT, { kind: 'update', baseRevision, manifest: registry.manifest() });
    assert.equal((await source.loadCatalog('ko', 'demo')).catalog.messages.hello.source, 'after reconnect');
    releaseReconnected(); releaseReconnected();
    assert.equal(source.getSyncState().status, 'stopped');
    assert.equal(hot.listenerCount(MANIFEST_EVENT), 0);
    assert.equal(hot.listenerCount(CATALOG_EVENT), 0);
    assert.equal(clock.size, 0);
  });
});

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

test('custom mutable source states are copied into immutable bridge observations', t => {
  const registry = new CatalogRegistry('custom', 'ko', [catalog('custom')]);
  const initial = [registry.load('ko', 'demo')];
  const mutable = { status: 'connected', attempt: 0, maxAttempts: 3 };
  let receive;
  const source = {
    readManifest: () => registry.manifest(), loadCatalog: (locale, namespace) => Promise.resolve(registry.load(locale, namespace)),
    getCatalogs: () => initial.map(outcome => outcome.catalog), subscribeManifest: () => () => {}, subscribeDiagnostic: () => () => {},
    getSyncState: () => mutable, subscribeSyncState: listener => { receive = listener; return () => {}; },
    connect: () => () => {}, dispose: () => {}
  };
  const instance = createI18n({ catalogSource: source, locale: 'ko', initialNamespaces: ['demo'], initialCatalogs: initial });
  t.after(() => instance.dispose());
  const states = [];
  const diagnostics = [];
  connectDev(instance, { catalogSource: source, onSyncState: state => states.push(state), onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  assert.ok(Object.isFrozen(states[0]));
  assert.notEqual(states[0], mutable);
  mutable.status = 'retrying';
  mutable.attempt = 2;
  receive(mutable);
  assert.deepEqual(view(states), [['connected', 0], ['retrying', 2]]);
  assert.ok(Object.isFrozen(states[1]));
  assert.equal(Object.isFrozen(mutable), false, 'The bridge must not freeze a provider-owned object');
  const frozenGetters = Object.freeze({ get status() { return mutable.status; }, get attempt() { return mutable.attempt; }, maxAttempts: 3 });
  receive(frozenGetters);
  mutable.status = 'disconnected';
  mutable.attempt = 0;
  assert.equal(states[2].status, 'retrying', 'Frozen provider getters must not change an earlier observation');
  assert.equal(states[2].attempt, 2);
  assert.doesNotThrow(() => receive({ get status() { throw new Error('provider status failed'); }, attempt: 0, maxAttempts: 3 }));
  assert.equal(diagnostics.at(-1).operation, 'observer');
  assert.equal(instance.t('demo:hello'), 'custom');
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
