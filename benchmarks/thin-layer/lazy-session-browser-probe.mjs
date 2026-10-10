import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import saylo from '@0disoft/saylo-vite';
import { connectChromeProtocol } from './chrome-protocol.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const repository = fileURLToPath(new URL('../..', import.meta.url));
const { values } = parseArgs({ options: { out: { type: 'string', default: 'benchmarks/results/thin-layer-lazy-session-browser-current.json' } } });
const root = await mkdtemp(path.join(directory, '.lazy-session-browser-'));
const observations = [], exec = promisify(execFile), hash = value => createHash('sha256').update(value).digest('hex');
let vite, child, cdp, interrupted;
const interrupt = () => { interrupted = new Error('Session browser probe interrupted.'); };
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
async function until(read, accepts, label) {
  const deadline = Date.now() + 12000;
  let value;
  while (Date.now() < deadline) {
    if (interrupted) throw interrupted;
    value = await read(); if (accepts(value)) return value; await delay(40);
  }
  throw new Error(`Timeout ${label}: ${JSON.stringify(value)}`);
}
async function closeBrowser() {
  cdp?.close(); cdp = undefined;
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    if (process.platform === 'win32') await exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => child.kill());
    else child.kill('SIGTERM');
    let timer;
    await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); })]); clearTimeout(timer);
  }
  child = undefined;
}
const appExtension = `
let notifications=0;
const settlements=[],barriers=[];
instance.subscribe(()=>notifications++);
import.meta.hot.on('saylo-probe:barrier',id=>barriers.push(id));
const sessionRead=()=>({...read(),sessionId:catalogSource.readManifest().sessionId,
  bootSessionId:instance.getBootSnapshot().manifest.sessionId,notifications,settlements:[...settlements],barriers:[...barriers]});
window.__sessionProbe={read:sessionRead,action:window.__lazyProbe.action,
  start(kind,value,id){
    window.__lazyProbe.action(kind,value).then(()=>settlements.push({id,status:'fulfilled'}),
      error=>settlements.push({id,status:'rejected',name:error.name}));
    return id;
  }};
`;
try {
  const candidates = process.platform === 'win32' ? [
    path.join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
  ] : ['/usr/bin/chromium', '/usr/bin/google-chrome'];
  let executable;
  for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
  assert.ok(executable, 'No Chromium executable found.');
  for (const variant of ['core', 'layer']) {
    const fixture = path.join(root, variant), frames = [], held = [], deliveries = [], requests = [], steps = [];
    let holdMode = 'open', serverGeneration = 0;
    await mkdir(fixture);
    await writeFile(path.join(fixture, 'package.json'), '{"private":true,"type":"module"}');
    for (const locale of ['en', 'fr', 'ja']) {
      await mkdir(path.join(fixture, 'locales', locale), { recursive: true });
      for (const namespace of ['demo', 'help']) await writeFile(path.join(fixture, 'locales', locale, `${namespace}.json`),
        JSON.stringify(namespace === 'demo' ? { greeting: `${locale} {name}` } : { title: `${locale}-help {name}` }));
    }
    const factory = variant === 'core' ? "import { createI18n as create } from '@0disoft/saylo-core/runtime';"
      : `import { createLazyLayer as create } from ${JSON.stringify('/@fs/' + path.join(directory, 'lazy-layer.mjs').replaceAll('\\', '/'))};`;
    await writeFile(path.join(fixture, 'app.jsx'), (await readFile(new URL('lazy-browser-app.jsx', import.meta.url), 'utf8'))
      .replace("import { create } from '__FACTORY__';", factory) + appExtension);
    await writeFile(path.join(fixture, 'index.html'), '<div id="root"></div><script type="module" src="/app.jsx"></script>');
    async function startServer(port = 0) {
      const generation = ++serverGeneration;
      const observer = { name: 'session-reply-delay-observer', configureServer(server) {
        server.ws.on('saylo:request-catalog', request => requests.push({ serverGeneration: generation, ...request }));
        server.ws.on('connection', socket => {
          const send = socket.send;
          socket.send = function(payload, ...args) {
            if (typeof payload === 'string') {
              const message = JSON.parse(payload);
              if (message.type === 'custom' && message.event.startsWith('saylo:')) {
                const { request, result, manifest, kind } = message.data;
                const delayReply = message.event === 'saylo:catalog' && request.namespace === 'demo' &&
                  ((holdMode === 'fr-replies' && request.locale === 'fr' && (result.status === 'patch' || result.status === 'compact')) ||
                    (holdMode === 'ja-compact' && request.locale === 'ja' && result.status === 'compact'));
                const frame = { event: message.event, serverGeneration: generation, kind, request, status: result?.status,
                  sessionId: result?.sessionId ?? manifest?.sessionId, revision: manifest?.registryRevision,
                  catalogVersion: result?.catalogVersion, held: delayReply, payloadSha256: hash(payload) };
                frames.push(frame);
                // Only timing/order changes; the actual product reply bytes remain untouched.
                if (delayReply) { held.push({ socket: this, send, payload, args, frame }); return; }
              }
            }
            return send.call(this, payload, ...args);
          };
        });
      } };
      const server = await createServer({ configFile: false, root: fixture, logLevel: 'error', clearScreen: false,
        plugins: [saylo({ localesDir: 'locales', baseLocale: 'en', initialLocale: 'fr', initialNamespaces: [], timeZone: 'UTC' }), observer],
        server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [repository] }, watch: { ignored: ['**/profile/**'] } },
        optimizeDeps: { include: ['react', 'react-dom/client', 'i18next', 'i18next-icu', '@0disoft/saylo-core/runtime'] } });
      try { await server.listen(); return server; } catch (error) { await server.close(); throw error; }
    }
    vite = await startServer();
    const port = vite.httpServer.address().port, profile = path.join(fixture, 'profile');
    child = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
      { windowsHide: true, stdio: 'ignore' });
    let launchError; child.on('error', error => { launchError = error; });
    cdp = await connectChromeProtocol(profile, child); assert.equal(launchError, undefined);
    const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async expression => {
      if (interrupted) throw interrupted;
      const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails)); return result.result.value;
    };
    const read = () => evaluate('window.__sessionProbe?.read()');
    const action = (kind, value) => evaluate(`window.__sessionProbe.action(${JSON.stringify(kind)},${JSON.stringify(value) ?? 'undefined'})`);
    const start = (kind, value, id) => evaluate(`window.__sessionProbe.start(${JSON.stringify(kind)},${JSON.stringify(value)},${JSON.stringify(id)})`);
    let barrier = 0;
    async function acknowledge() {
      const id = `receipt-${++barrier}`;
      for (const client of vite.ws.clients) client.send({ type: 'custom', event: 'saylo-probe:barrier', data: id });
      return until(read, value => value?.barriers.includes(id), id);
    }
    function release(reply) {
      assert.equal(reply.socket.readyState, 1); assert.equal(hash(reply.payload), reply.frame.payloadSha256);
      reply.send.call(reply.socket, reply.payload, ...reply.args);
      deliveries.push({ ...reply.frame, kind: 'release-on-original-socket', unchangedPayload: true });
    }
    async function record(id, text, boots = 1) {
      const data = await until(read, value => value?.ready && value.text === text && value.locale === 'fr' && value.boots === boots, id);
      assert.equal(data.preserved, boots === 1, id); assert.deepEqual(data.errors, []); assert.deepEqual(data.diagnostics, []);
      assert.equal(data.sessionId, data.bootSessionId);
      if (boots === 1 && data.retainedText !== undefined) assert.equal(data.retainedText, 'fr Ada');
      steps.push({ id, ...data }); console.log(`[session browser] ${variant}/${id}: PASS`); return data;
    }
    const edit = text => writeFile(path.join(fixture, 'locales/fr/demo.json'), JSON.stringify({ greeting: text }));
    await cdp.call('Page.navigate', { url: `http://127.0.0.1:${port}/` }, sessionId);
    await record('cold', 'unloaded'); await action('namespace', 'demo');
    const first = await record('load-demo', 'fr Ada'); await action('retain');
    holdMode = 'fr-replies';
    await edit('Obsolete {name}'); await until(async () => held.map(reply => reply.frame), list => list.length === 1, 'first held patch');
    const obsolete = held[0]; assert.equal(obsolete.frame.catalogVersion, 2);
    await record('patch-held-last-good', 'fr Ada');
    await edit('Current {name}'); await until(async () => held.map(reply => reply.frame), list => list.length === 2, 'newer held full reply');
    const current = held[1]; assert.equal(current.frame.catalogVersion, 3); assert.equal(current.frame.status, 'compact');
    await record('newer-full-held-last-good', 'fr Ada');
    holdMode = 'open'; release(current); await acknowledge();
    const latest = await record('newer-full-first', 'Current Ada');
    release(obsolete); await acknowledge();
    const ignored = await record('older-patch-late-ignored', 'Current Ada');
    assert.equal(ignored.notifications, latest.notifications); assert.equal(ignored.notifications, first.notifications + 1);
    holdMode = 'ja-compact';
    await start('locale', 'ja', 'older-ja');
    await until(async () => held.map(reply => reply.frame), list => list.length === 3, 'held ja compact');
    const ja = held[2]; assert.equal(ja.frame.request.locale, 'ja');
    await record('locale-request-held-last-good', 'Current Ada');
    await start('locale', 'fr', 'newer-fr');
    await until(read, value => value?.settlements.length === 2, 'superseded locale settlements');
    const superseded = await record('newer-locale-wins', 'Current Ada');
    assert.deepEqual(superseded.settlements, [{ id: 'older-ja', status: 'rejected', name: 'SupersededRequestError' },
      { id: 'newer-fr', status: 'fulfilled' }]);
    holdMode = 'open'; release(ja); await acknowledge();
    const lateLocale = await record('superseded-locale-reply-ignored', 'Current Ada');
    assert.equal(lateLocale.notifications, superseded.notifications);
    const oldSession = first.sessionId;
    // Close the actual server, mutate disk while no watcher is running, then
    // create a new Saylo plugin/server on the exact same port. No page navigation.
    await vite.close(); vite = undefined;
    await edit('Restarted {name}'); vite = await startServer(port);
    const reloaded = await until(async () => {
      try { return await read(); } catch (error) {
        if (/context|Execution|Inspected target|Cannot find/i.test(error.message)) return undefined;
        throw error;
      }
    }, value => value?.ready && value.boots === 2 && value.sessionId !== oldSession, 'new server automatic reload');
    assert.equal(reloaded.cachedCatalogs, 0); assert.deepEqual(reloaded.loadedNamespaces, []);
    assert.equal(reloaded.inputValue, 'initial draft'); assert.equal(reloaded.counter, '7'); assert.equal(reloaded.dialogOpen, false);
    await record('new-session-vite-reload', 'unloaded', 2);
    await action('namespace', 'demo'); const fresh = await record('new-session-fresh-catalog', 'Restarted Ada', 2);
    const newCatalogs = frames.filter(frame => frame.serverGeneration === 2 && frame.event === 'saylo:catalog');
    assert.equal(newCatalogs.length, 2); assert.ok(newCatalogs.every(frame => frame.status === 'compact' &&
      frame.sessionId === fresh.sessionId && frame.request.known === undefined && frame.catalogVersion === 1));
    // Controlled replay after a fresh document: real old reply bytes, sent on
    // the new socket unchanged. This is not same-instance session adoption.
    assert.equal(vite.ws.clients.size, 1);
    for (const client of vite.ws.clients) client.socket.send(obsolete.payload);
    deliveries.push({ ...obsolete.frame, kind: 'controlled-replay-on-new-socket', newSessionId: fresh.sessionId, unchangedPayload: true });
    await acknowledge(); const replayed = await record('retired-document-reply-replayed', 'Restarted Ada', 2);
    assert.equal(replayed.notifications, fresh.notifications);
    observations.push({ variant, steps, frames, requests, deliveries, oldSessionId: oldSession, newSessionId: fresh.sessionId,
      userAgent: await evaluate('navigator.userAgent') });
    await closeBrowser(); await vite.close(); vite = undefined;
  }
  const files = ['benchmarks/thin-layer/lazy-session-browser-probe.mjs', 'benchmarks/thin-layer/lazy-browser-app.jsx',
    'benchmarks/thin-layer/chrome-protocol.mjs', 'benchmarks/thin-layer/lazy-layer.mjs', 'benchmarks/thin-layer/lazy-source-cache.mjs',
    'benchmarks/thin-layer/catalog-layer.mjs', 'benchmarks/thin-layer/ast-format.mjs', 'benchmarks/thin-layer/package-lock.json',
    'packages/core/dist/i18n.js', 'packages/core/dist/catalog-loader.js', 'packages/vite/dist/catalog-source.js',
    'packages/vite/dist/catalog-wire.js', 'packages/vite/dist/catalog-patch.js', 'packages/vite/dist/lazy-connection.js',
    'packages/vite/dist/dev-sync.js', 'packages/vite/dist/index.js', 'node_modules/vite/dist/client/client.mjs', 'package-lock.json'];
  const codeHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(path.join(repository, file)))])));
  const packages = {};
  for (const name of ['i18next', 'intl-messageformat'])
    packages[name] = JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, import.meta.url))).version;
  for (const name of ['vite', 'react', 'react-dom'])
    packages[name] = JSON.parse(await readFile(path.join(repository, 'node_modules', name, 'package.json'))).version;
  await writeFile(path.resolve(repository, values.out), JSON.stringify({ format: 'saylo-thin-layer-lazy-session-browser-v1',
    observedAt: new Date().toISOString(), node: process.version, packages, codeHashes,
    scope: 'Real Chromium and Vite public dev source/bridge, two independent core/prototype fixtures. Actual product v2 patch and v3 full compact reply held and released v3 before v2; actual locale compact response held while older API is superseded. Custom FIFO receipt barrier precedes state assertions. Then actual old server closes and a new Saylo server starts on same port; default Vite reloads the document, new session loads version-one full catalogs and resets UI. Controlled unchanged old reply replay on new socket is ignored. No synthetic manifest/catalog payload. No same-instance transparent new-session adoption, physical reconnect preserving UI, cross-session pending-flight continuation, broad race matrix, performance or memory comparison.',
    observations }, null, 2) + '\n');
} finally {
  await closeBrowser(); await vite?.close();
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(directory)); assert.ok(path.basename(resolved).startsWith('.lazy-session-browser-'));
  await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
