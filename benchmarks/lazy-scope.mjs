import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCatalog } from '@0disoft/saylo-core';
import { createDevCatalogSource } from '../packages/vite/dist/client.js';
import { CatalogRegistry } from '../packages/vite/dist/catalog-registry.js';
import { CatalogPushSubscriptions } from '../packages/vite/dist/catalog-push.js';
import { encodeCatalogResult } from '../packages/vite/dist/catalog-wire.js';
import { CATALOG_EVENT, CATALOG_PUSH_EVENT, CATALOG_SCOPE_EVENT, CATALOG_REQUEST_EVENT,
  MANIFEST_EVENT, MANIFEST_REQUEST_EVENT } from '../packages/vite/dist/types.js';

/** Real source, codec, registry and subscriptions; only the ordered socket is simulated. */
export async function measureLazyScope(count, { reverseReplies = false, initialBase = true } = {}) {
  assert.ok(Number.isSafeInteger(count) && count > 0);
  const namespaces = Array.from({ length: count }, (_, index) => `ns${String(index).padStart(5, '0')}`);
  const records = ['ko', 'en'].flatMap(locale => namespaces.map(namespace =>
    parseCatalog('{"hello":"Hi"}', { locale, namespace })));
  let registry = new CatalogRegistry('scope-session', 'ko', records);
  const subscriptions = new CatalogPushSubscriptions(), client = {}, hot = new EventEmitter();
  const copy = value => JSON.parse(JSON.stringify(value));
  const frames = [], delayed = [];
  let phase = 'initial', deferReplies = reverseReplies;
  hot.dispose = hot.prune = () => {};
  hot.send = (event, data) => {
    if (event === CATALOG_SCOPE_EVENT) {
      const wire = JSON.stringify(data), accepted = JSON.parse(wire);
      subscriptions.subscribe(client, accepted);
      frames.push({ phase, kind: accepted.kind ?? 'replace', entries: accepted.catalogs.length,
        removed: accepted.removed?.length ?? 0, bytes: Buffer.byteLength(wire) });
    } else if (event === MANIFEST_REQUEST_EVENT) {
      hot.emit(MANIFEST_EVENT, copy({ kind: 'snapshot', request: data, manifest: registry.manifest() }));
    } else {
      assert.equal(event, CATALOG_REQUEST_EVENT);
      const reply = copy({ request: data, result: encodeCatalogResult(registry.loadDelta(data.locale, data.namespace, data.known)) });
      if (deferReplies) delayed.push(reply);
      else hot.emit(CATALOG_EVENT, reply);
    }
  };
  const initial = initialBase ? namespaces.map(namespace => registry.load('ko', namespace)) : [];
  const source = createDevCatalogSource(registry.manifest(), initial, { hot, push: true,
    runtime: { createId: () => 'scope-client' }, requestTimeoutMs: 10000 });
  const release = source.connect();
  try {
    phase = 'growth';
    if (reverseReplies) {
      const pending = namespaces.map(namespace => source.loadCatalog('en', namespace));
      for (const reply of delayed.reverse()) hot.emit(CATALOG_EVENT, reply);
      await Promise.all(pending);
      deferReplies = false;
    } else {
      for (const namespace of namespaces) await source.loadCatalog('en', namespace);
    }
    const expected = count * (initialBase ? 2 : 1);
    assert.equal(source.getCatalogs().length, expected);
    // Reconnecting must restore the whole accepted scope after socket state is lost.
    phase = 'reconnect';
    hot.emit('vite:ws:disconnect'); subscriptions.clear(); hot.emit('vite:ws:connect');
    const reconnect = frames.filter(frame => frame.phase === 'reconnect');
    assert.equal(reconnect.length, 1);
    assert.equal(reconnect[0].kind, 'replace');
    assert.equal(reconnect[0].entries, expected);
    // Every accumulated pair remains subscribed, including the earliest boot pair.
    phase = 'verify';
    const revision = registry.manifest().registryRevision;
    registry.replace(records.map(record => parseCatalog('{"hello":"Changed"}', { locale: record.locale, namespace: record.namespace })));
    const pushes = subscriptions.updates(client, registry, revision);
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].outcomes.length, expected);
    hot.emit(CATALOG_PUSH_EVENT, copy(pushes[0]));
    assert.ok(source.getCatalogs().every(catalog => catalog.messages.hello.source === 'Changed'));
    // A server session change empties stale cache entries before new single-pair subscriptions.
    phase = 'restart';
    registry = new CatalogRegistry('restarted-session', 'ko', records);
    subscriptions.clear(); hot.emit('vite:ws:disconnect'); hot.emit('vite:ws:connect');
    assert.equal(source.getCatalogs().length, 0);
    await source.loadCatalog('en', namespaces[0]);
    assert.equal(source.getCatalogs().length, 1);
    const totals = name => {
      const selected = frames.filter(frame => frame.phase === name);
      return { messages: selected.length, metadataEntries: selected.reduce((sum, frame) => sum + frame.entries, 0),
        jsonBytes: selected.reduce((sum, frame) => sum + frame.bytes, 0),
        fullReplacements: selected.filter(frame => frame.kind === 'replace').length,
        largestUpdateEntries: Math.max(0, ...selected.map(frame => frame.entries)) };
    };
    return { catalogsPerLocale: count, replyOrder: reverseReplies ? 'reverse-concurrent' : 'sequential',
      initial: totals('initial'), growth: totals('growth'), reconnect: totals('reconnect') };
  } finally {
    phase = 'stop'; release(); source.dispose();
    assert.deepEqual(subscriptions.updates(client, registry, registry.manifest().registryRevision), []);
    assert.equal(hot.listenerCount(CATALOG_EVENT), 0);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const samples = [];
  for (const count of [100, 500, 1000]) samples.push(await measureLazyScope(count));
  const report = { measuredAt: new Date().toISOString(), node: process.version, platform: process.platform,
    scope: 'Client-to-server subscription JSON only; simulated ordered socket, real source/codec/registry/subscriptions. Excludes catalog payloads, manifests and WebSocket framing.',
    samples };
  const output = JSON.stringify(report, null, 2) + '\n';
  const flag = process.argv.indexOf('--out-file');
  if (flag !== -1) { assert.ok(process.argv[flag + 1]); await writeFile(process.argv[flag + 1], output); }
  process.stdout.write(output);
}
