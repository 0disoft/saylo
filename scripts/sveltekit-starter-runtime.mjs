import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer as reservePort } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

// Runs only in the temporary consumer worker; the parent owns installation and removal.
export async function verifySvelteKitStarter({ root, browser, npm, signal }) {
  const exec = promisify(execFile);
  const requestFetch = globalThis.fetch.bind(globalThis);
  const require = createRequire(path.join(root, 'package.json'));
  const { createServer, preview } = await import(pathToFileURL(require.resolve('vite')).href);
  const original = await readFile(path.join(root, 'locales/en/demo.json'), 'utf8');
  const en = JSON.parse(original);
  const enFile = path.join(root, 'locales/en/demo.json');
  const jaDirectory = path.join(root, 'locales/ja');
  const probe = await readFile(new URL('./sveltekit-starter-browser.mjs', import.meta.url), 'utf8');
  let server, child, adapterChild, timer, settle, reject;
  async function stopOwned(process) {
    if (!process?.pid || process.exitCode !== null || process.signalCode !== null) return;
    const ended = new Promise(resolve => process.once('exit', resolve));
    if (globalThis.process.platform === 'win32') {
      try { await exec('taskkill', ['/PID', String(process.pid), '/T', '/F'], { windowsHide: true }); }
      catch { process.kill(); }
    } else process.kill('SIGTERM');
    let killTimer;
    await Promise.race([ended, new Promise(resolve => {
      killTimer = setTimeout(() => { process.kill('SIGKILL'); resolve(); }, 3000);
    })]);
    clearTimeout(killTimer);
  }
  const interrupt = () => reject?.(new Error('SvelteKit starter verification interrupted.'));
  signal.addEventListener('abort', interrupt);
  const middleware = (req, res, next) => {
    if (req.url === '/__saylo_starter_probe.mjs') {
      res.setHeader('Content-Type', 'text/javascript'); res.end(probe); return;
    }
    if (req.url !== '/__saylo_starter_result' && req.url !== '/__saylo_starter_action') { next(); return; }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
    req.on('error', error => reject?.(error));
    req.on('end', () => { void (async () => {
      if (req.url === '/__saylo_starter_result') { settle(JSON.parse(body)); res.end('ok'); return; }
      // Only fixed mutations inside the owned temporary consumer are accepted.
      if (body === 'edit') await writeFile(enFile, JSON.stringify({ ...en, heading: 'Updated words. Same input.' }));
      else if (body === 'invalid') await writeFile(enFile, JSON.stringify({ ...en, heading: '{name' }));
      else if (body === 'restore') await writeFile(enFile, original);
      else if (body === 'add-locale') {
        await mkdir(jaDirectory, { recursive: true });
        await writeFile(path.join(jaDirectory, 'demo.json'), JSON.stringify({ ...en, heading: 'Saylo 日本語' }));
      } else throw new Error('Unknown SvelteKit starter action.');
      res.end('ok');
    })().catch(error => { reject?.(error); res.writeHead(500).end('failed'); }); });
  };
  const plugin = {
    name: 'saylo-sveltekit-starter-verification-only',
    configureServer: instance => { instance.middlewares.use(middleware); },
    configurePreviewServer: instance => { instance.middlewares.use(middleware); },
  };
  async function launch(origin, mode) {
    const completed = new Promise((resolve, failed) => { settle = resolve; reject = failed; });
    void completed.catch(() => {});
    child = spawn(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', `--user-data-dir=${path.join(root, `browser-${mode}`)}`,
      `${origin}?locale=ko&starter-check=sveltekit&mode=${mode}`], { windowsHide: true, stdio: 'ignore' });
    child.once('error', error => reject?.(error));
    child.once('exit', code => reject?.(new Error(`Chromium exited before its report (${code}).`)));
    timer = setTimeout(() => reject?.(new Error('SvelteKit starter browser timed out after 60s.')), 60000);
    const report = await completed;
    assert.equal(report.ok, true, report.error);
    assert.deepEqual(report.errors, [], 'Browser runtime errors or hydration warnings');
    assert.deepEqual(report.checks, ['hydration', 'locale-url', ...(mode === 'dev'
      ? ['live-edit', 'new-locale', 'invalid-last-good', 'repair', 'focus-preserved'] : []), 'shared-layout', 'exit-reentry']);
    clearTimeout(timer);
    reject = undefined;
    await stopOwned(child);
    console.log(`[starter:sveltekit] ${mode} Chromium: ${report.checks.join(', ')}`);
    return report;
  }
  try {
    console.log((await npm(['run', 'check'])).trim());
    // Exercise the guide's own standalone command before adding the browser probe.
    console.log((await npm(['run', 'verify:ssr'])).trim());
    const html = path.join(root, 'src/app.html');
    await writeFile(html, (await readFile(html, 'utf8')).replace('</head>',
      '<script type="module" src="/__saylo_starter_probe.mjs"></script></head>'));
    server = await createServer({ root, plugins: [plugin], server: { host: '127.0.0.1', port: 0, strictPort: true,
      watch: { ignored: ['**/browser-dev/**', '**/browser-production/**'] } } });
    await server.listen();
    const dev = await launch(new URL(server.resolvedUrls.local[0]).origin, 'dev');
    await server.close();
    server = undefined;
    // Restore the documented inputs before the strict production build and SSR assertions.
    await writeFile(enFile, original);
    assert.equal(path.dirname(jaDirectory), path.join(root, 'locales'));
    await rm(jaDirectory, { recursive: true, force: true });
    console.log((await npm(['run', 'build'])).trim());
    server = await preview({ root, plugins: [plugin], preview: { host: '127.0.0.1', port: 0, strictPort: true } });
    const productionOrigin = new URL(server.resolvedUrls.local[0]).origin;
    console.log((await npm(['run', 'verify:ssr', '--', productionOrigin + '/'])).trim());
    const production = await launch(productionOrigin, 'production');
    await server.close();
    server = undefined;
    const reserved = reservePort();
    await new Promise((resolve, failed) => { reserved.once('error', failed); reserved.listen(0, '127.0.0.1', resolve); });
    const port = reserved.address().port;
    await new Promise(resolve => reserved.close(resolve));
    const nodeOrigin = `http://127.0.0.1:${port}`;
    adapterChild = spawn(process.execPath, [path.join(root, 'build/index.js')], { cwd: root, windowsHide: true,
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ORIGIN: nodeOrigin }, stdio: 'ignore' });
    let startupError;
    adapterChild.once('error', error => { startupError = error; });
    const deadline = Date.now() + 10000;
    while (true) {
      if (startupError) throw startupError;
      if (adapterChild.exitCode !== null || signal.aborted) throw new Error('Node adapter stopped before serving the guide.');
      try { if ((await requestFetch(nodeOrigin, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* Wait for startup. */ }
      if (Date.now() > deadline) throw new Error('Node adapter startup timed out.');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    console.log((await npm(['run', 'verify:ssr', '--', nodeOrigin])).trim());
    console.log('[starter:sveltekit] Direct node build/index.js with HOST, PORT and ORIGIN: production HTTP SSR passed.');
    return { dev, production,
      ssr: ['guide standalone dev command', 'concurrent ko/en, canonical and fallback, no-store and boot identity', 'production preview HTTP with trailing slash origin', 'direct adapter-node server HTTP'],
      limits: ['No browser matrix, hosting deployment, or schema-breaking edit guarantee.'] };
  } finally {
    clearTimeout(timer);
    reject = undefined;
    await stopOwned(child);
    await stopOwned(adapterChild);
    if (server) await server.close();
    signal.removeEventListener('abort', interrupt);
  }
}
