import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { build, preview, version as viteVersion } from 'vite';
import demoConfig from '../examples/vanilla/vite.config.mjs';
import { demoKeys } from '../examples/vanilla/selected-keys.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const parent = path.join(repository, '.release');
await mkdir(parent, { recursive: true });
const reportPath = path.join(parent, 'selective-build-report.json');
await rm(reportPath, { force: true });
const root = await mkdtemp(path.join(parent, 'selective-build-'));
const app = path.join(root, 'examples/vanilla');
const probe = await readFile(new URL('./selective-build-browser.mjs', import.meta.url), 'utf8');
const marker = 'SAYLO_UNUSED_FIXTURE_';
const hash = data => createHash('sha256').update(data).digest('hex');
const metrics = [], browserReports = [], inputs = {};
const fullKeyCounts = [];
let server, browser, timer, rejectReport;
const interrupt = () => rejectReport?.(new Error('Selective build verification interrupted'));
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
async function stopBrowser() {
  if (!browser?.pid || browser.exitCode !== null || browser.signalCode !== null) return;
  const ended = new Promise(resolve => browser.once('exit', resolve));
  if (process.platform === 'win32') {
    try { await promisify(execFile)('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { windowsHide: true }); }
    catch { browser.kill(); }
  } else browser.kill('SIGTERM');
  let killTimer;
  await Promise.race([ended, new Promise(resolve => {
    killTimer = setTimeout(() => { browser.kill('SIGKILL'); resolve(); }, 3000);
  })]);
  clearTimeout(killTimer);
}
async function checkBrowser(variant, outDir) {
  let resolveReport;
  const completed = new Promise((resolve, reject) => {
    resolveReport = resolve; rejectReport = reject;
  });
  void completed.catch(() => {});
  const plugin = { name: 'selective-build-preview-probe', configurePreviewServer: instance => {
      instance.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/__selective_probe.mjs') {
          res.setHeader('Content-Type', 'text/javascript'); res.end(probe); return;
        }
        if (url.pathname === '/') {
          void readFile(path.join(app, outDir, 'index.html'), 'utf8').then(html => {
            res.setHeader('Content-Type', 'text/html');
            res.end(html.replace('</head>', '<script type="module" src="/__selective_probe.mjs"></script></head>'));
          }).catch(rejectReport);
          return;
        }
        if (url.pathname !== '/__selective_result') { next(); return; }
        if (req.method !== 'POST') { res.writeHead(405).end(); return; }
        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
        req.on('error', rejectReport);
        req.on('end', () => {
          try { const report = JSON.parse(body); res.end('ok'); resolveReport(report); }
          catch (error) { rejectReport(error); res.writeHead(400).end(); }
        });
      });
  } };
  try {
    server = await preview({ configFile: false, root: app, plugins: [plugin], build: { outDir },
      preview: { host: '127.0.0.1', port: 0, strictPort: true } });
    const executable = process.env.SAYLO_CHROME ?? (process.platform === 'win32'
      ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
      : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium');
    browser = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', `--user-data-dir=${path.join(root, `browser-${variant}`)}`,
      `${server.resolvedUrls.local[0]}?variant=${variant}&keyCounts=${encodeURIComponent(JSON.stringify(variant === 'selected' ? [demoKeys.length, demoKeys.length] : fullKeyCounts))}`], { windowsHide: true, stdio: 'ignore' });
    browser.once('error', error => rejectReport?.(error));
    browser.once('exit', code => rejectReport?.(new Error(`Chromium exited before report (${code})`)));
    timer = setTimeout(() => rejectReport(new Error(`${variant} browser timed out after 45s`)), 45000);
    const report = await completed;
    assert.equal(report.ok, true, report.error);
    assert.equal(report.variant, variant);
    assert.deepEqual(report.errors, []);
    assert.equal(report.checks.length, 11);
    browserReports.push(report);
    console.log(`[selective-build] ${variant}: ${report.checks.length} Chromium checks passed`);
  } finally {
    clearTimeout(timer); rejectReport = undefined;
    await stopBrowser();
    await server?.close(); server = undefined;
  }
}
try {
  await cp(path.join(repository, 'examples/vanilla'), app, { recursive: true,
    filter: source => !['dist', 'dist-selected'].includes(path.basename(source)) });
  await cp(path.join(repository, 'examples/shared'), path.join(root, 'examples/shared'), { recursive: true });
  const html = await readFile(path.join(app, 'index.html'), 'utf8');
  const used = [...html.matchAll(/data-(?:message|placeholder)="([^"]+)"/g)].map(match => match[1]);
  used.push('demo:summary');
  assert.deepEqual([...new Set(used)].sort(), [...demoKeys].sort(), 'Update demoKeys when DOM/runtime keys change');
  for (const locale of ['ko', 'en']) {
    const file = path.join(app, `locales/${locale}/demo.json`);
    const original = await readFile(file);
    inputs[`locales/${locale}/demo.json`] = hash(original);
    const catalog = JSON.parse(original);
    assert.ok(demoKeys.every(key => Object.hasOwn(catalog, key.slice(key.indexOf(':') + 1))));
    fullKeyCounts.push(Object.keys(catalog).length + 100);
    for (let index = 0; index < 100; index++) {
      catalog[`unused${index}`] = `${marker}${locale}_${index} `
        + Array.from({ length: 8 }, (_, word) => hash(`${locale}:${index}:${word}`)).join(' ');
    }
    await writeFile(file, JSON.stringify(catalog));
  }
  for (const name of ['vite.config.mjs', 'selected-keys.mjs', 'main.js', 'index.html'])
    inputs[name] = hash(await readFile(path.join(app, name)));
  for (const name of ['scripts/verify-selective-build.mjs', 'scripts/selective-build-browser.mjs',
    'packages/vite/dist/index.js', 'packages/vite/dist/build-keys.js'])
    inputs[name] = hash(await readFile(path.join(repository, name)));
  for (const variant of ['full', 'selected']) {
    const config = demoConfig({ mode: variant === 'selected' ? 'selected' : 'production' });
    const result = await build({ ...config, configFile: false, root: app, logLevel: 'warn' });
    const chunks = result.output.filter(chunk => chunk.type === 'chunk');
    assert.ok(chunks.length > 0);
    assert.equal(chunks.some(chunk => chunk.code.includes(marker)), variant === 'full');
    metrics.push({ variant, chunks: chunks.length, minifiedJsBytes: chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0),
      perChunkGzipBytes: chunks.reduce((sum, chunk) => sum + gzipSync(chunk.code).byteLength, 0) });
    await checkBrowser(variant, config.build.outDir);
  }
  assert.ok(metrics[1].minifiedJsBytes < metrics[0].minifiedJsBytes);
  assert.ok(metrics[1].perChunkGzipBytes < metrics[0].perChunkGzipBytes);
  const report = { ok: true, observedAt: new Date().toISOString(), node: process.version, vite: viteVersion,
    fixture: { source: 'examples/vanilla', locales: ['ko', 'en'], usedKeysPerLocale: 13,
      addedUnusedKeysPerLocale: 100, synthetic: true, minified: true },
    inputs, metrics, browserReports };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`[selective-build] minified JS ${metrics[0].minifiedJsBytes} -> ${metrics[1].minifiedJsBytes} bytes;`
    + ` per-chunk gzip sum ${metrics[0].perChunkGzipBytes} -> ${metrics[1].perChunkGzipBytes} bytes`);
  console.log(`[selective-build] Report: ${reportPath}`);
} finally {
  clearTimeout(timer); rejectReport = undefined;
  await stopBrowser();
  await server?.close();
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  assert.equal(path.dirname(path.resolve(root)), path.resolve(parent));
  assert.ok(path.basename(root).startsWith('selective-build-'));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
