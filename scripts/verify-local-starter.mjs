import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { prepareLocalStarter } from './prepare-local-starter.mjs';

const { values } = parseArgs({ options: { consumer: { type: 'string' }, framework: { type: 'string' } } });
const framework = values.framework;
assert.ok(['react'].includes(framework), 'Choose a supported local starter framework.');
const repository = fileURLToPath(new URL('..', import.meta.url));
const ownsRoot = !values.consumer;
const reportPath = path.join(repository, `.release/${framework}-starter-report.json`);
if (ownsRoot) await rm(reportPath, { force: true });
const root = ownsRoot ? await mkdtemp(path.join(os.tmpdir(), `saylo-${framework}-starter-`)) : path.resolve(values.consumer);
assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
assert.ok(path.basename(root).startsWith(`saylo-${framework}-starter-`));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run with npm run verify:starter:<framework>:local.');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['npm_config_allow_scripts', 'node_path'].includes(key.toLowerCase())));
const exec = promisify(execFile);
const cancellation = new AbortController();
let server, browser, timer, resolveReport, rejectReport;
const interrupt = () => { cancellation.abort(); rejectReport?.(new Error('Local starter verification interrupted')); };
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
const npm = async args => (await exec(process.execPath, [npmCli, ...args], { cwd: root, env, windowsHide: true,
  timeout: 180000, maxBuffer: 4 * 1024 * 1024, signal: cancellation.signal })).stdout;
async function stopBrowser() {
  if (!browser?.pid || browser.exitCode !== null || browser.signalCode !== null) return;
  const ended = new Promise(resolve => browser.once('exit', resolve));
  if (process.platform === 'win32') {
    try { await exec('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { windowsHide: true }); }
    catch { browser.kill(); }
  } else browser.kill('SIGTERM');
  let killTimer;
  await Promise.race([ended, new Promise(resolve => { killTimer = setTimeout(() => { browser.kill('SIGKILL'); resolve(); }, 3000); })]);
  clearTimeout(killTimer);
}
try {
  if (ownsRoot) {
    const manifest = await prepareLocalStarter(framework, root);
    for (const pack of manifest.packages) {
      const bytes = await readFile(path.join(root, pack.file));
      assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, pack.integrity);
    }
    // Refusing overwrite must leave the exported package untouched.
    await assert.rejects(prepareLocalStarter(framework, root), /Destination must be empty/);
    await assert.rejects(prepareLocalStarter(framework, path.join(repository, '.release/local-starter')), /outside the Saylo/);
    console.log(`[local-starter:${framework}] Installing exported tarballs outside the workspace.`);
    console.log((await npm(['install', '--workspaces=false', '--ignore-scripts', '--no-audit', '--no-fund'])).trim());
    const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
    for (const pack of manifest.packages) {
      const installed = lock.packages[`node_modules/${pack.name}`];
      assert.equal(installed.version, pack.version);
      assert.equal(installed.integrity, pack.integrity);
      assert.ok(installed.resolved.startsWith('file:vendor/'), `${pack.name} must come from its exported tarball`);
      assert.equal((await lstat(path.join(root, 'node_modules', pack.name))).isSymbolicLink(), false);
    }
    // Vite's native Windows modules must unload before deleting the consumer.
    const worker = await exec(process.execPath, [fileURLToPath(import.meta.url), '--framework', framework, '--consumer', root],
      { cwd: root, env, windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024, signal: cancellation.signal });
    console.log(worker.stdout.trim());
    await mkdir(path.join(repository, '.release'), { recursive: true });
    const result = JSON.parse(await readFile(path.join(root, 'verification.json'), 'utf8'));
    await writeFile(reportPath, JSON.stringify({ ...result, packages: manifest.packages }, null, 2) + '\n');
  } else {
    const require = createRequire(path.join(root, 'package.json'));
    const vite = await import(pathToFileURL(require.resolve('vite')).href);
    const probe = await readFile(new URL('./local-starter-browser.mjs', import.meta.url), 'utf8');
    const enFile = path.join(root, 'locales/en/demo.json'), koFile = path.join(root, 'locales/ko/demo.json');
    const en = JSON.parse(await readFile(enFile, 'utf8')), ko = JSON.parse(await readFile(koFile, 'utf8'));
    const edited = { ...en, greeting: 'Updated {name}', rich: 'RICH_EDIT <strong>{name}</strong> <link>Form</link>' };
    const plugin = {
      name: 'local-starter-verification-only',
      transformIndexHtml: () => [{ tag: 'script', attrs: { type: 'module', src: '/__local_starter_probe.mjs' }, injectTo: 'head-prepend' }],
      configureServer: instance => { instance.middlewares.use(middleware); },
      configurePreviewServer: instance => { instance.middlewares.use(middleware); },
    };
    function middleware(req, res, next) {
      if (req.url === '/__local_starter_probe.mjs') { res.setHeader('Content-Type', 'text/javascript'); res.end(probe); return; }
      if (!['/__local_starter_action', '/__local_starter_result'].includes(req.url)) { next(); return; }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
      req.on('error', error => rejectReport?.(error));
      req.on('end', () => { void (async () => {
        if (req.url === '/__local_starter_result') { resolveReport(JSON.parse(body)); res.end('ok'); return; }
        if (body === 'edit' || body === 'restore') await writeFile(enFile, JSON.stringify(edited));
        else if (body === 'rich-invalid') await writeFile(enFile, JSON.stringify({ ...edited, rich: '<strong>{name}</link>' }));
        else if (body === 'invalid') await writeFile(enFile, '{invalid');
        else if (body === 'add-locale') {
          await mkdir(path.join(root, 'locales/ja'), { recursive: true });
          await writeFile(path.join(root, 'locales/ja/demo.json'), JSON.stringify({ ...en, greeting: 'こんにちは {name}' }));
        } else if (body === 'add-key') await writeFile(koFile, JSON.stringify({ ...ko, extra: '추가 키' }));
        else throw new Error('Unknown starter action');
        res.end('ok');
      })().catch(error => { rejectReport?.(error); res.writeHead(500).end('Fixture action failed'); }); });
    }
    const executable = process.env.CHROME_BIN ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
      : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium');
    async function launch(mode) {
      const completed = new Promise((resolve, reject) => { resolveReport = resolve; rejectReport = reject; });
      void completed.catch(() => {});
      browser = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', `--user-data-dir=${path.join(root, `browser-${mode}`)}`,
        `${server.resolvedUrls.local[0]}?mode=${mode}`], { windowsHide: true, stdio: 'ignore' });
      browser.once('error', rejectReport);
      browser.once('exit', code => rejectReport?.(new Error(`Chromium exited before starter report (${code})`)));
      timer = setTimeout(() => rejectReport?.(new Error('Local starter browser timed out after 45s')), 45000);
      const report = await completed;
      assert.equal(report.ok, true, report.error); assert.deepEqual(report.errors, []);
      assert.deepEqual(report.checks, ['first-render', 'rich-render', 'selector-locale', 'locale-switch', ...(mode === 'dev'
        ? ['live-edit', 'rich-live-edit', 'rich-invalid', 'rich-fallback-input', 'rich-restoration',
          'invalid-last-good', 'repair', 'new-locale', 'schema-edit'] : []), 'form-dialog-preserved', 'teardown']);
      clearTimeout(timer); rejectReport = undefined; await stopBrowser();
      console.log(`[local-starter:${framework}] ${mode}: ${report.checks.join(', ')}`);
      return report;
    }
    console.log((await npm(['run', 'typegen'])).trim());
    assert.ok((await readFile(path.join(root, 'generated.d.ts'), 'utf8')).includes('demo:greeting'));
    assert.ok((await readFile(path.join(root, 'generated.d.ts'), 'utf8')).includes('"demo:rich":'));
    server = await vite.createServer({ root, plugins: [plugin], server: { host: '127.0.0.1', port: 0, strictPort: true,
      watch: { ignored: ['**/browser-dev/**', '**/browser-production/**'] } } });
    await server.listen(); const dev = await launch('dev');
    const until = Date.now() + 10000;
    while (!(await readFile(path.join(root, 'generated.d.ts'), 'utf8')).includes('demo:extra')) {
      assert.ok(Date.now() < until, 'Live schema edit did not refresh generated declarations');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await server.close(); server = undefined;
    console.log(`[local-starter:${framework}] Checking types and building production output.`);
    console.log((await npm(['run', 'build'])).trim());
    const built = path.join(root, 'dist/index.html');
    await writeFile(built, (await readFile(built, 'utf8')).replace('</head>', '<script type="module" src="/__local_starter_probe.mjs"></script></head>'));
    server = await vite.preview({ root, plugins: [plugin], preview: { host: '127.0.0.1', port: 0, strictPort: true } });
    const production = await launch('production');
    await writeFile(path.join(root, 'verification.json'), JSON.stringify({ independent: true, liveTypegen: true,
      templateTypecheck: true, productionBuild: true, installedVite: vite.version, dev, production }, null, 2) + '\n');
  }
} finally {
  clearTimeout(timer); rejectReport = undefined; await stopBrowser();
  if (server?.close) await server.close();
  else if (server) await new Promise(resolve => server.httpServer.close(resolve));
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  if (ownsRoot) {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith(`saylo-${framework}-starter-`));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
