import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createServer } from 'vite';

const repository = fileURLToPath(new URL('..', import.meta.url));
await mkdir(path.join(repository, '.release'), { recursive: true });
const axe = await readFile(fileURLToPath(import.meta.resolve('axe-core/axe.min.js')), 'utf8');
const probe = await readFile(new URL('./demo-accessibility-browser.mjs', import.meta.url), 'utf8');
const exec = promisify(execFile);
const reports = [];
const originalCwd = process.cwd();
const requested = process.argv.slice(2);
assert.ok(requested.length === 0 || (requested.length === 2 && requested[0] === '--framework'));
const frameworks = requested.length ? [requested[1]] : ['vanilla', 'react', 'svelte', 'npm', 'sveltekit'];
assert.ok(frameworks.every(name => ['vanilla', 'react', 'svelte', 'npm', 'sveltekit'].includes(name)));
let activeReject;
const interrupt = () => activeReject?.(new Error('Accessibility verification interrupted'));
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
try {
  for (const framework of frameworks) {
    const example = path.join(repository, 'examples', framework);
    const profile = await mkdtemp(path.join(os.tmpdir(), 'saylo-a11y-browser-'));
    let app = example, clone, server, browser, timer;
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
      const kit = framework === 'sveltekit';
      if (kit) {
        // SvelteKit renders app.html itself, so inject into a disposable app copy.
        clone = await mkdtemp(path.join(example, '.a11y-'));
        app = clone;
        for (const file of ['src', 'locales', 'vite.config.mjs', 'tsconfig.json', 'package.json', '.npmrc'])
          await cp(path.join(example, file), path.join(app, file), { recursive: true });
        const config = path.join(app, 'vite.config.mjs');
        await writeFile(config, (await readFile(config, 'utf8')).replace('./node_modules/', '../node_modules/'));
        const html = path.join(app, 'src/app.html');
        await writeFile(html, (await readFile(html, 'utf8')).replace('</head>',
          '<script src="/__saylo_axe.js"></script><script type="module" src="/__saylo_a11y.mjs"></script></head>'));
        process.chdir(app);
      }
      let resolveReport;
      const completed = new Promise((resolve, reject) => { resolveReport = resolve; activeReject = reject; });
      void completed.catch(() => {});
      const plugin = {
        name: 'saylo-accessibility-verification-only',
        ...(!kit ? { transformIndexHtml: () => [
          { tag: 'script', attrs: { src: '/__saylo_axe.js' }, injectTo: 'head-prepend' },
          { tag: 'script', attrs: { type: 'module', src: '/__saylo_a11y.mjs' }, injectTo: 'head' },
        ] } : {}),
        configureServer: instance => { instance.middlewares.use((req, res, next) => {
          if (req.url === '/__saylo_axe.js' || req.url === '/__saylo_a11y.mjs') {
            res.setHeader('Content-Type', 'text/javascript');
            res.end(req.url.endsWith('.js') ? axe : probe); return;
          }
          if (req.url !== '/__saylo_a11y_result') { next(); return; }
          if (req.method !== 'POST') { res.writeHead(405).end(); return; }
          let body = '';
          req.on('data', chunk => { body += chunk; if (body.length > 2 * 1024 * 1024) req.destroy(); });
          req.on('error', activeReject);
          req.on('end', () => {
            try { resolveReport(JSON.parse(body)); res.end('ok'); }
            catch (error) { activeReject?.(error); res.writeHead(400).end(); }
          });
        }); },
      };
      const factory = kit ? (await import(pathToFileURL(path.join(example, 'node_modules/vite/dist/node/index.js')).href)).createServer : createServer;
      server = await factory({ root: app, configFile: path.join(app, 'vite.config.mjs'), plugins: [plugin],
        server: { host: '127.0.0.1', port: 0, strictPort: true, watch: { ignored: ['**/browser-profile/**'] } } });
      await server.listen();
      const executable = process.env.CHROME_BIN ?? (process.platform === 'win32'
        ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
        : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium');
      browser = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--window-size=1200,900', `--user-data-dir=${profile}`, server.resolvedUrls.local[0]],
      { windowsHide: true, stdio: 'ignore' });
      browser.once('error', activeReject);
      browser.once('exit', code => activeReject?.(new Error(`Chromium exited before accessibility result (${code})`)));
      timer = setTimeout(() => activeReject?.(new Error(`${framework} accessibility probe timed out`)), 90000);
      const report = await completed;
      reports.push({ framework, ...report });
      assert.equal(report.ok, true, report.error);
      assert.equal(report.states.length, 4);
      console.log(`[a11y] ${framework}: ${report.states.reduce((sum, state) => sum + state.violations.length, 0)} violations across four locale/dialog states`);
    } finally {
      clearTimeout(timer); activeReject = undefined;
      await stopBrowser(); await server?.close(); process.chdir(originalCwd);
      assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
      assert.ok(path.basename(profile).startsWith('saylo-a11y-browser-'));
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      if (clone) {
        assert.equal(path.dirname(path.resolve(clone)), path.resolve(example));
        assert.ok(path.basename(clone).startsWith('.a11y-'));
        await rm(clone, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  }
} finally {
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  process.chdir(originalCwd);
  await writeFile(path.join(repository, '.release/accessibility-report.json'), JSON.stringify({ reports,
    runComplete: reports.length === frameworks.length && reports.every(report => report.ok && report.states.length === 4),
    scope: 'Rendered demo ko/en pages and open/closed dialogs with visible support panel; automated axe checks only',
    limits: ['No screen-reader speech observation, browser zoom or keyboard-only certification', 'Dev rendering only; installed npm demo uses its existing published dependencies'],
  }, null, 2) + '\n');
}
assert.equal(reports.flatMap(report => report.states.flatMap(state => state.violations)).length, 0,
  'Accessibility violations found; inspect .release/accessibility-report.json');
