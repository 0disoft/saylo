import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { build } from 'vite';
import saylo from '@0disoft/saylo-vite';
import { thinLayerAstRuntime } from './ast-runtime.mjs';
import { createCatalogLayer } from './catalog-layer.mjs';
import { createSsrFixture } from './ssr-fixture.mjs';
import { SsrProbe } from './ssr-view.mjs';
import { connectChromeProtocol } from './chrome-protocol.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const repository = fileURLToPath(new URL('../..', import.meta.url));
const { values } = parseArgs({ options: { out: { type: 'string', default: 'benchmarks/results/thin-layer-ssr-production-current.json' },
  'host-matrix': { type: 'boolean', default: false } } });
const root = await mkdtemp(path.join(directory, '.ssr-production-'));
const exec = promisify(execFile);
const configured = [{ locale: 'ru', timeZone: 'UTC' }, { locale: 'en', timeZone: 'Asia/Seoul' }, { locale: 'ru', timeZone: 'America/Los_Angeles' }];
const cases = values['host-matrix'] ? ['UTC', 'Asia/Seoul', 'America/Los_Angeles']
  .flatMap(hostTimeZone => configured.map(config => ({ ...config, hostTimeZone }))) : configured;
const observations = [];
const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
let server, child, cdp, pageResolve, timer, finished = false;
let resolve, reject;
const completion = new Promise((yes, no) => { resolve = yes; reject = no; });
completion.catch(() => {});
const fail = error => { if (!finished) { finished = true; clearTimeout(timer); reject(error); } };
const interrupted = () => fail(new Error('SSR production probe interrupted.'));
process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
try {
  const rendered = await Promise.all(cases.map(async (config, caseId) => {
    const fixture = createSsrFixture({ ...config, sessionId: `ssr-${caseId}` });
    const layer = await createCatalogLayer('en', fixture.catalogs, config.locale, { timeZone: config.timeZone });
    const snapshot = layer.getSnapshot();
    const adapter = { subscribe: () => () => {}, getSnapshot: () => snapshot, getServerSnapshot: () => snapshot };
    const expected = { initial: snapshot.t('demo:greeting', { name: 'Ada' }), hostTimeZone: config.hostTimeZone,
      when: snapshot.t('demo:when', { at: Date.parse('2026-01-01T00:30:00.000Z') }), timeZone: config.timeZone };
    const html = renderToString(h(SsrProbe, { adapter }));
    assert.ok(html.includes('&lt;/script&gt;')); assert.ok(!fixture.wire.includes('<'));
    return { config, expected, html: `<!doctype html><html><body><div id="root">${html}</div>
      <script id="boot" type="application/json">${fixture.wire}</script>
      <script id="updates" type="application/json">${safeJSON({ caseId, expected, updates: fixture.updates })}</script>
      <script>const reportEarly = message => fetch('/fail', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message})}).catch(() => {});
      addEventListener('error', event => reportEarly(event.message));
      addEventListener('unhandledrejection', event => reportEarly(String(event.reason)));</script>
      <script type="module" src="/assets/client.js"></script></body></html>` };
  }));
  await mkdir(path.join(root, 'locales/en'), { recursive: true });
  await writeFile(path.join(root, 'locales/en/demo.json'), '{"placeholder":"build only"}');
  const bundle = await build({ configFile: false, root, logLevel: 'silent',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [saylo({ localesDir: 'locales', baseLocale: 'en' }), thinLayerAstRuntime()],
    build: { write: false, minify: false, target: 'esnext', lib: {
      entry: path.join(directory, 'ssr-production-client.mjs'), formats: ['es'],
    } },
  });
  const outputs = Array.isArray(bundle) ? bundle : [bundle];
  const chunks = outputs.flatMap(output => output.output.filter(item => item.type === 'chunk'));
  assert.equal(chunks.length, 1);
  const code = chunks[0].code;
  assert.equal(code.includes('EXPECT_ARGUMENT_CLOSING_BRACE'), false, 'production client must omit parser implementation marker');
  server = createServer((req, res) => {
    void (async () => {
      if (req.url === '/assets/client.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(code); return; }
      const match = /^\/case\/(\d+)$/.exec(req.url);
      if (match) {
        const page = rendered[Number(match[1])]; assert.ok(page);
        res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page.html); return;
      }
      if (req.url === '/ack' || req.url === '/fail') {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 32768) throw new Error('Oversized probe request'); }
        const data = JSON.parse(raw);
        if (req.url === '/fail') throw new Error(`Browser failure: ${data.message}`);
        assert.equal(data.caseId, observations.length);
        const page = rendered[data.caseId];
        assert.equal(data.locale, page.config.locale); assert.equal(data.timeZone, page.config.timeZone);
        if (page.config.hostTimeZone) assert.equal(data.hostTimeZone, page.config.hostTimeZone);
        assert.equal(data.when, page.expected.when); assert.equal(data.initial, page.expected.initial);
        assert.equal(data.fallbackPlural, '21 rows');
        assert.equal(data.final, 'Post Ada'); assert.equal(data.preserved, true); assert.equal(data.notifications, 2);
        assert.deepEqual(data.recoverableErrors, []); assert.equal(data.injectionAbsent, true);
        observations.push(data); console.log(`[SSR production] host=${data.hostTimeZone}; ${data.locale}/${data.timeZone}: PASS`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ next: !values['host-matrix'] && observations.length < cases.length ? `/case/${observations.length}` : null }));
        pageResolve?.(); pageResolve = undefined;
        if (observations.length === cases.length) { finished = true; clearTimeout(timer); resolve(); }
        return;
      }
      res.statusCode = 404; res.end();
    })().catch(error => { fail(error); if (!res.writableEnded) { res.statusCode = 500; res.end(error.message); } });
  });
  await new Promise(yes => server.listen(0, '127.0.0.1', yes));
  let executable;
  const candidates = process.platform === 'win32' ? [
    path.join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
  ] : ['/usr/bin/chromium', '/usr/bin/google-chrome'];
  for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
  if (!executable) throw new Error('No Chromium executable found');
  timer = setTimeout(() => fail(new Error(`SSR production timeout; completed ${observations.length}/${cases.length}`)), 45000);
  const profile = path.join(root, 'profile');
  const origin = `http://127.0.0.1:${server.address().port}`;
  child = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', `--user-data-dir=${profile}`,
    ...(values['host-matrix'] ? ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', 'about:blank'] : [`${origin}/case/0`])],
    { windowsHide: true, stdio: 'ignore' });
  child.once('error', fail); child.once('exit', code => fail(new Error(`Browser exited (${code})`)));
  if (values['host-matrix']) {
    cdp = await connectChromeProtocol(profile, child);
    const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
    for (let index = 0; index < cases.length; index++) {
      await cdp.call('Emulation.setTimezoneOverride', { timezoneId: cases[index].hostTimeZone }, sessionId);
      const acknowledged = new Promise(yes => { pageResolve = yes; });
      const navigated = await cdp.call('Page.navigate', { url: `${origin}/case/${index}` }, sessionId);
      assert.equal(navigated.errorText, undefined, 'production navigation failed');
      await Promise.race([acknowledged, completion]);
    }
  }
  await completion;
  const files = ['benchmarks/thin-layer/ssr-production-probe.mjs', 'benchmarks/thin-layer/ssr-production-client.mjs',
    'benchmarks/thin-layer/ssr-view.mjs', 'benchmarks/thin-layer/ssr-fixture.mjs', 'benchmarks/thin-layer/hydration-layer.mjs',
    'benchmarks/thin-layer/chrome-protocol.mjs',
    'benchmarks/thin-layer/ast-runtime.mjs', 'benchmarks/thin-layer/ast-format.mjs', 'benchmarks/thin-layer/catalog-layer.mjs',
    'benchmarks/thin-layer/package-lock.json', 'packages/core/dist/boot.js', 'packages/core/dist/formatters.js',
    'packages/vite/dist/ast-formatter.js', 'package-lock.json'];
  const codeHashes = Object.fromEntries(await Promise.all(files.map(async file => [file,
    createHash('sha256').update(await readFile(path.join(repository, file))).digest('hex')])));
  await writeFile(path.resolve(repository, values.out), JSON.stringify({ format: 'saylo-thin-layer-ssr-production-v2',
    observedAt: new Date().toISOString(), node: process.version, codeHashes,
    productionClient: { bytes: Buffer.byteLength(code), gzipBytes: gzipSync(code).length,
      sha256: createHash('sha256').update(code).digest('hex'), parserImplementationMarker: false, moduleIds: chunks[0].moduleIds },
    browserHostMatrix: values['host-matrix'],
    scope: 'Concurrent Node React SSR requests with isolated locale/timezone, then actual Chromium hydration of one Vite-built production client. Reuses Saylo boot validation and adds a prototype hydration barrier. With host-matrix: CDP emulates three browser host timezones and verifies actual Intl timezone across nine pages; no OS timezone changes. Otherwise: three configured zones in one browser host. No lazy/session/reconnect/large-scale performance or memory proof. Bundle includes React/DOM and bootstrap validation; not comparable to small translator-only fixture size.',
    observations }, null, 2) + '\n');
} finally {
  clearTimeout(timer);
  cdp?.close();
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(yes => child.once('exit', yes));
    if (process.platform === 'win32') { try { await exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { child.kill(); } }
    else child.kill('SIGTERM');
    let fallback;
    await Promise.race([exited, new Promise(yes => { fallback = setTimeout(() => { child.kill('SIGKILL'); yes(); }, 3000); })]);
    clearTimeout(fallback);
  }
  if (server) { server.closeAllConnections(); await new Promise(yes => server.close(yes)); }
  process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(directory)); assert.ok(path.basename(resolved).startsWith('.ssr-production-'));
  await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
