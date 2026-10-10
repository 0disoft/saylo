import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'vite';
import saylo from '@0disoft/saylo-vite';
import { thinLayerAstRuntime } from './ast-runtime.mjs';
import { connectChromeProtocol } from './chrome-protocol.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const repository = fileURLToPath(new URL('../..', import.meta.url));
const { values } = parseArgs({ options: { out: { type: 'string', default: 'benchmarks/results/thin-layer-lazy-production-browser-current.json' }, sync: { type: 'boolean', default: false } } });
const root = await mkdtemp(path.join(directory, '.lazy-production-browser-'));
const observations = [], exec = promisify(execFile);
let server, child, cdp, interrupted;
const interrupt = () => { interrupted = new Error('Production lazy browser probe interrupted.'); };
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
    await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); })]);
    clearTimeout(timer);
  }
  child = undefined;
}
const sampleExtension = `
// This fixture extension samples the same runtime that drives the React UI.
const coldSnapshot = instance.getSnapshot();
const productionRead = () => {
  const snapshot = instance.getSnapshot();
  let coldError;
  try { coldSnapshot.t('demo:greeting', {name:'Ada'}); } catch(error) { coldError=error.name; }
  return {...read(), coldError, timeZone:snapshot.timeZone,
    fallbackPlural:snapshot.loadedNamespaces.includes('demo') ? snapshot.t('demo:rows',{count:21}) : undefined,
    fallbackDate:snapshot.loadedNamespaces.includes('demo') ? snapshot.t('demo:when',{at:Date.parse('2026-01-01T00:30:00.000Z')}) : undefined,
    hostTimeZone:new Intl.DateTimeFormat('en').resolvedOptions().timeZone};
};
window.__productionProbe={read:productionRead, async action(kind,value) {
  if(kind==='refresh') {
    const before=instance.getSnapshot(); await instance.refresh();
    return {...productionRead(), sameSnapshot:instance.getSnapshot()===before};
  }
  if(kind==='unknown') {
    let namespaceError, keyError;
    try { await instance.loadNamespace('absent'); } catch(error) { namespaceError=error.name; }
    try { instance.t('absent:title'); } catch(error) { keyError=error.name; }
    return {...productionRead(), namespaceError, keyError};
  }
  await window.__lazyProbe.action(kind,value); return productionRead();
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
    const fixture = path.join(root, variant), outDir = path.join(fixture, 'dist'), requests = [], steps = [];
    await mkdir(fixture);
    await writeFile(path.join(fixture, 'package.json'), '{"private":true,"type":"module"}');
    for (const locale of ['en', 'ru', 'ja']) {
      await mkdir(path.join(fixture, 'locales', locale), { recursive: true });
      await writeFile(path.join(fixture, 'locales', locale, 'demo.json'), JSON.stringify({ greeting: `${locale} {name}`,
        ...(locale === 'en' ? { rows: '{count, plural, one {one row} other {# rows}}', when: '{at, date} / {at, time, ::HHmm}' } : {}) }));
      await writeFile(path.join(fixture, 'locales', locale, 'help.json'), JSON.stringify({ title: `${locale}-help {name}` }));
    }
    const factory = variant === 'core' ? "import { createI18n as create } from '@0disoft/saylo-core/runtime';"
      : `import { ${values.sync ? 'createLazyLayerSync' : 'createLazyLayer'} as create } from ${JSON.stringify(path.join(directory, 'lazy-layer.mjs').replaceAll('\\', '/'))};`;
    const app = (await readFile(new URL('lazy-browser-app.jsx', import.meta.url), 'utf8'))
      .replace("import { create } from '__FACTORY__';", factory)
      .replace('const instance = await create(', values.sync ? 'const instance = create(' : 'const instance = await create(') + sampleExtension;
    await writeFile(path.join(fixture, 'app.jsx'), app);
    await writeFile(path.join(fixture, 'index.html'), '<div id="root"></div><script type="module" src="/app.jsx"></script>');
    assert.equal(path.dirname(path.resolve(outDir)), path.resolve(fixture));
    const result = await build({ configFile: false, root: fixture, logLevel: 'silent',
      plugins: [saylo({ localesDir: 'locales', baseLocale: 'en', initialLocale: 'ru', initialNamespaces: [], timeZone: 'UTC' }),
        ...(variant === 'layer' ? [thinLayerAstRuntime()] : [])],
      build: { minify: false, target: 'esnext', outDir, emptyOutDir: true } });
    const outputs = Array.isArray(result) ? result : [result];
    const chunks = outputs.flatMap(output => output.output.filter(item => item.type === 'chunk'));
    assert.equal(chunks.some(chunk => chunk.code.includes('EXPECT_ARGUMENT_CLOSING_BRACE')), false);
    const pairChunks = chunks.flatMap(chunk => chunk.moduleIds.filter(id => id.startsWith('\0virtual:saylo/catalog/'))
      .map(id => ({ pair: id.slice('\0virtual:saylo/catalog/'.length).split('/').map(decodeURIComponent).join('/'), fileName: chunk.fileName })));
    assert.equal(pairChunks.length, 6); assert.equal(new Set(pairChunks.map(chunk => chunk.fileName)).size, 6);
    const served = new Map();
    for (const output of outputs) for (const item of output.output)
      served.set('/' + item.fileName, { body: item.type === 'chunk' ? item.code : item.source,
        type: item.fileName.endsWith('.html') ? 'text/html; charset=utf-8' : item.fileName.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
    server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1').pathname;
      const asset = served.get(url === '/' ? '/index.html' : url);
      const status = asset ? 200 : 404;
      requests.push({ url, status });
      res.statusCode = status; res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', asset?.type ?? 'text/plain'); res.end(asset?.body ?? 'Not found');
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const profile = path.join(fixture, 'profile');
    child = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
      { windowsHide: true, stdio: 'ignore' });
    let launchError; child.on('error', error => { launchError = error; });
    cdp = await connectChromeProtocol(profile, child); assert.equal(launchError, undefined);
    const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
    await cdp.call('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Seoul' }, sessionId);
    const evaluate = async expression => {
      if (interrupted) throw interrupted;
      const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails)); return result.result.value;
    };
    const read = () => evaluate('window.__productionProbe?.read()');
    const action = (kind, value) => evaluate(`window.__productionProbe.action(${JSON.stringify(kind)}, ${JSON.stringify(value) ?? 'undefined'})`);
    const requestedPairs = () => requests.flatMap(request => pairChunks.filter(chunk => '/' + chunk.fileName === request.url).map(chunk => chunk.pair));
    async function record(id, text, locale, help, expectedPairs, extra = {}) {
      const data = await until(read, value => value?.ready && value.text === text && value.locale === locale && value.help === help, id);
      assert.equal(data.preserved, true, id); assert.equal(data.boots, 1); assert.deepEqual(data.errors, []); assert.deepEqual(data.diagnostics, []);
      assert.equal(data.hostTimeZone, 'Asia/Seoul'); assert.equal(data.timeZone, 'UTC');
      assert.equal(data.coldError, 'NamespaceNotLoadedError');
      if (data.retainedText !== undefined) assert.equal(data.retainedText, 'ru Ada');
      if (data.loadedNamespaces.includes('demo')) { assert.equal(data.fallbackPlural, '21 rows'); assert.equal(data.fallbackDate, '1/1/2026 / 00:30'); }
      const pairs = requestedPairs(); assert.deepEqual([...pairs].sort(), [...expectedPairs].sort(), id);
      assert.equal(data.cachedCatalogs, expectedPairs.length);
      const resources = await evaluate("performance.getEntriesByType('resource').map(entry=>({url:new URL(entry.name).pathname,initiatorType:entry.initiatorType}))");
      const resourcePairs = resources.flatMap(resource => pairChunks.filter(chunk => '/' + chunk.fileName === resource.url).map(chunk => chunk.pair));
      assert.deepEqual([...resourcePairs].sort(), [...expectedPairs].sort(), 'Browser resource entries match actual served chunks');
      steps.push({ id, ...data, ...extra, requestedPairs: pairs, catalogResourcePairs: resourcePairs });
      console.log(`[production browser] ${variant}/${id}: ${pairs.length} catalog chunks, state preserved PASS`);
    }
    await cdp.call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` }, sessionId);
    await record('cold', 'unloaded', 'ru', 'unloaded', []);
    await action('namespace', 'demo'); await record('load-demo', 'ru Ada', 'ru', 'unloaded', ['en/demo', 'ru/demo']);
    await action('retain'); await action('locale', 'ja');
    await record('select-ja', 'ja Ada', 'ja', 'unloaded', ['en/demo', 'ru/demo', 'ja/demo']);
    await action('namespace', 'help');
    const loaded = ['en/demo', 'ru/demo', 'ja/demo', 'en/help', 'ja/help'];
    await record('load-help', 'ja Ada', 'ja', 'ja-help Ada', loaded);
    const refresh = await action('refresh'); assert.equal(refresh.sameSnapshot, true);
    await record('no-op-refresh', 'ja Ada', 'ja', 'ja-help Ada', loaded, { sameSnapshot: refresh.sameSnapshot });
    const unknown = await action('unknown'); assert.equal(unknown.namespaceError, 'RangeError'); assert.equal(unknown.keyError, 'UnknownMessageError');
    await record('unknown-namespace', 'ja Ada', 'ja', 'ja-help Ada', loaded,
      { namespaceError: unknown.namespaceError, keyError: unknown.keyError });
    assert.equal(requestedPairs().includes('ru/help'), false);
    assert.equal(requests.some(request => request.url.includes('@vite') || request.url.endsWith('.json')), false);
    assert.ok(requests.every(request => request.status === 200 || request.url === '/favicon.ico'), 'Unexpected failed asset request');
    observations.push({ variant, hostTimeZone: 'Asia/Seoul', steps, requests, pairChunks, parserImplementationMarker: false,
      userAgent: await evaluate('navigator.userAgent'), constructionWithoutAwait: values.sync,
      chunks: chunks.map(chunk => ({ fileName: chunk.fileName, isEntry: chunk.isEntry, bytes: Buffer.byteLength(chunk.code),
        gzipBytes: gzipSync(chunk.code).length, sha256: createHash('sha256').update(chunk.code).digest('hex'), moduleIds: chunk.moduleIds })) });
    await closeBrowser(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); server = undefined;
  }
  const files = ['benchmarks/thin-layer/lazy-production-browser-probe.mjs', 'benchmarks/thin-layer/lazy-browser-app.jsx',
    'benchmarks/thin-layer/chrome-protocol.mjs', 'benchmarks/thin-layer/lazy-layer.mjs', 'benchmarks/thin-layer/lazy-source-cache.mjs',
    'benchmarks/thin-layer/catalog-layer.mjs', 'benchmarks/thin-layer/ast-format.mjs', 'benchmarks/thin-layer/ast-runtime.mjs',
    'benchmarks/thin-layer/package-lock.json', 'packages/core/dist/i18n.js', 'packages/core/dist/boot.js',
    'packages/vite/dist/static-catalog-source.js', 'packages/vite/dist/lazy-connection.js', 'packages/vite/dist/client.js',
    'packages/vite/dist/index.js', 'package-lock.json'];
  const codeHashes = Object.fromEntries(await Promise.all(files.map(async file => [file,
    createHash('sha256').update(await readFile(path.join(repository, file))).digest('hex')])));
  const packages = {};
  for (const name of ['i18next', 'intl-messageformat'])
    packages[name] = JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, import.meta.url))).version;
  for (const name of ['vite', 'react', 'react-dom'])
    packages[name] = JSON.parse(await readFile(path.join(repository, 'node_modules', name, 'package.json'))).version;
  await writeFile(path.resolve(repository, values.out), JSON.stringify({ format: 'saylo-thin-layer-lazy-production-browser-v1',
    observedAt: new Date().toISOString(), node: process.version, packages, codeHashes, layerFactory: values.sync ? 'createLazyLayerSync' : 'createLazyLayer',
    scope: 'Two actual unminified Vite HTML production builds, static HTTP asset server and independent Chromium profiles. Public virtual:saylo/lazy static source and React subscription UI. Six pairs, empty boot, HTTP requests plus browser Resource Timing entries prove 0 -> 2 -> 3 -> 5 catalog chunks with ru/help never fetched. Six functional steps each; input/DOM/focus/caret/dialog/counter/old snapshot, English fallback plural/date at configured UTC on emulated Seoul browser, no-op refresh and unknown namespace errors. Parser marker absent from all emitted chunks; no module graph native parser audit. No server-side rendering, physical reconnect, changed dev session, pending request races, broad timezone matrix, latency/memory or production size generalization.',
    observations }, null, 2) + '\n');
} finally {
  await closeBrowser();
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(directory)); assert.ok(path.basename(resolved).startsWith('.lazy-production-browser-'));
  await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
