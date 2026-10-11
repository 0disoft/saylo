import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer } from 'vite';

const framework = process.argv[process.argv.indexOf('--framework') + 1];
assert.ok(['react', 'svelte'].includes(framework), 'Use --framework react or svelte');
const label = framework === 'react' ? 'React' : 'Svelte';
const repository = fileURLToPath(new URL('..', import.meta.url));
const parent = path.join(repository, '.release');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(path.join(parent, `${framework}-recovery-`));
const app = path.join(root, `examples/${framework}`);
const exec = promisify(execFile);
let server, browser, timer, resolveReport, rejectReport;
async function stopBrowser() {
  if (!browser?.pid || browser.exitCode !== null || browser.signalCode !== null) return;
  const ended = new Promise(resolve => browser.once('exit', resolve));
  if (process.platform === 'win32') {
    try { await exec('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { windowsHide: true }); }
    catch { browser.kill(); }
  } else browser.kill('SIGTERM');
  let killTimer;
  await Promise.race([ended, new Promise(resolve => {
    killTimer = setTimeout(() => { browser.kill('SIGKILL'); resolve(); }, 3000);
  })]);
  clearTimeout(killTimer);
}
const interrupt = () => rejectReport?.(new Error(`${label} recovery verification interrupted.`));
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
try {
  // Keep original catalogs, generated declarations and every other live demo untouched.
  const files = framework === 'react'
    ? ['index.html', 'main.tsx', 'demo-messages.ts', 'i18n.ts', 'generated.d.ts', 'SupportPanel.tsx', 'tsconfig.json', 'vite.config.mjs']
    : ['index.html', 'main.ts', 'App.svelte', 'Preview.svelte', 'demo-messages.ts', 'i18n.ts', 'generated.d.ts', 'SupportPanel.svelte', 'tsconfig.json', 'vite.config.mjs'];
  for (const name of files) {
    await mkdir(app, { recursive: true });
    await cp(path.join(repository, `examples/${framework}`, name), path.join(app, name));
  }
  for (const name of ['vanilla/locales', 'vanilla/style.css', 'shared'])
    await cp(path.join(repository, 'examples', name), path.join(root, 'examples', name), { recursive: true });
  if (framework === 'svelte') await cp(path.join(repository, 'examples/svelte/locales'), path.join(app, 'locales'), { recursive: true });
  for (const id of ['core', 'vite', framework]) {
    await mkdir(path.join(root, 'packages', id), { recursive: true });
    await cp(path.join(repository, 'packages', id, 'package.json'), path.join(root, 'packages', id, 'package.json'));
  }
  const catalogs = framework === 'react' ? path.join(root, 'examples/vanilla/locales') : path.join(app, 'locales');
  const koFile = path.join(catalogs, 'ko/demo.json');
  const enFile = path.join(catalogs, 'en/demo.json');
  const ko = await readFile(koFile, 'utf8'); const en = await readFile(enFile, 'utf8');
  const probe = await readFile(new URL('./demo-recovery-browser.mjs', import.meta.url), 'utf8');
  const plugin = {
    name: 'demo-recovery-verification-only',
    transformIndexHtml: () => [{ tag: 'script', attrs: { type: 'module', src: '/__demo_recovery_probe.mjs' }, injectTo: 'head-prepend' }],
    configureServer: instance => { instance.middlewares.use((req, res, next) => {
      if (req.url === '/__demo_recovery_probe.mjs') { res.setHeader('Content-Type', 'text/javascript'); res.end(probe); return; }
      if (req.url !== '/__demo_recovery_action' && req.url !== '/__demo_recovery_result') { next(); return; }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
      req.on('error', rejectReport);
      req.on('end', () => { void (async () => {
        if (req.url === '/__demo_recovery_result') { resolveReport(JSON.parse(body)); res.end('ok'); return; }
        if (body === 'remove-locale') await rm(enFile);
        else if (body === 'restore-locale') await writeFile(enFile, en);
        else if (body === 'empty-base') await writeFile(koFile, '{}');
        else if (body === 'restore-base') await writeFile(koFile, ko);
        else if (body === 'restore-all') { await writeFile(koFile, ko); await writeFile(enFile, en); }
        else if (body === 'remove-namespace') await rm(koFile);
        else throw new Error('Unknown recovery action.');
        res.end('ok');
      })().catch(error => { rejectReport(error); res.writeHead(500).end('failed'); }); });
    }); },
  };
  async function start() {
    server = await createServer({ root: app, plugins: [plugin], server: { host: '127.0.0.1', port: 0, strictPort: true,
      watch: { ignored: ['**/browser-profile/**'] } } });
    await server.listen();
  }
  const executable = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium';
  async function launch(cold = false) {
    const completed = new Promise((resolve, reject) => { resolveReport = resolve; rejectReport = reject; });
    void completed.catch(() => {});
    browser = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', `--user-data-dir=${path.join(root, 'browser-profile')}`,
      server.resolvedUrls.local[0] + (cold ? '?cold=1' : '')], { windowsHide: true, stdio: 'ignore' });
    browser.once('error', rejectReport);
    browser.once('exit', code => rejectReport?.(new Error(`Chromium exited before report (${code}).`)));
    timer = setTimeout(() => rejectReport(new Error(`${label} recovery browser timed out after 45s.`)), 45000);
    const report = await completed;
    console.log(JSON.stringify(report, null, 2));
    assert.equal(report.ok, true, report.error);
    assert.deepEqual(report.errors, [], `${label} logged runtime errors`);
    assert.deepEqual(report.checks, cold ? ['cold-empty-view', 'cold-interaction', 'cold-restoration']
      : ['locale-removal', 'locale-restoration', 'empty-base', 'interactive-fallback', 'base-restoration', 'namespace-removal', 'namespace-restoration']);
    clearTimeout(timer); rejectReport = undefined;
    await stopBrowser();
  }
  await start();
  await launch();
  await server.close(); server = undefined;
  // A genuinely new server/document has no previously translated view to retain.
  await writeFile(koFile, '{}'); await writeFile(enFile, '{}');
  await start();
  await launch(true);
} finally {
  clearTimeout(timer); rejectReport = undefined;
  await stopBrowser();
  await server?.close();
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  assert.equal(path.dirname(path.resolve(root)), path.resolve(parent));
  assert.ok(path.basename(root).startsWith(`${framework}-recovery-`));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
