import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import saylo from '../dist/index.js';
import { assertInside, scanCatalogs } from '../dist/catalog-files.js';
import { DIAGNOSTIC_EVENT, REQUEST_EVENT, SNAPSHOT_EVENT } from '../dist/types.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-vite-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const locale of ['ko', 'en']) {
    await mkdir(path.join(root, locale));
    await writeFile(path.join(root, locale, 'demo.json'), JSON.stringify({ hello: `${locale} {name}` }));
  }
  return root;
}

async function setup(t) {
  const root = await fixture(t);
  const plugin = saylo({ localesDir: root, baseLocale: 'ko' });
  await plugin.configResolved({ root });
  const events = [];
  const ws = new EventEmitter();
  ws.send = event => events.push(event);
  const server = { ws, watcher: { add() {} }, httpServer: new EventEmitter(), config: { logger: { warn() {} } } };
  plugin.configureServer(server);
  t.after(() => plugin.closeBundle());
  const change = (locale, source) => plugin.handleHotUpdate({
    file: path.join(root, locale, 'demo.json'), read: () => source, modules: [], server,
  });
  const request = () => {
    const replies = [];
    ws.emit(REQUEST_EVENT, {}, { send: event => replies.push(event) });
    return replies;
  };
  return { root, plugin, events, ws, change, request, server };
}

test('scan canonicalizes locale directories and parses ICU', async t => {
  const root = await fixture(t);
  const scanned = await scanCatalogs(root);
  assert.deepEqual(scanned.files.map(f => [f.catalog.locale, f.catalog.namespace]), [['en', 'demo'], ['ko', 'demo']]);
  assert.equal(scanned.files[0].catalog.messages.hello.source, 'en {name}');
  await assert.rejects(assertInside(scanned.root, path.dirname(scanned.root)), /escapes locales root/);
});

test('duplicate canonical locale directories fail', async t => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'iw'));
  await mkdir(path.join(root, 'he'));
  await assert.rejects(scanCatalogs(root), /Duplicate canonical locale/);
});

test('startup validates fresh disk data and translation schema', async t => {
  const root = await fixture(t);
  const plugin = saylo({ localesDir: root, baseLocale: 'ko' });
  await writeFile(path.join(root, 'en', 'demo.json'), '{');
  await assert.rejects(plugin.configResolved({ root }));
  await writeFile(path.join(root, 'en', 'demo.json'), '{"hello":"{count, number}"}');
  await assert.rejects(plugin.configResolved({ root }));
});

test('changed file sends snapshot, suppresses default HMR, and dedupes identical saves', async t => {
  const { change, events, request, plugin } = await setup(t);
  assert.deepEqual(await change('en', '{"hello":"Hello {name}"}'), []);
  assert.equal(events[0].event, SNAPSHOT_EVENT);
  assert.equal(events[0].data.revision, 1);
  await change('en', '{"hello":"Hello {name}"}');
  assert.equal(events.length, 1);
  assert.equal(request()[0].data.revision, 1);
  const virtual = plugin.load(plugin.resolveId('virtual:saylo'));
  assert.match(virtual, /Hello/);
});

test('bad JSON retains last good registry and recovery clears diagnostic', async t => {
  const { change, events, request } = await setup(t);
  await change('ko', '{');
  assert.equal(events[0].event, DIAGNOSTIC_EVENT);
  assert.equal(request()[0].data.revision, 0);
  await change('ko', '{"hello":"안녕 {name}"}');
  assert.equal(request()[0].data.revision, 1);
  assert.equal(events.at(-1).data.message, '');
});

test('base schema change revalidates translations atomically', async t => {
  const { change, request } = await setup(t);
  await change('ko', '{"hello":"안녕 {count, number}"}');
  assert.equal(request()[0].data.revision, 0);
  assert.equal(request()[1].event, DIAGNOSTIC_EVENT);
  await change('en', '{"hello":"Hello"}');
  assert.equal(request()[0].data.revision, 1);
  assert.equal(request()[1].event, DIAGNOSTIC_EVENT); // An unrelated save cannot clear the ko error.
  await change('ko', '{"hello":"안녕 {count, number}"}');
  assert.equal(request()[0].data.revision, 2);
  assert.equal(request().length, 1);
});

test('concurrent saves apply in order and close removes plugin listeners', async t => {
  const { change, events, server, ws } = await setup(t);
  await Promise.all([change('ko', '{"hello":"첫 번째 {name}"}'), change('ko', '{"hello":"두 번째 {name}"}')]);
  assert.deepEqual(events.map(e => e.data.revision), [1, 2]);
  server.httpServer.emit('close');
  assert.equal(ws.listenerCount(REQUEST_EVENT), 0);
  await change('ko', '{"hello":"닫힌 서버 {name}"}');
  assert.equal(events.length, 2);
});

test('virtual serialization escapes HTML delimiters', async t => {
  const { change, plugin } = await setup(t);
  await change('ko', '{"hello":"</script> {name}"}');
  const virtual = plugin.load(plugin.resolveId('virtual:saylo'));
  assert.ok(!virtual.includes('</script>'));
  assert.ok(virtual.includes('\\u003c/script>'));
});
