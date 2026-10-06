import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import saylo from '@0disoft/saylo-vite';
import { createChannel } from './channel.mjs';
import { createFixture, scenarios } from './fixture.mjs';
import { summarize } from './statistics.mjs';
import { createStageProbe, createCpuProbe } from './profile.mjs';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const directory = fileURLToPath(new URL('..', import.meta.url));
const repository = fileURLToPath(new URL('../..', import.meta.url));
const { values } = parseArgs({ options: { samples: { type: 'string', default: '50' }, warmup: { type: 'string', default: '5' },
  calibrations: { type: 'string', default: '25' }, scenario: { type: 'string', default: 'all' },
  browser: { type: 'string' }, out: { type: 'string', default: 'benchmarks/results/live-update.json' },
  'no-typegen': { type: 'boolean', default: false }, 'cpu-profile': { type: 'boolean', default: false },
  'timeout-ms': { type: 'string', default: '30000' } } });
function integer(name, min) {
  const value = Number(values[name]);
  if (!Number.isSafeInteger(value) || value < min) throw new Error(`--${name} must be an integer >= ${min}.`);
  return value;
}
const settings = { samples: integer('samples', 1), warmup: integer('warmup', 0), calibrations: integer('calibrations', 1),
  timeoutMs: integer('timeout-ms', 1000) };
const selected = scenarios.filter(s => values.scenario === 'all' || s.id === values.scenario);
if (!selected.length) throw new Error('Unknown scenario; use all, 1k-3-locales or 10k-20-locales.');

async function browserExecutable() {
  if (values.browser) { await access(values.browser); return path.resolve(values.browser); }
  const candidates = process.platform === 'win32' ? [
    path.join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
  ] : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch {} }
  throw new Error('No installed Chromium browser found; pass --browser <executable>.');
}
const executable = await browserExecutable();
// Include the actual loaded modules, so uncommitted optimization trials are identifiable.
const measuredFiles = ['packages/core/dist/catalog.js', 'packages/core/dist/json.js',
  'packages/core/dist/diagnostics.js', 'packages/core/dist/schema.js', 'packages/typegen/dist/catalog-files.js',
  'packages/vite/dist/live-registry.js', 'packages/vite/dist/translation-quarantine.js', 'packages/vite/dist/catalog-registry.js', 'packages/vite/dist/catalog-patch.js',
  'benchmarks/live-update/profile.mjs', 'benchmarks/live-update/channel.mjs', 'benchmarks/live-update/run.mjs',
  'benchmarks/live-update/app.jsx', 'benchmarks/live-update/fixture.mjs', 'benchmarks/live-update/statistics.mjs', 'package-lock.json'];
const codeHashes = Object.fromEntries(await Promise.all(measuredFiles.map(async file =>
  [file, createHash('sha256').update(await readFile(path.join(repository, file))).digest('hex')])));

async function stopBrowser(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  if (process.platform === 'win32') {
    try { await exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); }
    catch { child.kill(); }
  } else child.kill('SIGTERM');
  let timer;
  await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); })]);
  clearTimeout(timer);
}

async function runScenario(scenario) {
  const root = await mkdtemp(path.join(directory, '.live-update-'));
  let vite, child, channel;
  const stageProbe = createStageProbe();
  const cpuProbe = createCpuProbe(values['cpu-profile']);
  let cancelled = false;
  const interrupted = () => { cancelled = true; channel?.fail(new Error('Benchmark interrupted.')); };
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  try {
    const appRoot = path.join(root, 'app');
    const fixture = await createFixture(appRoot, scenario);
    if (cancelled) throw new Error('Benchmark interrupted.');
    channel = createChannel({ scenario, target: fixture.target, ...settings, stageProbe, cpuProbe });
    console.log(`[bench] ${scenario.id}: ${fixture.catalogFiles} files, ${fixture.catalogBytes} catalog bytes; starting Vite`);
    const startupAt = performance.now();
    vite = await createServer({ configFile: false, root: appRoot, logLevel: 'error', clearScreen: false,
      plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', initialLocale: 'en', initialNamespaces: ['bench'],
        ...(values['no-typegen'] ? {} : { typegen: { outFile: 'generated.d.ts' } }) }), channel.plugin],
      server: { host: '127.0.0.1', port: 0, strictPort: true },
      optimizeDeps: { include: ['react', 'react-dom/client', '@0disoft/saylo-core', '@0disoft/saylo-react'] } });
    await vite.listen();
    if (cancelled) throw new Error('Benchmark interrupted.');
    const serverStartupMs = performance.now() - startupAt;
    const declaration = values['no-typegen'] ? undefined : await stat(path.join(appRoot, 'generated.d.ts'));
    const address = vite.httpServer.address();
    const url = `http://127.0.0.1:${address.port}/`;
    channel.start();
    const launchedAt = performance.now();
    child = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', `--user-data-dir=${path.join(root, 'browser-profile')}`, url], { windowsHide: true, stdio: 'ignore' });
    child.once('error', error => channel.fail(error));
    child.once('exit', code => channel.fail(new Error(`Benchmark browser exited early (${code}).`)));
    const collected = await channel.completion;
    const measured = collected.results.filter(sample => !sample.warmup);
    if (measured.length !== settings.samples) throw new Error('Incomplete benchmark sample set.');
    const afterDeclaration = declaration ? await stat(path.join(appRoot, 'generated.d.ts')) : undefined;
    if (declaration && (declaration.mtimeMs !== afterDeclaration.mtimeMs || declaration.size !== afterDeclaration.size))
      throw new Error('Text-only edits unexpectedly rewrote generated declarations.');
    const { readyAt, ...browser } = collected.browser;
    const summary = Object.fromEntries(['saveToAckMs', 'saveToManifestBroadcastMs', 'receiveToCommitMs', 'commitToAckDispatchMs', 'fileWriteMs']
      .map(metric => [metric, summarize(measured.map(sample => sample[metric]))]));
    const replySizes = summarize(measured.map(sample => sample.catalogReplyBytes));
    return { ...scenario, namespaces: fixture.namespaces, catalogFiles: fixture.catalogFiles, catalogBytes: fixture.catalogBytes,
      renderedMessages: 2, editedLocale: 'en', editedNamespace: 'bench', changedKeysPerSave: 1,
      typegenEnabled: !values['no-typegen'], declarationRewritten: false, browser, serverStartupMs,
      wire: { patchReplies: measured.filter(s => s.catalogReplyKind === 'patch').length,
        fullReplies: measured.filter(s => s.catalogReplyKind === 'present').length,
        maxChangedMessages: Math.max(...measured.map(s => s.changedMessages)),
        maxPositionUpdates: Math.max(...measured.map(s => s.positionUpdates)),
        catalogReplyBytes: { p50Bytes: replySizes.p50Ms, p95Bytes: replySizes.p95Ms, minBytes: replySizes.minMs, maxBytes: replySizes.maxMs } },
      browserBootMs: readyAt - launchedAt, summary, controlRoundTrip: summarize(collected.roundTrips),
      serverStages: { scope: 'Benchmark-only method wrappers; queueToDrain includes the quiet window; readAndCandidate ends at prepareTranslations and includes the serialized drain wait, path checks, read, parse, candidate filtering and base stat; translationPreparation includes schema lookup, translation validation and quarantine preparation; validation is the final active-catalog validation; stage p95s must not be added. Pre-quarantine readAndCandidate ended at validate, so its boundary differs.',
        ...Object.fromEntries(['queueToDrainMs', 'readAndCandidateMs', 'translationPreparationMs', 'validationMs', 'registryReplaceMs', 'catalogDeltaMs']
          .map(metric => [metric, summarize(measured.map(sample => sample.serverStages[metric]))])),
        maxFileEvents: Math.max(...measured.map(sample => sample.serverStages.fileEvents)),
        maxDrains: Math.max(...measured.map(sample => sample.serverStages.drains)) },
      ...(collected.cpuProfile ? { cpuProfile: collected.cpuProfile } : {}),
      controlRoundTripsMs: collected.roundTrips, samples: collected.results };
  } finally {
    channel?.dispose();
    await stopBrowser(child);
    await vite?.close();
    stageProbe.dispose(); cpuProbe.dispose();
    process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(directory) || !path.basename(resolved).startsWith('.live-update-'))
      throw new Error('Refusing to remove a benchmark path outside its owned temporary directory.');
    await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const results = [];
for (const scenario of selected) {
  const result = await runScenario(scenario);
  results.push(result);
  console.log(`[bench] ${scenario.id}: save-to-DOM-ack p50=${result.summary.saveToAckMs.p50Ms.toFixed(2)}ms p95=${result.summary.saveToAckMs.p95Ms.toFixed(2)}ms`);
}
const output = { schema: 'saylo-live-update-benchmark-v1', measuredAt: new Date().toISOString(),
  gitRevision: (await exec('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim(), settings,
  workingTreeStatus: (await exec('git', ['status', '--short'], { cwd: repository })).stdout.trim(),
  codeHashes,
  environment: { platform: process.platform, architecture: process.arch, osRelease: os.release(), node: process.version,
    cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: os.totalmem() / 1024 ** 3,
    vite: require('vite/package.json').version },
  clock: 'Node performance.now: writeFile resolved -> DOM-commit ack body received; browser-relative stages reported separately',
  acknowledgement: 'Includes HTTP acknowledgement cost. Control round trip is reported separately, never subtracted or added to stage p95s.',
  scope: 'Loaded English namespace edits; one rendered changed key, one rendered unchanged key; Chromium headless, React development mode; no paint timing.',
  results };
const out = path.resolve(values.out);
await mkdir(path.dirname(out), { recursive: true });
for (const result of output.results) {
  const samplesFile = `${path.basename(out, path.extname(out))}.${result.id}.samples.json`;
  await writeFile(path.join(path.dirname(out), samplesFile), `${JSON.stringify({ scenario: result.id, samples: result.samples }, null, 2)}\n`);
  delete result.samples;
  result.samplesFile = samplesFile;
}
await writeFile(out, `${JSON.stringify(output, null, 2)}\n`);
console.log(`[bench] result: ${out}`);
