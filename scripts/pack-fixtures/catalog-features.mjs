import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build, createServer } from 'vite';
import saylo from '@0disoft/saylo-vite';
import { createServerI18n } from '@0disoft/saylo-core';
import { connectDev, createDevCatalogSource } from '@0disoft/saylo-vite/client';

const root = await mkdtemp(path.join(process.cwd(), '.catalog-features-'));
let server, socket, source, instance;
const hot = new EventEmitter(), sent = [], received = [];
const watchedChanges = [];
hot.dispose = hot.prune = () => {};
hot.send = (event, data) => { sent.push({ event, data }); socket.send(JSON.stringify({ type: 'custom', event, data })); };
function waitFor(event, predicate, action) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); hot.off(event, receive); };
    const receive = data => { if (predicate(data)) { cleanup(); resolve(data); } };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${event}`)); }, 5000);
    hot.on(event, receive);
    try { action?.(); } catch (error) { cleanup(); reject(error); }
  });
}
async function waitForWatchedFile(watcher, file) {
  const deadline = Date.now() + 5000;
  const registered = () => Object.entries(watcher.getWatched()).some(([directory, files]) =>
    path.relative(path.dirname(file), directory) === '' && files.includes(path.basename(file)));
  // HTTP listen does not wait for Chokidar's initial file registration.
  while (!registered()) {
    if (Date.now() >= deadline) throw new Error(`Vite did not start watching ${path.relative(root, file)}.`);
    await delay(25);
  }
}
try {
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  for (const locale of ['ko', 'en']) {
    await mkdir(path.join(root, 'locales', locale), { recursive: true });
    await writeFile(path.join(root, 'locales', locale, 'demo.json'), JSON.stringify({ title: `PACK_${locale}_TITLE`, unused: 'PACK_UNUSED_MARKER' }));
  }
  await mkdir(path.join(root, 'src'));
  const entry = path.join(root, 'src/main.mjs');
  await writeFile(entry, `import { createStore } from '@0disoft/saylo-core/runtime';
import { initialCatalogs, baseLocale, initialLocale } from 'virtual:saylo';
export const store = createStore({ catalogs: initialCatalogs, baseLocale, locale: initialLocale });
export const title = () => store.t('demo:title');`);
  const built = await build({ configFile: false, root, logLevel: 'silent',
    plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', includeKeys: { from: ['src'] }, typegen: { outFile: 'generated.d.ts' } })],
    build: { minify: false, rolldownOptions: { input: entry, preserveEntrySignatures: 'strict' } } });
  const chunks = built.output.filter(item => item.type === 'chunk');
  assert.ok(chunks.every(chunk => !chunk.code.includes('PACK_UNUSED_MARKER')));
  const app = await import(pathToFileURL(path.join(root, 'dist', chunks.find(chunk => chunk.isEntry).fileName)));
  try { app.store.setLocale('en'); assert.equal(app.title(), 'PACK_en_TITLE'); }
  finally { app.store.dispose(); }
  assert.match(await readFile(path.join(root, 'generated.d.ts'), 'utf8'), /demo:unused/);

  server = await createServer({ configFile: false, root, logLevel: 'silent', plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko' })],
    server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const target = path.join(root, 'locales/en/demo.json');
  await waitForWatchedFile(server.watcher, target);
  server.watcher.on('change', file => watchedChanges.push(path.relative(root, file)));
  const address = server.httpServer.address();
  socket = new WebSocket(`ws://127.0.0.1:${address.port}/?token=${server.config.webSocketToken}`, 'vite-hmr');
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.type === 'custom') { received.push(message); hot.emit(message.event, message.data); }
  });
  const snapshot = await waitFor('saylo:manifest', event => event.request?.requestId === 'bootstrap', () =>
    hot.send('saylo:request-manifest', { scope: 'eager', requestId: 'bootstrap', generation: 1, locale: 'en', namespaces: ['demo'] }));
  source = createDevCatalogSource(snapshot.manifest, [], { hot, push: true, requestTimeoutMs: 2000 });
  instance = await createServerI18n({ catalogSource: source, locale: 'en', initialNamespaces: ['demo'] });
  connectDev(instance, { catalogSource: source });
  if (source.getSyncState().status !== 'connected') await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('Push handshake did not finish.')); }, 5000);
    const off = source.subscribeSyncState(state => { if (state.status === 'connected') { clearTimeout(timer); off(); resolve(); } });
  });
  const before = sent.filter(frame => frame.event === 'saylo:request-catalog').length;
  const updated = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off(); reject(new Error(`Real watcher/socket push did not reach the instance: ${JSON.stringify({
        state: source.getSyncState(), title: instance.t('demo:title'),
        watchedChanges,
        sent: sent.map(frame => frame.event),
        received: received.map(frame => ({ event: frame.event, kind: frame.data.kind,
          revision: frame.data.manifest?.registryRevision, diagnostic: frame.data.message })),
      })}`));
    }, 5000);
    const off = instance.subscribe(snapshot => {
      if (snapshot.t('demo:title') === 'PACK_PUSH_CHANGED') { clearTimeout(timer); off(); resolve(); }
    });
  });
  await writeFile(target, '{"title":"PACK_PUSH_CHANGED","unused":"PACK_UNUSED_MARKER"}');
  await updated;
  assert.equal(sent.filter(frame => frame.event === 'saylo:request-catalog').length, before,
    'The real watcher must deliver the changed catalog without a lookup request.');
  assert.ok(received.some(frame => frame.event === 'saylo:catalog-push' && frame.data.outcomes.length));
  console.log('[pack] Installed automatic key analysis/build and real Vite watcher/WebSocket push passed; no source aliases or lookup round trip.');
} finally {
  instance?.dispose(); source?.dispose(); socket?.close();
  await server?.close();
  assert.equal(path.dirname(root), process.cwd());
  assert.ok(path.basename(root).startsWith('.catalog-features-'));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
