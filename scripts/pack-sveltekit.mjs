import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { packageIds, repository } from './release-check.mjs';
import { approvedRegistryRelease } from './registry-release.mjs';
import { registryConsumerContract } from './registry-consumer-contract.mjs';

const { values } = parseArgs({ options: { browser: { type: 'string' }, 'registry-version': { type: 'string' },
  'consumer-fixture': { type: 'string' } } });
const approved = values['registry-version'] ? await approvedRegistryRelease(values['registry-version']) : undefined;
assert.ok(!approved || !values['consumer-fixture'], 'Registry contracts cannot be overridden.');
assert.ok(!values['consumer-fixture'] || ['legacy', 'support'].includes(values['consumer-fixture']), 'Unknown consumer fixture.');
const contract = approved ? registryConsumerContract(values['registry-version']) : undefined;
const supportChecks = contract ? contract.support : values['consumer-fixture'] !== 'legacy';
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run with npm run verify:pack:sveltekit.');
const exec = promisify(execFile);
const cancellation = new AbortController();
const env = { ...Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => key.toLowerCase() !== 'npm_config_allow_scripts')), NODE_PATH: '' };
function inside(directory, target) {
  const relative = path.relative(directory, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
async function npm(args, cwd) {
  try {
    return (await exec(process.execPath, [npmCli, ...args], {
      cwd, env, windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 300000, signal: cancellation.signal,
    })).stdout;
  } catch (error) {
    throw new Error(`npm ${args.join(' ')} failed\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, { cause: error });
  }
}
async function browserExecutable() {
  if (values.browser) { await access(values.browser); return path.resolve(values.browser); }
  const candidates = process.platform === 'win32' ? [
    path.join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
  ] : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch {} }
  throw new Error('No installed Chromium browser found; pass --browser <executable>.');
}
async function stopBrowser(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  if (process.platform === 'win32') {
    try { await exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); }
    catch { child.kill(); }
  } else child.kill('SIGTERM');
  let timer;
  await Promise.race([exited, new Promise(resolve => {
    timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
  })]);
  clearTimeout(timer);
}

// Fail before an expensive install if this machine has no browser.
const executable = await browserExecutable();
const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-pack-sveltekit-'));
const app = path.join(root, 'app');
const packs = path.join(root, 'packs');
let server, browser, timer, rejectBrowser;
const interrupted = () => {
  cancellation.abort();
  rejectBrowser?.(new Error('SvelteKit pack verification interrupted.'));
};
process.once('SIGINT', interrupted);
process.once('SIGTERM', interrupted);
try {
  assert.ok(!inside(repository, root), 'Consumer must live outside the repository.');
  await mkdir(packs);
  const source = approved ? ['--workspaces=false', ...approved.map(pack => `${pack.name}@${pack.version}`),
    '--registry', 'https://registry.npmjs.org/'] : packageIds.map(id => `--workspace=@0disoft/saylo-${id}`);
  const metadata = JSON.parse(await npm(['pack', ...source, '--ignore-scripts', '--json', '--pack-destination', packs], repository));
  const packed = Array.isArray(metadata) ? metadata : Object.values(metadata);
  assert.deepEqual(packed.map(pack => pack.name).sort(), packageIds.map(id => `@0disoft/saylo-${id}`).sort());
  if (approved) for (const pack of packed) {
    const expected = approved.find(entry => entry.name === pack.name);
    assert.equal(pack.version, expected.version);
    const integrity = `sha512-${createHash('sha512').update(await readFile(path.join(packs, pack.filename))).digest('base64')}`;
    assert.equal(integrity, expected.integrity, `${pack.name}: registry artifact differs from approved release`);
  }
  // Copy only app inputs. Never carry node_modules, build outputs or the file:-based lockfile.
  await mkdir(app);
  // Registry smoke exercises the published contract. The evolving local demo
  // intentionally imports APIs that may not exist in any approved release yet.
  const fixture = contract?.sveltekitFixture ?? (values['consumer-fixture']
    ? (supportChecks ? 'sveltekit-registry-alpha5' : 'sveltekit-registry') : undefined);
  const example = path.join(repository, fixture ? `scripts/pack-fixtures/${fixture}` : 'examples/sveltekit');
  console.log(`[pack:sveltekit] Consumer inputs: ${path.relative(repository, example)}`);
  for (const name of ['src', 'locales', 'vite.config.mjs', 'tsconfig.json', 'verify-ssr.mjs', '.npmrc'])
    await cp(path.join(example, name), path.join(app, name), { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(example, 'package.json'), 'utf8'));
  manifest.name = 'saylo-packed-sveltekit';
  for (const pack of packed) {
    const section = manifest.dependencies[pack.name] ? 'dependencies' : 'devDependencies';
    manifest[section][pack.name] = `file:../packs/${pack.filename}`;
  }
  await writeFile(path.join(app, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[pack:sveltekit] Installing five ${approved ? 'approved registry' : 'local'} tarballs and declared tool/peer major ranges outside the workspace.`);
  await npm(['install', '--workspaces=false', '--ignore-scripts', '--no-audit', '--no-fund'], app);
  const resolvedApp = await realpath(app);
  for (const pack of packed) {
    const installed = path.join(app, 'node_modules', pack.name);
    assert.equal((await lstat(installed)).isSymbolicLink(), false, `${pack.name}: installed as a link`);
    assert.ok(inside(resolvedApp, await realpath(installed)), `${pack.name}: escaped the consumer`);
    assert.equal(JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8')).version, pack.version);
  }
  // The probe is test-only and runs the app's real controls after hydration.
  await mkdir(path.join(app, 'static'));
  await cp(fileURLToPath(new URL('./pack-fixtures/sveltekit-browser.mjs', import.meta.url)),
    path.join(app, 'static/pack-browser.mjs'));
  const html = path.join(app, 'src/app.html');
  await writeFile(html, (await readFile(html, 'utf8')).replace('</head>',
    '<script type="module" src="/pack-browser.mjs"></script></head>'));
  console.log((await npm(['run', 'build'], app)).trim());
  console.log((await npm(['run', 'verify:ssr'], app)).trim());

  let resolveBrowser;
  const completed = new Promise((resolve, reject) => { resolveBrowser = resolve; rejectBrowser = reject; });
  // Observe errors immediately, including a browser exit while the HTTP probe is running.
  void completed.catch(() => {});
  let handler;
  server = createServer((req, res) => {
    if (req.url === '/__saylo_pack_result' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 65536) { rejectBrowser(new Error('Browser report exceeds limit.')); req.destroy(); }
      });
      req.on('error', rejectBrowser);
      req.on('end', () => {
        try { resolveBrowser(JSON.parse(body)); res.writeHead(200).end('ok'); }
        catch (error) { rejectBrowser(error); res.writeHead(400).end(); }
      });
    } else handler(req, res);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  process.env.ORIGIN = origin;
  ({ handler } = await import(pathToFileURL(path.join(app, 'build/handler.js')).href));
  console.log((await npm(['run', 'verify:ssr', '--', origin], app)).trim());
  browser = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', `--user-data-dir=${path.join(root, 'browser-profile')}`,
    `${origin}/?locale=ko&pack-check=1${supportChecks ? '&support-check=1&focus-check=1' : ''}`], { windowsHide: true, stdio: 'ignore' });
  browser.once('error', error => rejectBrowser?.(error));
  browser.once('exit', code => rejectBrowser?.(new Error(`Chromium exited before completion (${code}).`)));
  timer = setTimeout(() => rejectBrowser?.(new Error('Browser verification timed out after 30s.')), 30000);
  const report = await completed;
  assert.equal(report.ok, true, report.error);
  assert.deepEqual(report.errors, [], 'Browser reported runtime errors or warnings.');
  assert.deepEqual(report.checks, ['hydration', 'ko-en-ko', ...(supportChecks ? ['support-report', 'modal-navigation-focus'] : []), 'shared-layout', 'exit-reentry']);
  if (supportChecks) console.log('[pack:sveltekit] Navigation inside the shared modal retained the focused link.');
  if (supportChecks) console.log('[pack:sveltekit] Support report generation, private form content exclusion, review/reset and input preservation passed.');
  console.log(`[pack:sveltekit] Chromium ${report.browser}: hydration, ko/en/ko switching, shared-layout state and exit/re-entry passed.`);
  console.log('[pack:sveltekit] Five tarballs: independent install, typecheck, client/SSR build, dev lifecycle and production HTTP/browser passed.');
} finally {
  clearTimeout(timer);
  rejectBrowser = undefined;
  await stopBrowser(browser);
  server?.closeAllConnections();
  if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  process.removeListener('SIGINT', interrupted);
  process.removeListener('SIGTERM', interrupted);
  const resolved = path.resolve(root);
  assert.ok(path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('saylo-pack-sveltekit-'),
    'Unsafe SvelteKit pack cleanup path.');
  await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
