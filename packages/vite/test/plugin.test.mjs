import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm, rmdir, rename, readFile, stat, utimes } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import saylo from '../dist/index.js';
import { decodeCatalogResult } from '../dist/catalog-wire.js';
import { createStore, createI18n } from '@0disoft/saylo-core';
import { assertInside, scanCatalogs } from '../dist/catalog-files.js';
import { CATALOG_EVENT, CATALOG_REQUEST_EVENT, DIAGNOSTIC_EVENT, MANIFEST_EVENT, MANIFEST_REQUEST_EVENT,
  REQUEST_EVENT, SNAPSHOT_EVENT } from '../dist/types.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-vite-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const locale of ['ko', 'en']) {
    await mkdir(path.join(root, locale));
    await writeFile(path.join(root, locale, 'demo.json'), JSON.stringify({ hello: `${locale} {name}` }));
  }
  return root;
}

async function setup(t, options = {}) {
  let plugin;
  t.after(() => plugin?.closeBundle());
  const root = await fixture(t);
  plugin = saylo({ localesDir: root, baseLocale: 'ko', ...options });
  await plugin.configResolved({ root });
  const events = [];
  const warnings = [];
  const ws = new EventEmitter();
  ws.send = event => events.push(event);
  ws.clients = new Set();
  const watcher = new EventEmitter();
  watcher.add = () => {};
  const server = { ws, watcher, httpServer: new EventEmitter(), config: { logger: { warn(message) { warnings.push(message); } } } };
  plugin.configureServer(server);
  const eagerClient = { send: event => ws.send(event) };
  ws.clients.add(eagerClient);
  ws.emit(REQUEST_EVENT, { scope: 'eager', requestId: 'eager', generation: 1, locale: 'ko', namespaces: ['demo'] }, eagerClient);
  events.length = 0;
  const change = (locale, source) => plugin.hotUpdate({
    type: 'update', file: path.join(root, locale, 'demo.json'), read: () => source, modules: [], server,
  });
  const request = (data = { scope: 'eager', requestId: 'test-request', generation: 1, locale: 'ko', namespaces: ['demo'] }) => {
    const replies = [];
    ws.emit(REQUEST_EVENT, data, { send: event => replies.push(event) });
    return replies;
  };
  const disk = async (type, locale, namespace = 'demo', source) => {
    const file = path.join(root, locale, `${namespace}.json`);
    if (source !== undefined) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, source);
    } else if (type === 'delete') await rm(file);
    watcher.emit(type === 'delete' ? 'unlink' : 'add', file);
    return plugin.hotUpdate({ type, file, read: () => source, modules: [], server });
  };
  return { root, plugin, events, warnings, ws, change, request, server, disk };
}

test('completeness enabled for builds still permits partial live translations and fallback', async t => {
  const { change, request } = await setup(t, { requireCompleteTranslations: true });
  await change('en', '{}');
  const catalogs = request()[0].data.catalogs;
  const store = createStore({ baseLocale: 'ko', locale: 'en', catalogs });
  t.after(() => store.dispose());
  assert.equal(store.t('demo:hello', { name: 'Saylo' }), 'ko Saylo');
  await change('en', '{"hello":"Repaired {name}"}');
  store.replaceCatalogs(request()[0].data.catalogs);
  assert.equal(store.t('demo:hello', { name: 'Saylo' }), 'Repaired Saylo');
});

test('startup type readiness precedes serving and live publish precedes background typegen', async t => {
  const { root, server, change, request, warnings } = await setup(t, { typegen: { outFile: 'generated.d.ts' } });
  const out = path.join(root, 'generated.d.ts');
  assert.ok((await readFile(out, 'utf8')).includes('"demo:hello": { "name": number | string; };'));
  await utimes(out, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
  const beforeWrite = (await stat(out)).mtimeMs;
  const send = server.ws.send;
  server.ws.send = event => {
    if (event.event === SNAPSHOT_EVENT) assert.ok(!readFileSync(out, 'utf8').includes('demo:added'));
    send(event);
  };
  await change('ko', '{"hello":"Updated {name}","added":"{count, number}"}');
  assert.equal(request()[0].data.revision, 1);
  const deadline = Date.now() + 10000;
  // Poll metadata instead of repeatedly opening the target during Windows atomic replacement.
  while ((await stat(out)).mtimeMs === beforeWrite) {
    assert.ok(Date.now() < deadline, `background type generation completed: ${warnings.join('\n')}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok((await readFile(out, 'utf8')).includes('demo:added'));
  server.ws.send = send;
  await utimes(out, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
  const before = (await stat(out)).mtimeMs;
  await change('ko', '{"hello":"Text only {name}","added":"{count, number}"}');
  assert.equal((await stat(out)).mtimeMs, before);
});

test('failed live type generation retries an identical save without republishing catalogs', async t => {
  const { root, change, request, warnings, events } = await setup(t, { typegen: { outFile: 'generated.d.ts' } });
  const out = path.join(root, 'generated.d.ts');
  const backup = path.join(root, 'previous.d.ts');
  await rename(out, backup);
  await mkdir(out);
  const source = '{"hello":"Updated {name}","added":"{count, number}"}';
  await change('ko', source);
  assert.equal(request()[0].data.revision, 1);
  const deadline = Date.now() + 10000;
  while (!warnings.some(message => message.startsWith('[saylo:typegen]'))) {
    assert.ok(Date.now() < deadline, 'failed generation reports its error');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await rmdir(out);
  await rename(backup, out);
  await utimes(out, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
  const beforeWrite = (await stat(out)).mtimeMs;
  events.length = 0;
  await change('ko', source);
  while ((await stat(out)).mtimeMs === beforeWrite) {
    assert.ok(Date.now() < deadline, 'identical save retries failed generation');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok((await readFile(out, 'utf8')).includes('demo:added'));
  assert.equal(request()[0].data.revision, 1);
  assert.equal(events.filter(event => event.event === SNAPSHOT_EVENT).length, 0);
});

test('generated declaration and owned temporary paths are narrowly excluded from watch/HMR', async t => {
  const root = await fixture(t);
  const plugin = saylo({ localesDir: root, baseLocale: 'ko', typegen: { outFile: 'generated.d.ts' } });
  t.after(() => plugin.closeBundle());
  const config = plugin.config({ root });
  const ignored = config.server.watch.ignored[0];
  const out = path.join(root, 'generated.d.ts');
  const temp = path.join(root, '.generated.d.ts.saylo-typegen-example.tmp');
  assert.equal(ignored(out), true);
  assert.equal(ignored(temp), true);
  assert.equal(ignored(path.join(root, 'other.d.ts')), false);
  assert.equal(ignored(path.join(root, 'ko', 'demo.json')), false);
  assert.deepEqual(await plugin.hotUpdate({ type: 'update', file: out, modules: [], server: {} }), []);
});

test('only production builds include the catalog client in SSR bundles', () => {
  const plugin = saylo({ localesDir: 'locales', baseLocale: 'ko' });
  const dev = plugin.config({}, { command: 'serve' });
  const build = plugin.config({}, { command: 'build' });
  assert.deepEqual(dev.ssr.external, ['@0disoft/saylo-vite/server']);
  assert.equal(dev.ssr.noExternal, undefined);
  assert.deepEqual(build.ssr.noExternal, ['@0disoft/saylo-vite']);
});

test('failed initial type readiness aborts startup and retains catalog source', async t => {
  const root = await fixture(t);
  const plugin = saylo({ localesDir: root, baseLocale: 'ko', typegen: { outFile: 'ko/demo.json' } });
  t.after(() => plugin.closeBundle());
  const before = await readFile(path.join(root, 'ko', 'demo.json'), 'utf8');
  await assert.rejects(plugin.configResolved({ root }), /outFile must end in .d.ts/);
  assert.equal(await readFile(path.join(root, 'ko', 'demo.json'), 'utf8'), before);
});

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
  assert.equal(events[0].data.kind, 'update');
  assert.equal(events[0].data.baseRevision, 0);
  await change('en', '{"hello":"Hello {name}"}');
  assert.equal(events.filter(e => e.event === SNAPSHOT_EVENT).length, 1);
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

test('live file reads reuse unchanged message AST without retaining edited text', async t => {
  const { change, request } = await setup(t);
  await change('ko', '{"hello":"First {name}","keep":"{n, plural, other {#}}"}');
  const first = request()[0].data.catalogs.find(c => c.locale === 'ko');
  await change('ko', '{"hello":"Later {name}","keep":"{n, plural, other {#}}"}');
  const next = request()[0].data.catalogs.find(c => c.locale === 'ko');
  assert.equal(next.messages.hello.source, 'Later {name}');
  assert.notEqual(next.messages.hello.ast, first.messages.hello.ast);
  assert.equal(next.messages.keep, first.messages.keep);
});

test('server catalog requests negotiate a delta only with an available client baseline', async t => {
  const { ws, change } = await setup(t);
  const replies = [];
  const client = { send: frame => replies.push(frame.data) };
  const request = { requestId: 'pair-1', generation: 1, locale: 'ko', namespace: 'demo' };
  ws.emit(CATALOG_REQUEST_EVENT, request, client);
  const initial = replies.at(-1).result;
  assert.equal(initial.status, 'compact');
  await change('ko', '{"hello":"Changed {name}"}');
  ws.emit(CATALOG_REQUEST_EVENT, { ...request, requestId: 'pair-2', known: {
    sessionId: initial.sessionId, catalogVersion: initial.catalogVersion,
  } }, client);
  assert.equal(replies.at(-1).result.status, 'patch');
  assert.deepEqual(replies.at(-1).result.upsert.map(([id]) => id), ['hello']);
  ws.emit(CATALOG_REQUEST_EVENT, { ...request, requestId: 'full' }, client);
  assert.equal(replies.at(-1).result.status, 'compact');
});

test('base schema change publishes immediately with incompatible translation quarantined', async t => {
  const { change, request } = await setup(t);
  await change('ko', '{"hello":"안녕 {count, number}"}');
  assert.equal(request()[0].data.revision, 1);
  assert.equal(request()[1].event, DIAGNOSTIC_EVENT);
  assert.equal(request()[1].data.diagnostics[0].code, 'UNKNOWN_ARGUMENT');
  const store = createStore({ baseLocale: 'ko', locale: 'en', catalogs: request()[0].data.catalogs });
  t.after(() => store.dispose());
  assert.equal(store.t('demo:hello', { count: 3 }), '안녕 3');
  assert.deepEqual(store.getSnapshot().availableLocales, ['en', 'ko']);
  await change('en', '{"hello":"Hello"}');
  assert.equal(request()[0].data.revision, 2);
  assert.equal(request()[0].data.catalogs.find(c => c.locale === 'ko').messages.hello.source, '안녕 {count, number}');
  assert.equal(request()[1].data.message, '');
  await change('ko', '{"hello":"안녕 {count, number}"}');
  assert.equal(request()[0].data.revision, 2);
  assert.equal(request()[1].data.message, '');
});

test('quarantine keeps compatible messages and restores raw translations after base recovery', async t => {
  const { change, request, events } = await setup(t);
  await change('ko', '{"hello":"안녕 {name}","keep":"유지","remove":"삭제"}');
  await change('en', '{"hello":"Hi {name}","keep":"Keep","remove":"Remove"}');
  events.length = 0;
  await change('ko', '{"hello":"{count, number}명","keep":"유지"}');
  const catalogs = request()[0].data.catalogs;
  const en = catalogs.find(c => c.locale === 'en');
  assert.deepEqual(Object.keys(en.messages), ['keep']);
  const store = createStore({ baseLocale: 'ko', locale: 'en', catalogs });
  t.after(() => store.dispose());
  assert.equal(store.t('demo:hello', { count: 3 }), '3명');
  assert.equal(store.t('demo:keep'), 'Keep');
  assert.equal(events.filter(e => e.event === SNAPSHOT_EVENT).length, 1);
  const revision = request()[0].data.revision;
  await change('ko', '{"hello":"{count, number}명","keep":"유지"}');
  assert.equal(request()[0].data.revision, revision);
  await change('ko', '{"hello":"안녕 {name}","keep":"유지","remove":"삭제"}');
  store.replaceCatalogs(request()[0].data.catalogs);
  assert.equal(store.t('demo:hello', { name: 'Ada' }), 'Hi Ada');
  assert.equal(store.t('demo:remove'), 'Remove');
  assert.equal(request()[1].data.message, '');
});

test('invalid secondary edits retain last good messages without blocking other files', async t => {
  const { change, request } = await setup(t);
  await change('en', '{"hello":"Bad {unknown}"}');
  assert.equal(request()[0].data.revision, 0);
  assert.equal(request()[0].data.catalogs.find(c => c.locale === 'en').messages.hello.source, 'en {name}');
  await change('ko', '{"hello":"새 기준 {name}","new":"새 키"}');
  const store = createStore({ baseLocale: 'ko', locale: 'en', catalogs: request()[0].data.catalogs });
  t.after(() => store.dispose());
  assert.equal(store.t('demo:hello', { name: 'Ada' }), 'en Ada');
  assert.equal(store.t('demo:new'), '새 키');
  assert.ok(request()[1].data.message);
  await change('en', '{"hello":"Fixed {name}"}');
  assert.equal(request()[1].data.message, '');
});

test('deleted translation cannot be resurrected by an invalid replacement', async t => {
  const { disk, request, change } = await setup(t);
  await disk('delete', 'en');
  await disk('create', 'en', 'demo', '{"hello":"Bad {unknown}"}');
  assert.ok(request()[0].data.catalogs.every(c => c.locale !== 'en'));
  await change('en', '{"hello":"New {name}"}');
  assert.equal(request()[0].data.catalogs.find(c => c.locale === 'en').messages.hello.source, 'New {name}');
  assert.equal(request()[1].data.message, '');
});

test('lazy pair metadata and payload converge after quarantine and restoration', async t => {
  const { ws, change } = await setup(t);
  let requestNumber = 0;
  const send = (event, data) => {
    const replies = [];
    ws.emit(event, data, { send: reply => replies.push(reply.data) });
    return replies[0];
  };
  const source = {
    readManifest: () => send(MANIFEST_REQUEST_EVENT, { scope: 'eager', requestId: `m-${++requestNumber}`,
      generation: 1, locale: 'en', namespaces: ['demo'] }).manifest,
    loadCatalog: async (locale, namespace) => decodeCatalogResult(send(CATALOG_REQUEST_EVENT, {
      requestId: `c-${++requestNumber}`, generation: 1, locale, namespace }).result),
  };
  const initialCatalogs = await Promise.all(['ko', 'en'].map(locale => source.loadCatalog(locale, 'demo')));
  const instance = createI18n({ catalogSource: source, locale: 'en', initialNamespaces: ['demo'], initialCatalogs });
  t.after(() => instance.dispose());
  await change('ko', '{"hello":"{count, number}명"}');
  await instance.refresh();
  assert.equal(instance.t('demo:hello', { count: 2 }), '2명');
  await change('en', '{"hello":"{count, plural, one {# person} other {# people}}"}');
  await instance.refresh();
  assert.equal(instance.t('demo:hello', { count: 2 }), '2 people');
});

test('concurrent saves coalesce to final value and close removes only plugin listeners', async t => {
  const { change, events, server, ws } = await setup(t);
  const foreign = () => {};
  server.watcher.on('add', foreign);
  await Promise.all([change('ko', '{"hello":"첫 번째 {name}"}'), change('ko', '{"hello":"두 번째 {name}"}')]);
  assert.deepEqual(events.filter(e => e.event === SNAPSHOT_EVENT).map(e => e.data.revision), [1]);
  assert.equal(events[0].data.catalogs.find(c => c.locale === 'ko').messages.hello.source, '두 번째 {name}');
  server.httpServer.emit('close');
  assert.equal(ws.listenerCount(REQUEST_EVENT), 0);
  assert.equal(server.watcher.listenerCount('add'), 1);
  assert.equal(server.watcher.listenerCount('unlink'), 0);
  await change('ko', '{"hello":"닫힌 서버 {name}"}');
  assert.equal(events.filter(e => e.event === SNAPSHOT_EVENT).length, 1);
});

test('read-backed edits coalesce on the next turn while disk events keep their settling window', async t => {
  const { root, plugin, server, change, events, request } = await setup(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const first = change('en', '{"hello":"First {name}"}');
  assert.equal(events.length, 0);
  t.mock.timers.tick(0);
  await first;
  assert.equal(request()[0].data.revision, 1);
  events.length = 0;
  const file = path.join(root, 'en', 'demo.json');
  server.watcher.emit('add', file);
  let reads = 0;
  const mixed = plugin.hotUpdate({ type: 'update', file, modules: [], server, read: () => {
    reads++;
    return '{"hello":"Settled {name}"}';
  } });
  t.mock.timers.tick(39);
  assert.equal(reads, 0);
  assert.equal(events.length, 0);
  t.mock.timers.tick(1);
  await mixed;
  assert.equal(reads, 1);
  assert.equal(request()[0].data.revision, 2);
  const next = change('en', '{"hello":"Next {name}"}');
  t.mock.timers.tick(0);
  await next;
  assert.equal(request()[0].data.revision, 3);
});

test('disk event bursts retain the 200ms drain bound', async t => {
  const { root, plugin, server, request } = await setup(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const file = path.join(root, 'en', 'demo.json');
  server.watcher.emit('add', file);
  for (let i = 0; i < 6; i++) {
    t.mock.timers.tick(30);
    server.watcher.emit('add', file);
  }
  let reads = 0;
  const last = plugin.hotUpdate({ type: 'update', file, modules: [], server, read: () => {
    reads++;
    return '{"hello":"Final {name}"}';
  } });
  t.mock.timers.tick(19);
  assert.equal(reads, 0);
  t.mock.timers.tick(1);
  await last;
  assert.equal(reads, 1);
  assert.equal(request()[0].data.revision, 1);
});

test('new locale and paired namespace files join the same valid batch', async t => {
  const { disk, request, events } = await setup(t);
  await Promise.all([
    disk('create', 'ja', 'demo', '{"hello":"こんにちは {name}"}'),
    disk('create', 'en', 'help', '{"title":"Help"}'),
    disk('create', 'ko', 'help', '{"title":"도움말"}'),
  ]);
  const store = createStore({ baseLocale: 'ko', locale: 'ja', catalogs: request()[0].data.catalogs });
  t.after(() => store.dispose());
  assert.deepEqual(store.getSnapshot().availableLocales, ['en', 'ja', 'ko']);
  assert.deepEqual(store.getSnapshot().availableNamespaces, ['demo', 'help']);
  assert.equal(store.t('demo:hello', { name: '제로디' }), 'こんにちは 제로디');
  assert.equal(events.filter(e => e.event === SNAPSHOT_EVENT).length, 1);
});

test('translation namespace removal falls back and current locale removal selects base', async t => {
  const { disk, request } = await setup(t);
  await Promise.all([disk('create', 'ko', 'help', '{"title":"도움말"}'), disk('create', 'en', 'help', '{"title":"Help"}')]);
  const store = createStore({ baseLocale: 'ko', locale: 'en', catalogs: request()[0].data.catalogs });
  t.after(() => store.dispose());
  await disk('delete', 'en', 'help');
  store.replaceCatalogs(request()[0].data.catalogs);
  assert.equal(store.t('help:title'), '도움말');
  await disk('delete', 'en');
  store.replaceCatalogs(request()[0].data.catalogs);
  assert.equal(store.getSnapshot().locale, 'ko');
  assert.deepEqual(store.getSnapshot().availableLocales, ['ko']);
});

test('baseline namespace removal retires secondary files and restoration rejoins them', async t => {
  const { disk, request } = await setup(t);
  await Promise.all([disk('create', 'ko', 'help', '{"title":"도움말"}'), disk('create', 'en', 'help', '{"title":"Help"}')]);
  await disk('delete', 'ko', 'help');
  assert.ok(request()[0].data.catalogs.every(c => c.namespace !== 'help'));
  await disk('create', 'ko', 'help', '{"title":"도움말"}');
  const store = createStore({ baseLocale: 'ko', locale: 'en', catalogs: request()[0].data.catalogs });
  t.after(() => store.dispose());
  assert.equal(store.t('help:title'), 'Help');
});

test('deleting all base files retains last good state and recovers when restored', async t => {
  const { disk, request } = await setup(t);
  await disk('delete', 'ko');
  assert.equal(request()[0].data.revision, 0);
  assert.match(request()[1].data.message, /base locale must retain/);
  await disk('create', 'ko', 'demo', '{"hello":"복구 {name}"}');
  assert.equal(request()[0].data.revision, 1);
  assert.equal(request()[1].data.message, '');
});

test('atomic unlink/add save reads final file without publishing removal', async t => {
  const { root, plugin, server, request, events } = await setup(t);
  const file = path.join(root, 'en', 'demo.json');
  const temp = path.join(root, 'en', '.demo.json');
  await writeFile(temp, '{"hello":"Replaced {name}"}');
  assert.equal(await plugin.hotUpdate({ type: 'create', file: temp, modules: [], server }), undefined);
  await rm(file);
  server.watcher.emit('unlink', file);
  const deletion = plugin.hotUpdate({ type: 'delete', file, modules: [], server });
  await rename(temp, file);
  server.watcher.emit('add', file);
  await Promise.all([deletion, plugin.hotUpdate({ type: 'create', file, modules: [], server })]);
  assert.equal(events.filter(e => e.event === SNAPSHOT_EVENT).length, 1);
  const store = createStore({ baseLocale: 'ko', locale: 'en', catalogs: request()[0].data.catalogs });
  t.after(() => store.dispose());
  assert.equal(store.t('demo:hello', { name: 'Ada' }), 'Replaced Ada');
});

test('translation arriving before new baseline is retried without resaving translation', async t => {
  const { root, disk, request } = await setup(t, { typegen: { outFile: 'generated.d.ts' } });
  const out = path.join(root, 'generated.d.ts');
  await utimes(out, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
  const beforeWrite = (await stat(out)).mtimeMs;
  await disk('create', 'en', 'help', '{"title":"Help"}');
  assert.equal(request()[0].data.revision, 0);
  assert.ok(request()[1].data.message);
  await disk('update', 'ko', 'demo', '{"hello":"Updated {name}","added":"Added"}');
  assert.equal(request()[0].data.revision, 1);
  assert.ok(request()[1].data.diagnostics.some(item => item.code === 'NAMESPACE_MISMATCH'));
  assert.equal(request()[0].data.catalogs.some(catalog => catalog.namespace === 'help'), false);
  const store = createStore({ baseLocale: 'ko', locale: 'en', catalogs: request()[0].data.catalogs });
  t.after(() => store.dispose());
  assert.equal(store.t('demo:added'), 'Added');
  const deadline = Date.now() + 10000;
  while ((await stat(out)).mtimeMs === beforeWrite) {
    assert.ok(Date.now() < deadline, 'unrelated namespace still generates updated types');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok((await readFile(out, 'utf8')).includes('demo:added'));
  await disk('create', 'ko', 'help', '{"title":"도움말"}');
  assert.equal(request()[0].data.revision, 2);
  assert.equal(request()[1].data.message, '');
  assert.equal(request()[0].data.catalogs.filter(c => c.namespace === 'help').length, 2);
});

test('invalid new file is diagnosed and ignored files do not create live events', async t => {
  const { disk, root, plugin, server, request, events } = await setup(t);
  await disk('create', 'ja', 'demo', '{');
  assert.equal(request()[0].data.revision, 0);
  assert.ok(request()[1].data.message);
  await disk('delete', 'ja');
  assert.equal(request()[1].data.message, '');
  for (const name of ['generated.d.ts', 'demo.json.tmp', '.demo.json']) {
    const file = path.join(root, 'ko', name);
    server.watcher.emit('add', file);
    assert.equal(await plugin.hotUpdate({ type: 'create', file, modules: [], server }), undefined);
  }
  assert.equal(events.filter(e => e.event === SNAPSHOT_EVENT).length, 0);
});

test('save during an async read discards superseded content before publishing', async t => {
  const { root, plugin, server, events, request } = await setup(t);
  const file = path.join(root, 'ko', 'demo.json');
  let started;
  let release;
  const reading = new Promise(resolve => { started = resolve; });
  const source = new Promise(resolve => { release = resolve; });
  const slow = plugin.hotUpdate({ type: 'update', file, modules: [], server, read: () => { started(); return source; } });
  await reading;
  await writeFile(file, '{"hello":"Latest {name}"}');
  const latest = plugin.hotUpdate({ type: 'update', file, modules: [], server, read: () => '{"hello":"Latest {name}"}' });
  release('{"hello":"Superseded {name}"}');
  await Promise.all([slow, latest]);
  assert.equal(request()[0].data.catalogs.find(c => c.locale === 'ko').messages.hello.source, 'Latest {name}');
  assert.equal(events.filter(e => e.event === SNAPSHOT_EVENT).length, 1);
});

test('closing during an async read cancels publication and pending listeners', async t => {
  const { root, plugin, server, events } = await setup(t);
  let started;
  let release;
  const reading = new Promise(resolve => { started = resolve; });
  const source = new Promise(resolve => { release = resolve; });
  const slow = plugin.hotUpdate({ type: 'update', file: path.join(root, 'ko', 'demo.json'), modules: [], server,
    read: () => { started(); return source; } });
  await reading;
  plugin.closeBundle();
  release('{"hello":"Closed {name}"}');
  await slow;
  assert.equal(events.length, 0);
  assert.equal(server.watcher.listenerCount('add'), 0);
});

test('virtual serialization escapes HTML delimiters', async t => {
  const { change, plugin } = await setup(t);
  await change('ko', '{"hello":"</script> {name}"}');
  const virtual = plugin.load(plugin.resolveId('virtual:saylo'));
  assert.ok(!virtual.includes('</script>'));
  assert.ok(virtual.includes('\\u003c/script>'));
});

test('snapshot handshake echoes request scope and targets only the requesting client', async t => {
  const { request, events, change } = await setup(t);
  await change('en', '{"hello":"Changed {name}"}');
  const before = events.length;
  const scope = { scope: 'eager', requestId: 'client-a:2', generation: 2, locale: 'en', namespaces: ['demo', 'new'] };
  const replies = request(scope);
  assert.equal(events.length, before);
  assert.equal(replies[0].data.kind, 'snapshot');
  assert.deepEqual(replies[0].data.request, scope);
  assert.deepEqual(replies[1].data.request, scope);
  assert.equal(replies[0].data.revision, 1);
  assert.deepEqual(replies[0].data.catalogs.map(c => c.locale).sort(), ['en', 'ko']);
  // The request describes desired state, but the eager response still replaces the whole registry.
  const latest = request({ ...scope, requestId: 'client-b:1', generation: 1 });
  assert.equal(latest[0].data.sessionId, replies[0].data.sessionId);
});

test('malformed snapshot requests get a targeted diagnostic without a registry reply', async t => {
  const { request, events } = await setup(t);
  const valid = { scope: 'eager', requestId: 'test', generation: 1, locale: 'ko', namespaces: ['demo'] };
  for (const data of [null, {}, { ...valid, scope: 'partial' }, { ...valid, requestId: '' },
    { ...valid, generation: -1 }, { ...valid, locale: 'bad_locale' },
    { ...valid, namespaces: ['demo', 'demo'] }, { ...valid, namespaces: [2] }]) {
    const replies = request(data);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].event, DIAGNOSTIC_EVENT);
    assert.match(replies[0].data.message, /Invalid eager snapshot request/);
  }
  assert.equal(events.length, 0);
});

test('lazy virtual boot includes only its base/target scope and catalog requests are targeted', async t => {
  const { plugin, disk, ws } = await setup(t, { initialNamespaces: ['demo'] });
  await disk('create', 'ko', 'help', '{"title":"PRIVATE_HELP_TEXT"}');
  const lazy = plugin.load(plugin.resolveId('virtual:saylo/lazy'));
  assert.ok(lazy.includes('createDevCatalogSource'));
  assert.ok(!lazy.includes('PRIVATE_HELP_TEXT'));
  assert.ok(!lazy.includes('en {name}'));
  const replies = [];
  ws.emit(CATALOG_REQUEST_EVENT, { requestId: 'lazy:1', generation: 1, locale: 'ko', namespace: 'help' }, { send: event => replies.push(event) });
  assert.equal(replies.length, 1);
  assert.equal(replies[0].event, CATALOG_EVENT);
  assert.equal(replies[0].data.result.status, 'compact');
  const result = decodeCatalogResult(JSON.parse(JSON.stringify(replies[0].data.result)));
  assert.equal(result.catalog.messages.title.source, 'PRIVATE_HELP_TEXT');
  assert.equal(result.catalog.namespace, 'help');
  ws.emit(CATALOG_REQUEST_EVENT, { requestId: 'lazy:2', generation: 1, locale: 'en', namespace: 'help' }, { send: event => replies.push(event) });
  assert.equal(replies[1].data.result.status, 'missing');
  assert.equal(replies[1].data.result.catalogVersion, 0);
});

test('lazy-only clients receive metadata broadcasts and stable scoped versions after deletion', async t => {
  const { ws, events, change, disk } = await setup(t);
  ws.clients.clear();
  await change('en', '{"hello":"NEW_TRANSLATION_TEXT {name}"}');
  assert.equal(events.filter(e => e.event === SNAPSHOT_EVENT).length, 0);
  assert.equal(events.filter(e => e.event === MANIFEST_EVENT).length, 1);
  assert.ok(!JSON.stringify(events[0]).includes('NEW_TRANSLATION_TEXT'));
  const replies = [];
  const request = { scope: 'eager', requestId: 'metadata:1', generation: 1, locale: 'ko', namespaces: [] };
  ws.emit(MANIFEST_REQUEST_EVENT, request, { send: event => replies.push(event) });
  const before = replies[0].data.manifest.catalogs.find(c => c.key.locale === 'en');
  await disk('delete', 'en');
  const after = events.at(-1).data.manifest.catalogs.find(c => c.key.locale === 'en');
  assert.equal(after.status, 'missing');
  assert.equal(after.catalogVersion, before.catalogVersion + 1);
});
