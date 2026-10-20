import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { createI18n } from '@0disoft/saylo-core';
import saylo from '../dist/index.js';
import { createDevCatalogSource, connectDev } from '../dist/client.js';
import { decodeCatalogResult } from '../dist/catalog-wire.js';
import { CatalogPushSubscriptions } from '../dist/catalog-push.js';
import { CATALOG_EVENT, CATALOG_PUSH_EVENT, CATALOG_SCOPE_EVENT, CATALOG_REQUEST_EVENT, MANIFEST_EVENT, MANIFEST_REQUEST_EVENT } from '../dist/types.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-push-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const locale of ['ko', 'en']) {
    await mkdir(path.join(root, 'locales', locale), { recursive: true });
    for (const namespace of ['demo', 'help']) await writeFile(path.join(root, 'locales', locale, `${namespace}.json`), JSON.stringify({ title: `${locale} ${namespace}` }));
  }
  const plugin = saylo({ localesDir: 'locales', baseLocale: 'ko' });
  await plugin.configResolved({ root, command: 'serve' });
  t.after(() => plugin.closeBundle());
  const hot = new EventEmitter(), ws = new EventEmitter(), watcher = new EventEmitter();
  hot.dispose = () => {}; hot.prune = () => {}; watcher.add = () => {};
  const server = { ws, watcher, httpServer: new EventEmitter(), config: { logger: { warn() {} } } };
  const frames = [], sent = [];
  let corrupt = false, suppressPush = false;
  const client = { send(frame) {
    frame = JSON.parse(JSON.stringify(frame)); frames.push(frame);
    if (frame.event === CATALOG_PUSH_EVENT && suppressPush) return;
    if (frame.event === CATALOG_PUSH_EVENT && corrupt && frame.data.outcomes.length) {
      frame.data.outcomes[0].catalogVersion = -1; corrupt = false;
    }
    hot.emit(frame.event, frame.data);
  } };
  ws.clients = new Set([client]);
  ws.send = frame => { for (const receiver of ws.clients) receiver.send(frame); };
  plugin.configureServer(server);
  hot.send = (event, data) => { sent.push({ event, data }); ws.emit(event, data, client); };
  const boot = [];
  const bootstrap = { send(frame) { boot.push(frame); } };
  ws.emit(MANIFEST_REQUEST_EVENT, { scope: 'eager', requestId: 'boot', generation: 1, locale: 'en', namespaces: ['demo'] }, bootstrap);
  const manifest = boot.find(frame => frame.event === MANIFEST_EVENT).data.manifest;
  const initialCatalogs = [];
  for (const locale of ['ko', 'en']) {
    ws.emit(CATALOG_REQUEST_EVENT, { requestId: locale, generation: 1, locale, namespace: 'demo' }, bootstrap);
    initialCatalogs.push(decodeCatalogResult(boot.at(-1).data.result));
  }
  const source = createDevCatalogSource(manifest, initialCatalogs, { hot, push: true, requestTimeoutMs: 500 });
  const instance = createI18n({ catalogSource: source, locale: 'en', initialNamespaces: ['demo'], initialCatalogs });
  t.after(() => { instance.dispose(); source.dispose(); });
  connectDev(instance, { catalogSource: source });
  sent.length = 0; frames.length = 0;
  const change = (locale, value, namespace = 'demo') => plugin.hotUpdate({ type: 'update',
    file: path.join(root, 'locales', locale, `${namespace}.json`), read: () => JSON.stringify(value), modules: [], server });
  return { root, source, instance, hot, ws, server, plugin, frames, sent, change,
    async remove(locale, namespace = 'demo') {
      const file = path.join(root, 'locales', locale, `${namespace}.json`);
      await rm(file);
      await plugin.hotUpdate({ type: 'delete', file, modules: [], server });
    },
    async restore(locale, value) {
      const file = path.join(root, 'locales', locale, 'demo.json');
      await writeFile(file, JSON.stringify(value));
      await plugin.hotUpdate({ type: 'create', file, modules: [], server });
    },
    corrupt() { corrupt = true; }, suppress(value) { suppressPush = value; } };
}

test('server pushes only subscribed pairs and publishes once without a catalog request round trip', async t => {
  const f = await fixture(t);
  let commits = 0;
  f.instance.subscribe(() => commits++);
  await f.change('en', { title: 'Pushed English' }); await tick();
  assert.equal(f.instance.t('demo:title'), 'Pushed English');
  assert.equal(commits, 1, 'Push and the following manifest frame represent one revision');
  assert.equal(f.sent.filter(frame => frame.event === CATALOG_REQUEST_EVENT).length, 0);
  const push = f.frames.find(frame => frame.event === CATALOG_PUSH_EVENT).data;
  assert.equal(push.kind, 'patch');
  assert.deepEqual(push.outcomes.map(outcome => outcome.key), [{ locale: 'en', namespace: 'demo' }]);
  assert.ok(['patch', 'compact'].includes(push.outcomes[0].status));
  await f.change('en', { title: 'Unloaded help changed' }, 'help'); await tick();
  assert.equal(f.frames.filter(frame => frame.event === CATALOG_PUSH_EVENT).at(-1).data.outcomes.length, 0);
  assert.equal(commits, 1);
  await f.instance.loadNamespace('help');
  assert.equal(f.instance.t('help:title'), 'Unloaded help changed');
  assert.equal(f.sent.filter(frame => frame.event === CATALOG_REQUEST_EVENT).length, 2);
});

test('base schema and quarantined translation arrive in one push and retain old snapshots', async t => {
  const f = await fixture(t);
  await f.change('ko', { title: 'Number {name, number}' }); await tick();
  await f.change('en', { title: 'English {name, number}' }); await tick();
  const old = f.instance.getSnapshot();
  await f.change('ko', { title: 'Base {name}' }); await tick();
  assert.equal(old.t('demo:title', { name: 1 }), 'English 1');
  assert.equal(f.instance.t('demo:title', { name: 'Ada' }), 'Base Ada');
  assert.throws(() => f.instance.t('demo:title'), { name: 'InvalidArgumentError' });
  assert.equal(f.sent.filter(frame => frame.event === CATALOG_REQUEST_EVENT).length, 0);
  await f.change('en', { title: 'Restored {name}' }); await tick();
  assert.equal(f.instance.t('demo:title', { name: 'Ada' }), 'Restored Ada');
});

test('broken and lost pushes resync through the ordinary full lookup without exposing a partial candidate', async t => {
  const f = await fixture(t);
  const seen = [];
  f.instance.subscribe(snapshot => seen.push(snapshot.t('demo:title')));
  f.corrupt();
  await f.change('en', { title: 'Recovered from invalid push' }); await tick();
  assert.equal(f.instance.t('demo:title'), 'Recovered from invalid push');
  assert.deepEqual(seen, ['Recovered from invalid push']);
  assert.ok(f.sent.some(frame => frame.event === MANIFEST_REQUEST_EVENT));
  assert.ok(f.sent.some(frame => frame.event === CATALOG_REQUEST_EVENT));
  f.suppress(true);
  await f.change('en', { title: 'Recovered from lost push' }); await tick();
  assert.equal(f.instance.t('demo:title'), 'Recovered from lost push');
});

test('multiple sources share a socket, reject foreign pushes and unsubscribe without closing Vite', async t => {
  const f = await fixture(t);
  const initial = f.instance.getBootSnapshot().catalogOutcomes;
  const source = createDevCatalogSource(f.source.readManifest(), initial, { hot: f.hot, push: true });
  const instance = createI18n({ catalogSource: source, locale: 'en', initialNamespaces: ['demo'], initialCatalogs: initial });
  t.after(() => { instance.dispose(); source.dispose(); });
  const off = connectDev(instance, { catalogSource: source });
  await f.change('en', { title: 'Both sources' }); await tick();
  assert.equal(instance.t('demo:title'), 'Both sources');
  assert.equal(f.instance.t('demo:title'), 'Both sources');
  const owners = new Set(f.frames.filter(frame => frame.event === CATALOG_PUSH_EVENT).map(frame => frame.data.owner));
  assert.equal(owners.size, 2);
  off(); source.dispose();
  const before = f.frames.filter(frame => frame.event === CATALOG_PUSH_EVENT).length;
  await f.change('en', { title: 'One source remains' }); await tick();
  assert.equal(f.frames.filter(frame => frame.event === CATALOG_PUSH_EVENT).length - before, 1);
  assert.equal(f.instance.t('demo:title'), 'One source remains');
  assert.equal(instance.t('demo:title'), 'Both sources');
  assert.equal(f.ws.clients.size, 1);
  assert.equal(f.hot.listenerCount(CATALOG_PUSH_EVENT), 1);
});

test('subscription validation rejects invalid pair metadata and duplicate scope keys', () => {
  const subscriptions = new CatalogPushSubscriptions(), client = {};
  const meta = { key: { locale: 'en', namespace: 'demo' }, status: 'missing', catalogVersion: 0 };
  for (const input of [null, {}, { owner: 'test', sessionId: 'one', catalogs: [meta, meta] },
    { owner: 'test', sessionId: 'one', catalogs: [{ ...meta, catalogVersion: -1 }] },
    { owner: 'test', sessionId: 'one', catalogs: [{ ...meta, key: { locale: 'en', namespace: '../x' } }] }])
    assert.throws(() => subscriptions.subscribe(client, input));
});

test('pushed deletion tombstones fall back without a lookup and recreation restores the subscribed translation', async t => {
  const f = await fixture(t);
  await f.remove('en'); await tick();
  assert.equal(f.instance.t('demo:title'), 'ko demo');
  assert.equal(f.sent.filter(frame => frame.event === CATALOG_REQUEST_EVENT).length, 0);
  const deletion = f.frames.filter(frame => frame.event === CATALOG_PUSH_EVENT).at(-1).data;
  assert.equal(deletion.outcomes[0].status, 'missing');
  await f.restore('en', { title: 'Recreated English' }); await tick();
  assert.equal(f.instance.t('demo:title'), 'Recreated English');
  assert.equal(f.sent.filter(frame => frame.event === CATALOG_REQUEST_EVENT).length, 0);
});

test('reconnection restores the push subscription and old or duplicate patches cannot roll the UI back', async t => {
  const f = await fixture(t);
  await f.change('en', { title: 'First push' }); await tick();
  const old = structuredClone(f.frames.find(frame => frame.event === CATALOG_PUSH_EVENT).data);
  f.hot.emit('vite:ws:disconnect');
  // Simulate the server-side subscription being dropped with the old socket.
  f.ws.emit(CATALOG_SCOPE_EVENT, { owner: old.owner, sessionId: old.manifest.sessionId, catalogs: [] }, [...f.ws.clients][0]);
  f.hot.emit('vite:ws:connect');
  await f.change('en', { title: 'After reconnect' }); await tick();
  assert.equal(f.instance.t('demo:title'), 'After reconnect');
  const count = f.sent.filter(frame => frame.event === CATALOG_REQUEST_EVENT).length;
  f.hot.emit(CATALOG_PUSH_EVENT, old);
  assert.equal(f.instance.t('demo:title'), 'After reconnect');
  assert.equal(f.sent.filter(frame => frame.event === CATALOG_REQUEST_EVENT).length, count);
});
