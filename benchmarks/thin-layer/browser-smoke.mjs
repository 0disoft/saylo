import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import saylo from '@0disoft/saylo-vite';

const directory = fileURLToPath(new URL('.', import.meta.url));
const repository = fileURLToPath(new URL('../..', import.meta.url));
const root = await mkdtemp(path.join(directory, '.browser-smoke-'));
const exec = promisify(execFile);
const commands = [
  { id: 'edit', expected: 'Updated Ada', locale: 'fr', locales: ['en', 'fr'], minDiagnostics: 0, content: { greeting: 'Updated {name}' } },
  { id: 'invalid-json', expected: 'Updated Ada', locale: 'fr', locales: ['en', 'fr'], minDiagnostics: 1, content: '{' },
  { id: 'recover-json', expected: 'Recovered Ada', locale: 'fr', locales: ['en', 'fr'], minDiagnostics: 1, content: { greeting: 'Recovered {name}' } },
  { id: 'invalid-schema', expected: 'Recovered Ada', locale: 'fr', locales: ['en', 'fr'], minDiagnostics: 2, content: { greeting: '{unexpected}' } },
  { id: 'recover-schema', expected: 'Ready Ada', locale: 'fr', locales: ['en', 'fr'], minDiagnostics: 2, content: { greeting: 'Ready {name}' } },
  { id: 'locale-add', expected: 'Ready Ada', locale: 'fr', locales: ['en', 'fr', 'ja'], minDiagnostics: 2, add: true, content: { greeting: 'こんにちは {name}' } },
  { id: 'locale-select', expected: 'こんにちは Ada', locale: 'ja', locales: ['en', 'fr', 'ja'], minDiagnostics: 2, select: 'ja' },
  { id: 'locale-remove-selected', expected: 'Hello Ada', locale: 'en', locales: ['en', 'fr'], minDiagnostics: 2, remove: true },
];
let vite, child, timer, active, ready = false, finished = false, index = 0;
const observations = [];
const traces = [];
let resolve, reject;
const completion = new Promise((yes, no) => { resolve = yes; reject = no; });
completion.catch(() => {});
function fail(error) { if (!finished) { finished = true; clearTimeout(timer); reject(error); } }
function arm(label) { clearTimeout(timer); timer = setTimeout(() => fail(new Error(`Timeout: ${label}; ${JSON.stringify(traces)}`)), 30000); }
const interrupted = () => fail(new Error('Browser smoke interrupted.'));
process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
const plugin = { name: 'thin-layer-smoke-channel', configureServer(server) {
  server.middlewares.use('/__thin', (req, res) => {
    void (async () => {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 8192) throw new Error('Oversized request.'); }
      const data = raw ? JSON.parse(raw) : {};
      let response = {};
      switch (req.url) {
        case '/ready':
          assert.equal(ready, false, 'Unexpected page reload'); ready = data; arm('command'); break;
        case '/command':
          assert.ok(ready && !active, 'Premature/overlapping command');
          // Functional scenarios only. Space writes; rapid failure/recovery needs a separate probe.
          if (index) await new Promise(yes => setTimeout(yes, 150));
          active = commands[index];
          if (!active) { response = { kind: 'done' }; finished = true; clearTimeout(timer); resolve(); }
          else { response = { kind: 'step', ...active }; arm(active.id); }
          break;
        case '/armed': {
          assert.equal(data.id, active?.id);
          const file = path.join(root, 'locales', active.add || active.remove ? 'ja' : 'fr', 'demo.json');
          if (active.remove) await rm(file);
          else if (active.content !== undefined) {
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, typeof active.content === 'string' ? active.content : JSON.stringify(active.content));
          }
          break;
        }
        case '/ack':
          assert.equal(data.id, active?.id); assert.equal(data.text, active.expected);
          assert.equal(data.locale, active.locale); assert.deepEqual(data.locales, active.locales);
          assert.equal(data.oldSnapshotText, 'Bonjour Ada'); assert.equal(data.preserved, true);
          assert.equal(data.fallbackPlural, '0 rows'); assert.ok(data.diagnosticCount >= active.minDiagnostics);
          observations.push(data); console.log(`[thin] ${data.id}: PASS`); index++; active = undefined; arm('next command'); break;
        case '/fail': throw new Error(`Browser failure: ${data.message}`);
        case '/trace': traces.push(data); break;
        default: throw new Error('Unknown route');
      }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(response));
    })().catch(error => { fail(error); if (!res.writableEnded) { res.statusCode = 500; res.end(error.message); } });
  });
} };
try {
  await mkdir(path.join(root, 'locales/en'), { recursive: true });
  await mkdir(path.join(root, 'locales/fr'), { recursive: true });
  await writeFile(path.join(root, 'locales/en/demo.json'), JSON.stringify({ greeting: 'Hello {name}', rows: '{count, plural, one {one row} other {# rows}}' }));
  await writeFile(path.join(root, 'locales/fr/demo.json'), JSON.stringify({ greeting: 'Bonjour {name}' }));
  await writeFile(path.join(root, 'package.json'), '{"private":true,"type":"module"}');
  await writeFile(path.join(root, 'index.html'), '<div id="root"></div><script type="module" src="/app.jsx"></script>');
  // Keep the adapter at its real path: its relative core runtime import must stay valid.
  const app = (await readFile(new URL('browser-app.jsx', import.meta.url), 'utf8')).replace("'./catalog-layer.mjs'", JSON.stringify('/@fs/' + path.join(directory, 'catalog-layer.mjs').replaceAll('\\', '/')));
  await writeFile(path.join(root, 'app.jsx'), app);
  vite = await createServer({ configFile: false, root, logLevel: 'error', clearScreen: false,
    plugins: [saylo({ localesDir: 'locales', baseLocale: 'en', initialLocale: 'fr' }), plugin],
    server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [repository] },
      watch: { ignored: ['**/profile/**'] } },
    optimizeDeps: { include: ['react', 'react-dom/client', 'i18next', 'i18next-icu'] } });
  await vite.listen();
  const candidates = process.platform === 'win32' ? [
    path.join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
  ] : ['/usr/bin/chromium', '/usr/bin/google-chrome'];
  let executable;
  for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
  if (!executable) throw new Error('No Chromium executable found.');
  arm('browser readiness');
  child = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', `--user-data-dir=${path.join(root, 'profile')}`,
    `http://127.0.0.1:${vite.httpServer.address().port}/`], { windowsHide: true, stdio: 'ignore' });
  child.once('error', fail); child.once('exit', code => fail(new Error(`Browser exited (${code})`)));
  await completion;
  assert.equal(observations.length, commands.length);
  const files = ['benchmarks/thin-layer/catalog-layer.mjs', 'benchmarks/thin-layer/browser-app.jsx',
    'benchmarks/thin-layer/browser-smoke.mjs', 'benchmarks/thin-layer/package-lock.json',
    'packages/core/dist/runtime.js', 'packages/core/dist/schema.js', 'packages/core/dist/catalog-freeze.js',
    'packages/vite/dist/index.js', 'packages/vite/dist/live-registry.js', 'package-lock.json'];
  const codeHashes = Object.fromEntries(await Promise.all(files.map(async file =>
    [file, createHash('sha256').update(await readFile(path.join(repository, file))).digest('hex')])));
  const packages = {};
  for (const name of ['i18next', 'i18next-icu', 'intl-messageformat'])
    packages[name] = JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, import.meta.url), 'utf8')).version;
  packages.vite = JSON.parse(await readFile(path.join(repository, 'node_modules/vite/package.json'), 'utf8')).version;
  const result = { schema: 'saylo-thin-layer-browser-smoke-v1', observedAt: new Date().toISOString(),
    node: process.version, browser: ready, packages, codeHashes,
    scope: 'Functional probe only: i18next AST layer plus Saylo eager Vite parser/validation/transport and test-only React subscription bridge. Scenarios separated by 150ms. An initial run without spacing timed out on JSON recovery; rapid failure/recovery remains unverified. Browser profile excluded from the watcher. No lazy/reconnect/session protocol, production build, SSR/hydration, timezone, memory or performance comparison. Input value, DOM identity, focus, open dialog, state counter and old snapshot checked after every command. Count 0 distinguishes English fallback plural from French selected-locale formatting.', observations, traces };
  await writeFile(new URL('../results/thin-layer-browser-2026-10-11.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ observations: observations.length, result: 'benchmarks/results/thin-layer-browser-2026-10-11.json' }));
} finally {
  clearTimeout(timer);
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(yes => child.once('exit', yes));
    if (process.platform === 'win32') { try { await exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { child.kill(); } }
    else child.kill('SIGTERM');
    let fallback;
    await Promise.race([exited, new Promise(yes => { fallback = setTimeout(() => { child.kill('SIGKILL'); yes(); }, 3000); })]);
    clearTimeout(fallback);
  }
  await vite?.close();
  process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== path.resolve(directory) || !path.basename(resolved).startsWith('.browser-smoke-'))
    throw new Error('Refusing to remove path outside owned fixture.');
  await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
