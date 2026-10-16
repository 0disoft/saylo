import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import path from 'node:path';
import { createServer } from '../examples/sveltekit/node_modules/vite/dist/node/index.js';
import { JSDOM } from 'jsdom';

const example = fileURLToPath(new URL('../examples/sveltekit/', import.meta.url));
const root = await mkdtemp(path.join(example, '.recovery-'));
const originalCwd = process.cwd();
const request = globalThis.fetch.bind(globalThis);
const exec = promisify(execFile);
let server, browser, timer, resolveReport, rejectReport;
const interrupt = () => rejectReport?.(new Error('SvelteKit recovery verification interrupted'));
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
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
try {
  for (const name of ['src', 'locales', 'vite.config.mjs', 'tsconfig.json', 'package.json', '.npmrc'])
    await cp(path.join(example, name), path.join(root, name), { recursive: true });
  const configFile = path.join(root, 'vite.config.mjs');
  await writeFile(configFile, (await readFile(configFile, 'utf8')).replace('./node_modules/', '../node_modules/'));
  const koFile = path.join(root, 'locales/ko/demo.json');
  const enFile = path.join(root, 'locales/en/demo.json');
  const ko = await readFile(koFile, 'utf8'), en = await readFile(enFile, 'utf8');
  const probe = await readFile(new URL('./sveltekit-recovery-browser.mjs', import.meta.url), 'utf8');
  const htmlFile = path.join(root, 'src/app.html');
  const capture = `<script>globalThis.__sayloRecoveryErrors=[];
    addEventListener('error',e=>__sayloRecoveryErrors.push(e.message||'Resource load failed'));
    addEventListener('unhandledrejection',e=>__sayloRecoveryErrors.push(String(e.reason)));
    for(const level of ['error','warn']){const original=console[level];console[level]=(...args)=>{__sayloRecoveryErrors.push(args.map(String).join(' '));original.apply(console,args);};}
    </script><script type="module" src="/__recovery_probe.mjs"></script>`;
  await writeFile(htmlFile, (await readFile(htmlFile, 'utf8')).replace('</head>', capture + '</head>'));
  const plugin = { name: 'sveltekit-recovery-verification-only', configureServer: instance => {
    instance.middlewares.use((req, res, next) => {
      if (req.url === '/__recovery_probe.mjs') { res.setHeader('Content-Type', 'text/javascript'); res.end(probe); return; }
      if (req.url !== '/__recovery_action' && req.url !== '/__recovery_result') { next(); return; }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
      req.on('error', error => rejectReport?.(error));
      req.on('end', () => { void (async () => {
        if (req.url === '/__recovery_result') { resolveReport(JSON.parse(body)); res.end('ok'); return; }
        if (body === 'remove-locale') await rm(enFile);
        else if (body === 'restore-locale') await writeFile(enFile, en);
        else if (body === 'empty-base') await writeFile(koFile, '{}');
        else if (body === 'rich-edit' || body === 'rich-invalid') await writeFile(koFile, JSON.stringify({ ...JSON.parse(ko),
          rich: body === 'rich-edit' ? 'RICH_EDIT <strong>{name}</strong> <link>Order</link>' : '<strong>{name}</link>' }));
        else if (body === 'restore-base') await writeFile(koFile, ko);
        else if (body === 'restore-all') { await writeFile(koFile, ko); await writeFile(enFile, en); }
        else if (body === 'remove-namespace') await rm(koFile);
        else throw new Error('Unknown recovery action');
        res.end('ok');
      })().catch(error => { rejectReport?.(error); res.writeHead(500).end('failed'); }); });
    });
  } };
  process.chdir(root);
  const start = async () => {
    server = await createServer({ root, plugins: [plugin], logLevel: 'error',
      server: { host: '127.0.0.1', port: 0, strictPort: true, watch: { ignored: ['**/browser-profile/**'] } } });
    await server.listen();
    return `http://127.0.0.1:${server.httpServer.address().port}`;
  };
  let origin = await start();
  async function verifySSR(empty) {
    const paths = ['/?locale=ko', '/?locale=en', '/about?locale=ko', '/about?locale=en'];
    const results = await Promise.all(paths.map(async page => {
      const response = await request(origin + page), html = await response.text();
      assert.equal(response.status, 200, `${page}: SSR failed`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.ok(html.includes(`<html lang="${page.endsWith('en') ? 'en' : 'ko'}">`));
      assert.ok(html.includes(empty ? '번역을 준비하세요.' : (page.includes('/about')
        ? (page.endsWith('en') ? 'New page. Same input.' : '페이지를 이동해도, 입력은 그대로')
        : (page.endsWith('en') ? 'New words. Same input.' : '번역을 바꿔도, 입력은 그대로'))));
      if (empty) assert.ok(html.includes('demo:home'), 'Missing SSR correction hint');
      const dom = new JSDOM(html);
      try {
        const language = selector => dom.window.document.querySelector(selector)?.closest('[lang]')?.lang;
        const renderedLocale = empty ? 'ko' : (page.endsWith('en') ? 'en' : 'ko');
        for (const selector of ['h1', '#name', '#dialog-title', '#home-link', '#about-link']) {
          assert.equal(language(selector), renderedLocale, `${page}: wrong rendered language for ${selector}`);
        }
        for (const selector of ['header', '#locale', 'nav', '#leave-link', '#status', '#dialog-status', '#support-status']) {
          assert.equal(language(selector), 'ko', `${page}: wrong fixed language for ${selector}`);
        }
        if (!empty) {
          assert.equal(dom.window.document.querySelector('#rich-preview strong')?.textContent, 'Saylo');
          assert.equal(dom.window.document.querySelector('#rich-preview a')?.getAttribute('href'), '#order-form');
        }
      } finally { dom.window.close(); }
      return { page, status: response.status, setupHint: empty };
    }));
    console.log(JSON.stringify({ ssr: empty ? 'empty' : 'normal', results }));
  }
  const executable = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium';
  async function launch(cold = false) {
    const completed = new Promise((resolve, reject) => { resolveReport = resolve; rejectReport = reject; });
    void completed.catch(() => {});
    browser = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', `--user-data-dir=${path.join(root, 'browser-profile')}`,
      `${origin}/?locale=ko${cold ? '&cold=1' : ''}`], { windowsHide: true, stdio: 'ignore' });
    browser.once('error', rejectReport);
    browser.once('exit', code => rejectReport?.(new Error(`Chromium exited before report (${code})`)));
    timer = setTimeout(() => rejectReport(new Error('SvelteKit recovery browser timed out after 60s')), 60000);
    const report = await completed;
    console.log(JSON.stringify(report, null, 2));
    assert.equal(report.ok, true, report.error);
    assert.deepEqual(report.errors, [], 'Browser runtime/hydration errors');
    assert.deepEqual(report.checks, cold ? ['cold-empty-hydration', 'cold-interaction', 'cold-restoration']
      : ['rich-live-edit', 'rich-invalid', 'rich-fallback-input', 'rich-restoration',
        'locale-removal', 'locale-restoration', 'empty-base', 'navigation-during-error', 'base-restoration', 'namespace-removal', 'namespace-restoration']);
    clearTimeout(timer); rejectReport = undefined;
    await stopBrowser();
  }
  await verifySSR(false);
  await launch();
  await server.close(); server = undefined;
  await writeFile(koFile, '{}'); await writeFile(enFile, '{}');
  origin = await start();
  await verifySSR(true);
  await launch(true);
  await verifySSR(false);
} finally {
  clearTimeout(timer); rejectReport = undefined;
  await stopBrowser();
  await server?.close();
  process.chdir(originalCwd);
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  assert.equal(path.dirname(path.resolve(root)), path.resolve(example));
  assert.ok(path.basename(root).startsWith('.recovery-'));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
