import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const { values } = parseArgs({ options: { framework: { type: 'string' }, browser: { type: 'string' }, consumer: { type: 'string' } } });
const framework = values.framework;
assert.ok(['react', 'svelte', 'sveltekit'].includes(framework), 'Pass --framework react, svelte or sveltekit.');
const sveltekit = framework === 'sveltekit';
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run through an npm verify:starter script.');
const repository = fileURLToPath(new URL('..', import.meta.url));
const docPath = `docs/getting-started-${framework}.md`;
const doc = await readFile(path.join(repository, docPath), 'utf8');
const files = sveltekit ? ['package.json', 'vite.config.mjs', 'tsconfig.json', 'src/app.d.ts', 'src/app.html',
  'src/hooks.server.ts', 'src/lib/i18n.ts', 'src/lib/client-connection.ts', 'src/lib/Workbench.svelte', 'src/lib/style.css',
  'src/routes/(saylo)/+layout.server.ts', 'src/routes/(saylo)/+layout.svelte', 'src/routes/(saylo)/+page.svelte',
  'src/routes/(saylo)/about/+page.svelte', 'src/routes/plain/+page.svelte', 'locales/ko/demo.json', 'locales/en/demo.json', 'verify-ssr.mjs']
  : ['package.json', 'vite.config.mjs', 'tsconfig.json', 'index.html',
  framework === 'react' ? 'main.tsx' : 'main.ts', ...(framework === 'svelte' ? ['i18n.ts', 'App.svelte'] : []),
  'locales/ko/demo.json', 'locales/en/demo.json'];
const ownsRoot = !values.consumer;
const root = ownsRoot ? await mkdtemp(path.join(os.tmpdir(), `saylo-${framework}-starter-`)) : path.resolve(values.consumer);
assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
assert.ok(path.basename(root).startsWith(`saylo-${framework}-starter-`));
const exec = promisify(execFile);
const cancellation = new AbortController();
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_config_allow_scripts'));
let server, child, timer, rejectBrowser;
const interrupted = () => { cancellation.abort(); rejectBrowser?.(new Error('Starter verification interrupted.')); };
process.once('SIGINT', interrupted);
process.once('SIGTERM', interrupted);
async function npm(args) {
  const result = await exec(process.execPath, [npmCli, ...args], { cwd: root, env, windowsHide: true,
    timeout: 180000, maxBuffer: 4 * 1024 * 1024, signal: cancellation.signal });
  return result.stdout;
}
async function executable() {
  const candidates = values.browser ? [path.resolve(values.browser)] : process.platform === 'win32' ? [
    path.join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
  ] : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch {} }
  throw new Error('Install Chromium or pass --browser <executable>.');
}
async function stopBrowser() {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = new Promise(resolve => child.once('exit', resolve));
  if (process.platform === 'win32') {
    try { await exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); }
    catch { child.kill(); }
  } else child.kill('SIGTERM');
  let killTimer;
  await Promise.race([stopped, new Promise(resolve => {
    killTimer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
  })]);
  clearTimeout(killTimer);
}
try {
  const browser = await executable();
  assert.ok(!root.startsWith(repository), 'Starter must live outside the repository.');
  if (ownsRoot) {
  for (const file of files) {
    const section = doc.split(`### ${file}\n`)[1] ?? doc.split(`### ${file}\r\n`)[1];
    const block = section?.match(/```\w*\r?\n([\s\S]*?)\r?\n```/);
    assert.ok(block, `Missing standalone ${file} code block`);
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), block[1] + '\n');
  }
  console.log(`[starter:${framework}] Installing the document's ${files.length} files outside the workspace.`);
  await npm(['install', '--ignore-scripts', '--no-audit', '--no-fund']);
  }
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const names = ['@0disoft/saylo-core', `@0disoft/saylo-${sveltekit ? 'svelte' : framework}`, '@0disoft/saylo-vite',
    ...(sveltekit ? ['@0disoft/saylo-typegen'] : []), 'vite'];
  for (const name of names) {
    assert.ok(lock.packages[`node_modules/${name}`].resolved?.startsWith('https://registry.npmjs.org/'), `${name} must come from public npm`);
    assert.equal((await lstat(path.join(root, 'node_modules', name))).isSymbolicLink(), false);
  }
  if (ownsRoot) {
    // Vite loads native Rolldown modules. On Windows the consumer cannot be
    // removed while those DLLs are loaded, so wait for this worker to exit first.
    const worker = await exec(process.execPath, [fileURLToPath(import.meta.url), '--framework', framework,
      '--consumer', root, '--browser', browser], { cwd: root, env, windowsHide: true,
      timeout: 180000, maxBuffer: 4 * 1024 * 1024, signal: cancellation.signal });
    console.log(worker.stdout.trim());
  } else if (sveltekit) {
    const { verifySvelteKitStarter } = await import('./sveltekit-starter-runtime.mjs');
    const result = await verifySvelteKitStarter({ root, browser, npm, signal: cancellation.signal });
    console.log(JSON.stringify({ document: docPath, documentSha256: createHash('sha256').update(doc).digest('hex'),
      files: files.length, installed: Object.fromEntries(names.map(name => [name, lock.packages[`node_modules/${name}`].version])),
      ...result }, null, 2));
  } else {
  const require = createRequire(path.join(root, 'package.json'));
  const { createServer, preview } = await import(pathToFileURL(require.resolve('vite')).href);
  const probe = await readFile(new URL('./starter-browser.mjs', import.meta.url), 'utf8');
  const enFile = path.join(root, 'locales/en/demo.json');
  const en = JSON.parse(await readFile(enFile, 'utf8'));
  const ja = { ...en, heading: `Saylo ${framework === 'react' ? 'React' : 'Svelte'} 日本語`, greeting: 'こんにちは {name}' };
  const edited = { ...en, greeting: 'Updated {name}' };
  let resolveBrowser;
  const middleware = (req, res, next) => {
    if (req.url === '/__saylo_starter_probe.mjs') {
      res.setHeader('Content-Type', 'text/javascript'); res.end(probe); return;
    }
    if (req.url !== '/__saylo_starter_action' && req.url !== '/__saylo_starter_result') { next(); return; }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
    req.on('error', error => rejectBrowser?.(error));
    req.on('end', () => { void (async () => {
      if (req.url === '/__saylo_starter_result') { resolveBrowser(JSON.parse(body)); res.end('ok'); return; }
      // Fixed test mutations only; requests can never choose a filesystem path.
      if (body === 'edit' || body === 'restore') await writeFile(enFile, JSON.stringify(edited));
      else if (body === 'invalid') await writeFile(enFile, JSON.stringify({ ...edited, greeting: '{name' }));
      else if (body === 'add-locale') {
        await mkdir(path.join(root, 'locales/ja'), { recursive: true });
        await writeFile(path.join(root, 'locales/ja/demo.json'), JSON.stringify(ja));
      } else throw new Error('Unknown starter action.');
      res.end('ok');
    })().catch(error => { rejectBrowser?.(error); res.writeHead(500).end('failed'); }); });
  };
  const plugin = {
    name: 'saylo-starter-verification-only',
    configureServer: instance => { instance.middlewares.use(middleware); },
    configurePreviewServer: instance => { instance.middlewares.use(middleware); },
    transformIndexHtml: () => [{ tag: 'script', attrs: { type: 'module', src: '/__saylo_starter_probe.mjs' }, injectTo: 'head-prepend' }],
  };
  async function launch(origin, mode) {
    const result = new Promise((resolve, reject) => { resolveBrowser = resolve; rejectBrowser = reject; });
    void result.catch(() => {});
    child = spawn(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', `--user-data-dir=${path.join(root, `browser-${mode}`)}`,
      `${origin}?starter-check=${framework}&mode=${mode}`], { windowsHide: true, stdio: 'ignore' });
    child.once('error', error => rejectBrowser?.(error));
    child.once('exit', code => rejectBrowser?.(new Error(`Chromium exited before its report (${code}).`)));
    timer = setTimeout(() => rejectBrowser?.(new Error('Starter browser timed out after 45s.')), 45000);
    const report = await result;
    assert.equal(report.ok, true, report.error);
    assert.deepEqual(report.errors, [], 'Browser runtime errors');
    assert.deepEqual(report.checks, mode === 'dev'
      ? ['first-render', 'locale-switch', 'live-edit', 'new-locale', 'invalid-last-good', 'repair', 'input-dialog-focus-preserved']
      : ['first-render', 'locale-switch', 'input-dialog-focus-preserved']);
    clearTimeout(timer);
    rejectBrowser = undefined;
    await stopBrowser();
    console.log(`[starter:${framework}] ${mode} Chromium: ${report.checks.join(', ')}`);
    return report;
  }
  server = await createServer({ root, plugins: [plugin], server: { host: '127.0.0.1', port: 0, strictPort: true,
    watch: { ignored: ['**/browser-dev/**', '**/browser-production/**'] } } });
  await server.listen();
  const dev = await launch(server.resolvedUrls.local[0], 'dev');
  await server.close();
  server = undefined;
  console.log((await npm(['run', 'build'])).trim());
  const builtHtml = path.join(root, 'dist/index.html');
  await writeFile(builtHtml, (await readFile(builtHtml, 'utf8')).replace('</head>',
    '<script type="module" src="/__saylo_starter_probe.mjs"></script></head>'));
  // Preview middleware serves only the test probe; the production app uses its real built files.
  server = await preview({ root, plugins: [plugin], preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  const production = await launch(server.resolvedUrls.local[0], 'production');
  console.log(JSON.stringify({ document: docPath, documentSha256: createHash('sha256').update(doc).digest('hex'),
    files: files.length, installed: Object.fromEntries(names.map(name => [name, lock.packages[`node_modules/${name}`].version])),
    dev, production, limits: ['No SSR hydration or cross-browser matrix in this starter check.'] }, null, 2));
  }
} catch (error) {
  if (error.stdout) console.error(error.stdout.trim());
  console.error((error.stderr || error.message || String(error)).trim());
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  rejectBrowser = undefined;
  await stopBrowser();
  if (server?.close) await server.close();
  else if (server?.httpServer) {
    server.httpServer.closeAllConnections();
    await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
  }
  process.removeListener('SIGINT', interrupted);
  process.removeListener('SIGTERM', interrupted);
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith(`saylo-${framework}-starter-`));
  if (ownsRoot) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
