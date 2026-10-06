import { spawn, execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import react from '@vitejs/plugin-react';
import { compile, paraglideVitePlugin } from '@inlang/paraglide-js';
import { createParaglideFixture } from './fixture.mjs';
import { createChannel } from './channel.mjs';
import { scenarios } from '../live-update/fixture.mjs';
import { summarize } from '../live-update/statistics.mjs';

const exec = promisify(execFile), require = createRequire(import.meta.url);
const repository = fileURLToPath(new URL('../..', import.meta.url));
// Use exactly the Vite installation used by Saylo, instead of the React plugin's peer installation.
const rootRequire = createRequire(path.join(repository, 'package.json'));
const { createServer } = await import(pathToFileURL(rootRequire.resolve('vite')).href);
const directory = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: { samples: { type: 'string', default: '50' }, warmup: { type: 'string', default: '5' },
  calibrations: { type: 'string', default: '25' }, scenario: { type: 'string', default: 'all' }, browser: { type: 'string' },
  'timeout-ms': { type: 'string', default: '120000' }, out: { type: 'string', default: 'benchmarks/results/paraglide-edit.json' } } });
const settings = Object.fromEntries(['samples', 'warmup', 'calibrations', 'timeout-ms'].map(key => {
  const value = Number(values[key]);
  if (!Number.isSafeInteger(value) || value < (key === 'warmup' ? 0 : 1)) throw new Error(`Invalid --${key}.`);
  return [key === 'timeout-ms' ? 'timeoutMs' : key, value];
}));
const selected = scenarios.filter(s => values.scenario === 'all' || values.scenario === s.id);
if (!selected.length) throw new Error('Unknown scenario.');
const candidates = values.browser ? [path.resolve(values.browser)] : process.platform === 'win32' ? [
  path.join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
] : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : ['/usr/bin/chromium', '/usr/bin/google-chrome'];
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw new Error('Pass --browser with an installed Chromium executable.');
const files = ['run.mjs', 'fixture.mjs', 'channel.mjs', 'app.jsx', 'main.jsx', 'control.js', 'package.json', 'package-lock.json'].map(file => `benchmarks/paraglide/${file}`);
files.push('benchmarks/live-update/fixture.mjs', 'benchmarks/live-update/statistics.mjs', 'package-lock.json');
const codeHashes = Object.fromEntries(await Promise.all(files.map(async file => [file,
  createHash('sha256').update(await readFile(path.join(repository, file))).digest('hex')])));
const version = async name => {
  let dir = path.dirname(require.resolve(name));
  while (true) {
    try { const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')); if (pkg.name === name) return pkg.version; } catch {}
    const parent = path.dirname(dir); if (parent === dir) throw new Error(`Missing version for ${name}`); dir = parent;
  }
};
const versions = Object.fromEntries(await Promise.all(['vite', 'react', 'react-dom', '@vitejs/plugin-react', '@inlang/paraglide-js', '@inlang/plugin-message-format'].map(async name => [name, await version(name)])));
versions.vite = rootRequire('vite/package.json').version;
async function stopBrowser(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  if (process.platform === 'win32') { try { await exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { child.kill(); } }
  else child.kill('SIGTERM');
  let timer;
  await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); })]);
  clearTimeout(timer);
}
async function runScenario(scenario) {
  const root = await mkdtemp(path.join(directory, '.live-update-paraglide-'));
  let vite, child, channel;
  let cancelled = false;
  const interrupted = () => { cancelled = true; channel?.fail(new Error('Benchmark interrupted.')); };
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  try {
    const appRoot = path.join(root, 'app');
    const fixture = await createParaglideFixture(appRoot, scenario);
    const compilerOptions = { project: fixture.project, outdir: path.join(appRoot, 'paraglide'),
      emitTsDeclarations: false, strategy: ['cookie', 'globalVariable', 'baseLocale'] };
    // Create project metadata before starting Vite's watcher. Kept outside warm edit timing.
    const preparedAt = performance.now();
    await compile({ ...compilerOptions, outputStructure: 'locale-modules' });
    const fixturePreparationMs = performance.now() - preparedAt;
    const compilerPlugin = paraglideVitePlugin(compilerOptions);
    let lastCompilerEnd = performance.now();
    const inFlight = new Set();
    for (const plugin of [compilerPlugin].flat()) {
      for (const key of ['buildStart', 'watchChange']) {
        const original = plugin[key];
        if (typeof original !== 'function') throw new Error(`Unexpected compiler hook ${key}.`);
        plugin[key] = async function (...args) {
          const promise = Promise.resolve().then(() => original.apply(this, args));
          inFlight.add(promise);
          try { return await promise; } finally { inFlight.delete(promise); lastCompilerEnd = performance.now(); }
        };
      }
    }
    const awaitCompilerIdle = async () => {
      while (inFlight.size || performance.now() - lastCompilerEnd < 100) {
        if (inFlight.size) await Promise.allSettled([...inFlight]);
        else await new Promise(resolve => setTimeout(resolve, 100));
      }
    };
    channel = createChannel({ scenario, target: fixture.target, ...settings, awaitCompilerIdle });
    if (cancelled) throw new Error('Benchmark interrupted.');
    console.log(`[paraglide] ${scenario.id}: ${fixture.catalogBytes} catalog bytes; starting Vite`);
    const startedAt = performance.now();
    vite = await createServer({ configFile: false, root: appRoot, clearScreen: false, logLevel: 'error',
      plugins: [react(), compilerPlugin, channel.plugin],
      server: { host: '127.0.0.1', port: 0, strictPort: true }, optimizeDeps: { include: ['react', 'react-dom/client'] } });
    await vite.listen();
    if (cancelled) throw new Error('Benchmark interrupted.');
    const serverStartupMs = performance.now() - startedAt;
    channel.start();
    const launchedAt = performance.now();
    child = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', `--user-data-dir=${path.join(root, 'browser-profile')}`,
      `http://127.0.0.1:${vite.httpServer.address().port}/`], { windowsHide: true, stdio: 'ignore' });
    child.once('error', channel.fail);
    child.once('exit', code => channel.fail(new Error(`Browser exited early (${code}).`)));
    const collected = await channel.completion;
    await awaitCompilerIdle();
    const measured = collected.results.filter(sample => !sample.warmup);
    if (measured.length !== settings.samples) throw new Error('Incomplete sample set.');
    const { readyAt, ...browser } = collected.browser;
    return { ...scenario, namespaces: 1, catalogFiles: fixture.catalogFiles, catalogBytes: fixture.catalogBytes,
      renderedMessages: 2, changedKeysPerSave: 1, editedLocale: 'en', emitTsDeclarations: false, fixturePreparationMs,
      outputStructure: 'locale-modules (development default)', browser, serverStartupMs, browserBootMs: readyAt - launchedAt,
      summary: Object.fromEntries(['saveToAckMs', 'fileWriteMs', 'commitToAckDispatchMs'].map(metric => [metric, summarize(measured.map(sample => sample[metric]))])),
      documentCountIncludingWarmup: collected.documentCount,
      preservation: Object.fromEntries(['inputNodePreserved', 'inputValuePreserved', 'componentStatePreserved'].map(key => [key, measured.filter(sample => sample[key] === true).length])),
      reloads: measured.reduce((sum, sample) => sum + sample.reloads, 0),
      controlRoundTrip: summarize(collected.roundTrips), controlRoundTripsMs: collected.roundTrips, samples: collected.results };
  } finally {
    channel?.dispose(); await stopBrowser(child); await vite?.close();
    process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(directory) || !path.basename(resolved).startsWith('.live-update-paraglide-')) throw new Error('Unsafe cleanup path.');
    await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
const out = path.resolve(values.out), results = [];
await mkdir(path.dirname(out), { recursive: true });
for (const scenario of selected) {
  const result = await runScenario(scenario);
  const samplesFile = `${path.basename(out, path.extname(out))}.${scenario.id}.samples.json`;
  await writeFile(path.join(path.dirname(out), samplesFile), `${JSON.stringify({ scenario: scenario.id, samples: result.samples }, null, 2)}\n`);
  delete result.samples; result.samplesFile = samplesFile; results.push(result);
  console.log(`[paraglide] ${scenario.id}: p95=${result.summary.saveToAckMs.p95Ms.toFixed(2)}ms; reloads=${result.reloads}`);
}
await writeFile(out, `${JSON.stringify({ schema: 'saylo-paraglide-benchmark-v1', mode: 'edit', measuredAt: new Date().toISOString(),
  gitRevision: (await exec('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim(),
  workingTreeStatus: (await exec('git', ['status', '--short'], { cwd: repository })).stdout.trim(), codeHashes, settings,
  environment: { platform: process.platform, architecture: process.arch, osRelease: os.release(), node: process.version,
    cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: os.totalmem() / 1024 ** 3, versions },
  clock: 'Node performance.now: writeFile resolved -> DOM commit HTTP ack body received. Browser commitToAckDispatch uses its own clock. Never subtract clocks or control RTT.',
  scope: 'Same catalog content/dimensions as Saylo; message-format plugin copied from installed package, no runtime CDN access. React Fast Refresh enabled. DOM commit, no paint timing. Separate run, not paired speedup evidence.',
  results }, null, 2)}\n`);
console.log(`[paraglide] result: ${out}`);
