import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { decodeBootSnapshot } from '@0disoft/saylo-core';
import { config } from '../examples/vue-ssr/config.mjs';
import { startServer } from '../examples/vue-ssr/server.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const parent = path.join(repository, '.release');
await mkdir(parent, { recursive: true });
const reportPath = path.join(parent, 'vue-hydration-report.json');
// A failed rerun must not leave a previous successful report looking current.
await rm(reportPath, { force: true });
const root = await mkdtemp(path.join(parent, 'vue-ssr-'));
const app = path.join(root, 'examples/vue-ssr');
const catalogs = path.join(root, 'examples/vue/locales');
const probe = await readFile(new URL('./vue-hydration-browser.mjs', import.meta.url), 'utf8');
let demo, browser, timer, resolveReport, rejectReport;
const interrupt = () => rejectReport?.(new Error('Vue hydration verification interrupted'));
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
async function stopBrowser() {
  if (!browser?.pid || browser.exitCode !== null || browser.signalCode !== null) return;
  const ended = new Promise(resolve => browser.once('exit', resolve));
  if (process.platform === 'win32') {
    try { await promisify(execFile)('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { windowsHide: true }); }
    catch { browser.kill(); }
  } else browser.kill('SIGTERM');
  let killTimer;
  await Promise.race([ended, new Promise(resolve => { killTimer = setTimeout(() => { browser.kill('SIGKILL'); resolve(); }, 3000); })]);
  clearTimeout(killTimer);
}
try {
  await cp(path.join(repository, 'examples/vue-ssr'), app, { recursive: true });
  await cp(path.join(repository, 'examples/vue/locales'), catalogs, { recursive: true });
  const originals = Object.fromEntries(await Promise.all(['ko', 'en'].map(async locale =>
    [locale, await readFile(path.join(catalogs, locale, 'demo.json'), 'utf8')])));
  const plugin = {
    name: 'vue-hydration-verification-only',
    transformIndexHtml: html => html.replace('src="/entry-client.mjs"', 'src="/__vue_ssr_probe.mjs"'),
    configureServer: server => { server.middlewares.use((req, res, next) => {
      if (req.url === '/__vue_ssr_probe.mjs') { res.setHeader('Content-Type', 'text/javascript'); res.end(probe); return; }
      if (!['/__vue_ssr_action', '/__vue_ssr_result'].includes(req.url)) { next(); return; }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
      req.on('error', error => rejectReport?.(error));
      req.on('end', () => { void (async () => {
        const value = JSON.parse(body);
        if (req.url === '/__vue_ssr_result') { resolveReport(value); res.end('ok'); return; }
        assert.ok(['ko', 'en'].includes(value.locale));
        assert.ok(['gap', 'live', 'rich-invalid', 'rich-restore'].includes(value.operation));
        const phase = value.operation === 'gap' ? 'gap' : 'live';
        const content = { ...JSON.parse(originals[value.locale]), heading: `SSR ${phase} ${value.locale}` };
        content.rich = value.operation === 'rich-invalid' ? '<strong>{name}</link>'
          : value.operation === 'rich-restore' ? JSON.parse(originals[value.locale]).rich
            : `SSR ${phase} ${value.locale} <strong>{name}</strong> <link>Order</link>`;
        await writeFile(path.join(catalogs, value.locale, 'demo.json'), JSON.stringify(content));
        res.end('ok');
      })().catch(error => { rejectReport?.(error); res.writeHead(500).end('Fixture action failed'); }); });
    }); },
  };
  demo = await startServer({ port: 0, viteConfig: { ...config, root: app, plugins: [...config.plugins, plugin] } });
  // Concurrent real requests exercise the server HTML and serialized boot together.
  for (const [locale, html] of await Promise.all(['ko', 'en'].map(async locale => {
    const response = await fetch(`${demo.url}?locale=${locale}`);
    assert.equal(response.status, 200);
    return [locale, await response.text()];
  }))) {
    const boot = decodeBootSnapshot(html.match(/<script id="saylo-boot" type="application\/json">(.*?)<\/script>/s)[1]);
    assert.equal(boot.locale, locale);
    assert.equal(boot.timeZone, 'UTC');
    assert.ok(html.includes(JSON.parse(originals[locale]).heading));
    assert.ok(html.includes('<strong>Saylo</strong>'));
    assert.ok(html.includes('<a href="#order-form">'));
    assert.ok(!html.includes('&lt;strong&gt;'), 'Rich SSR markers should become app-owned elements');
  }
  const module = await demo.vite.ssrLoadModule('/entry-server.mjs');
  for (const result of await Promise.all(['ko', 'en'].map(locale => module.render(locale))))
    assert.deepEqual(result.resources, { subscriptions: 0, disposalListeners: 0 });
  console.log('[vue:ssr] concurrent ko/en HTML + boot and zero server subscriptions passed');
  const reports = [];
  for (const locale of ['ko', 'en']) {
    const completed = new Promise((resolve, reject) => { resolveReport = resolve; rejectReport = reject; });
    void completed.catch(() => {});
    const executable = process.env.CHROME_BIN ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
      : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium');
    browser = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', `--user-data-dir=${path.join(root, `browser-${locale}`)}`,
      `${demo.url}?locale=${locale}`], { windowsHide: true, stdio: 'ignore' });
    browser.once('error', rejectReport);
    browser.once('exit', code => rejectReport?.(new Error(`Chromium exited before hydration report (${code})`)));
    timer = setTimeout(() => rejectReport?.(new Error('Vue hydration browser timed out after 45s')), 45000);
    const report = await completed;
    console.log(JSON.stringify(report, null, 2));
    assert.equal(report.ok, true, report.error);
    assert.equal(report.locale, locale);
    assert.deepEqual(report.errors, []); assert.deepEqual(report.warnings, []);
    assert.deepEqual(report.checks, ['server-form-edit', 'frozen-boot-hydration', 'gap-sync', 'locale-switch',
      'live-edit', 'rich-live-edit', 'rich-invalid', 'rich-fallback-input', 'rich-restoration',
      'interactive-form', 'bfcache-retention', 'client-cleanup']);
    reports.push(report);
    clearTimeout(timer); rejectReport = undefined;
    await stopBrowser();
    await writeFile(path.join(catalogs, locale, 'demo.json'), originals[locale]);
  }
  await writeFile(reportPath, JSON.stringify({ serverPassed: true, reports }, null, 2) + '\n');
} finally {
  clearTimeout(timer); rejectReport = undefined;
  await stopBrowser(); await demo?.close();
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  assert.equal(path.dirname(path.resolve(root)), path.resolve(parent));
  assert.ok(path.basename(root).startsWith('vue-ssr-'));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
