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
const { values } = parseArgs({ options: { out: { type: 'string', default: 'benchmarks/results/thin-layer-lazy-browser-current.json' } } });
const root = await mkdtemp(path.join(directory, '.lazy-browser-'));
const observations = [], exec = promisify(execFile);
let vite, child, cdp;
let interrupted;
const interrupt = () => { interrupted = new Error('Lazy browser probe interrupted.'); };
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
const candidates = process.platform === 'win32' ? [
  path.join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
] : ['/usr/bin/chromium', '/usr/bin/google-chrome'];
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
async function until(read, accepts, label) {
  const deadline = Date.now() + 12000;
  let value;
  while (Date.now() < deadline) {
    if (interrupted) throw interrupted;
    value = await read(); if (accepts(value)) return value;
    await delay(40);
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
    await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); })]);
    clearTimeout(timer);
  }
  child = undefined;
}
try {
  assert.ok(executable, 'No Chromium executable found.');
  for (const variant of ['core', 'layer']) {
    const fixture = path.join(root, variant), frames = [], requests = [], steps = [];
    await mkdir(fixture);
    for (const locale of ['en', 'fr', 'ja']) {
      await mkdir(path.join(fixture, 'locales', locale), { recursive: true });
      for (const namespace of ['demo', 'help']) await writeFile(path.join(fixture, 'locales', locale, `${namespace}.json`),
        JSON.stringify(namespace === 'demo' ? { greeting: `${locale} {name}` } : { title: `${locale}-help {name}` }));
    }
    await writeFile(path.join(fixture, 'package.json'), '{"private":true,"type":"module"}');
    await writeFile(path.join(fixture, 'index.html'), '<div id="root"></div><script type="module" src="/app.jsx"></script>');
    const factory = variant === 'core' ? "import { createI18n as create } from '@0disoft/saylo-core/runtime';"
      : `import { createLazyLayer as create } from ${JSON.stringify('/@fs/' + path.join(directory, 'lazy-layer.mjs').replaceAll('\\', '/'))};`;
    const app = (await readFile(new URL('lazy-browser-app.jsx', import.meta.url), 'utf8')).replace("import { create } from '__FACTORY__';", factory);
    await writeFile(path.join(fixture, 'app.jsx'), app);
    const observer = { name: 'lazy-wire-observer', configureServer(server) {
      server.ws.on('saylo:request-catalog', request => requests.push({ ...request }));
      server.ws.on('connection', socket => {
        const send = socket.send;
        socket.send = function(payload, ...args) {
          if (typeof payload === 'string') {
            const message = JSON.parse(payload);
            if (message.type === 'custom' && message.event.startsWith('saylo:')) {
              const { manifest, request, result, kind, message: diagnostic } = message.data;
              frames.push({ event: message.event, kind, revision: manifest?.registryRevision,
                request, status: result?.status, diagnostic });
            }
          }
          return send.call(this, payload, ...args);
        };
      });
    } };
    vite = await createServer({ configFile: false, root: fixture, logLevel: 'error', clearScreen: false,
      plugins: [saylo({ localesDir: 'locales', baseLocale: 'en', initialLocale: 'fr', initialNamespaces: [], timeZone: 'UTC' }), observer],
      server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [repository] }, watch: { ignored: ['**/profile/**'] } },
      optimizeDeps: { include: ['react', 'react-dom/client', 'i18next', 'i18next-icu', '@0disoft/saylo-core/runtime'] } });
    await vite.listen();
    const profile = path.join(fixture, 'profile');
    child = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
      { windowsHide: true, stdio: 'ignore' });
    // An asynchronous launch error must never become an unhandled event.
    let launchError;
    child.on('error', error => { launchError = error; });
    cdp = await connectChromeProtocol(profile, child);
    assert.equal(launchError, undefined);
    const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async expression => {
      if (interrupted) throw interrupted;
      const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const read = () => evaluate('window.__lazyProbe?.read()');
    const action = (kind, value) => evaluate(`window.__lazyProbe.action(${JSON.stringify(kind)}, ${JSON.stringify(value) ?? 'undefined'})`);
    const record = async (id, text, locale = 'fr', help = 'unloaded') => {
      const data = await until(read, value => value?.ready && value.text === text && value.locale === locale && value.help === help, id);
      assert.equal(data.preserved, true, id); assert.equal(data.boots, 1, 'Unexpected page reload'); assert.deepEqual(data.errors, []);
      if (data.retainedText !== undefined) assert.equal(data.retainedText, 'fr Ada');
      steps.push({ id, ...data, requestCount: requests.length }); console.log(`[lazy browser] ${variant}/${id}: PASS`);
      return data;
    };
    const edit = (locale, namespace, content) => writeFile(path.join(fixture, 'locales', locale, `${namespace}.json`),
      typeof content === 'string' ? content : JSON.stringify(content));
    await cdp.call('Page.navigate', { url: `http://127.0.0.1:${vite.httpServer.address().port}/` }, sessionId);
    const cold = await record('cold', 'unloaded'); assert.equal(cold.cachedCatalogs, 0); assert.equal(requests.length, 0);
    await action('namespace', 'demo'); const demo = await record('load-demo', 'fr Ada'); assert.equal(demo.cachedCatalogs, 2);
    await action('retain'); await action('locale', 'ja'); await record('select-ja', 'ja Ada', 'ja');
    await action('namespace', 'help'); const help = await record('load-help', 'ja Ada', 'ja', 'ja-help Ada'); assert.equal(help.cachedCatalogs, 5);
    await edit('ja', 'demo', { greeting: 'Updated {name}' }); await record('live-edit', 'Updated Ada', 'ja', 'ja-help Ada');
    assert.ok(frames.some(frame => frame.status === 'patch' && frame.request.locale === 'ja'), 'Actual patch reply expected');
    await edit('ja', 'demo', '{'); await until(read, value => value?.diagnostics.length >= 1, 'invalid JSON diagnostic');
    await record('invalid-json-last-good', 'Updated Ada', 'ja', 'ja-help Ada');
    await edit('ja', 'demo', { greeting: 'Recovered {name}' }); await record('recover-json', 'Recovered Ada', 'ja', 'ja-help Ada');
    const before = requests.length, revision = (await read()).manifestRevision;
    await edit('fr', 'help', { title: 'Fresh-help {name}' });
    await until(read, value => value?.manifestRevision > revision, 'unloaded pair manifest');
    await record('unselected-pair-edit', 'Recovered Ada', 'ja', 'ja-help Ada'); assert.equal(requests.length, before);
    assert.equal(requests.some(request => request.locale === 'fr' && request.namespace === 'help'), false);
    await action('locale', 'fr'); await record('select-fr-fresh-help', 'fr Ada', 'fr', 'Fresh-help Ada');
    await action('detach'); const beforeDetach = requests.length, lastRevision = (await read()).manifestRevision;
    await edit('fr', 'demo', { greeting: 'Rebound {name}' });
    await until(async () => frames, value => value.some(frame => frame.event === 'saylo:manifest' && frame.revision > lastRevision), 'detached update broadcast');
    await record('detached-last-good', 'fr Ada', 'fr', 'Fresh-help Ada'); assert.equal(requests.length, beforeDetach);
    await action('rebind'); await record('rebind-catch-up', 'Rebound Ada', 'fr', 'Fresh-help Ada');
    const handshakes = frames.filter(frame => frame.event === 'saylo:manifest' && frame.kind === 'snapshot').length;
    assert.ok(handshakes >= 2, 'Rebinding must perform a real manifest handshake');
    // Real Vite socket loss is deliberately separate from bridge rebinding.
    // Default Vite reloads the document after its restart ping succeeds.
    assert.equal(vite.ws.clients.size, 1); for (const client of vite.ws.clients) client.socket.terminate();
    const reloaded = await until(async () => {
      try { return await read(); } catch (error) {
        if (/context|Execution|Inspected target|Cannot find/i.test(error.message)) return undefined;
        throw error;
      }
    }, value => value?.ready && value.boots === 2, 'Vite physical socket reconnect reload');
    assert.equal(reloaded.preserved, false); assert.equal(reloaded.text, 'unloaded');
    assert.equal(reloaded.inputValue, 'initial draft'); assert.equal(reloaded.counter, '7'); assert.equal(reloaded.dialogOpen, false);
    assert.deepEqual(reloaded.errors, []);
    steps.push({ id: 'physical-socket-loss-vite-reload', ...reloaded });
    console.log(`[lazy browser] ${variant}/physical-socket-loss: observed Vite reload and UI reset`);
    observations.push({ variant, steps, requests, frames, manifestHandshakesBeforeSocketLoss: handshakes,
      userAgent: await evaluate('navigator.userAgent') });
    await closeBrowser(); await vite.close(); vite = undefined;
  }
  const files = ['benchmarks/thin-layer/lazy-browser-probe.mjs', 'benchmarks/thin-layer/lazy-browser-app.jsx',
    'benchmarks/thin-layer/chrome-protocol.mjs', 'benchmarks/thin-layer/lazy-layer.mjs', 'benchmarks/thin-layer/lazy-source-cache.mjs',
    'benchmarks/thin-layer/catalog-layer.mjs', 'benchmarks/thin-layer/ast-format.mjs', 'benchmarks/thin-layer/package-lock.json',
    'packages/core/dist/i18n.js', 'packages/core/dist/catalog-loader.js', 'packages/core/dist/boot.js',
    'packages/core/dist/schema.js', 'packages/core/dist/runtime.js',
    'packages/vite/dist/catalog-source.js', 'packages/vite/dist/catalog-wire.js',
    'packages/vite/dist/lazy-connection.js', 'packages/vite/dist/dev-sync.js', 'packages/vite/dist/index.js',
    'node_modules/vite/dist/client/client.mjs', 'package-lock.json'];
  const codeHashes = Object.fromEntries(await Promise.all(files.map(async file => [file,
    createHash('sha256').update(await readFile(path.join(repository, file))).digest('hex')])));
  const packages = {};
  for (const name of ['i18next', 'intl-messageformat'])
    packages[name] = JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, import.meta.url), 'utf8')).version;
  for (const name of ['vite', 'react', 'react-dom'])
    packages[name] = JSON.parse(await readFile(path.join(repository, 'node_modules', name, 'package.json'), 'utf8')).version;
  await writeFile(path.resolve(repository, values.out), JSON.stringify({ format: 'saylo-thin-layer-lazy-browser-v1',
    observedAt: new Date().toISOString(), node: process.version, packages, codeHashes,
    scope: 'Functional Chromium/Vite dev probe with six catalog pairs, public virtual:saylo/lazy source and connectDev bridge. Two independent fixtures: core and prototype. Real compact and patch frames, partial requests, invalid JSON last-good, unselected pair edit and same-session bridge catch-up. Input/DOM/focus/caret/dialog/React counter retained until an actual socket termination; default Vite then reloads and resets both UIs. No transparent physical reconnect, restarted-server session change, pending reply race, typegen, production browser lazy or performance claim.',
    observations }, null, 2) + '\n');
} finally {
  await closeBrowser(); await vite?.close();
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(directory)); assert.ok(path.basename(resolved).startsWith('.lazy-browser-'));
  await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
