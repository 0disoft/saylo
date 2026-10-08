import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { summarize } from './statistics.mjs';
import { localeMetrics } from './locale-channel.mjs';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const benchmarkDirectory = path.join(repository, 'benchmarks');
const exec = promisify(execFile);
const { values } = parseArgs({ options: {
  baseline: { type: 'string', default: 'cbd6871' }, current: { type: 'string', default: 'HEAD' },
  samples: { type: 'string', default: '25' }, warmup: { type: 'string', default: '5' },
  calibrations: { type: 'string', default: '10' }, smoke: { type: 'boolean', default: false },
  out: { type: 'string', default: 'benchmarks/results/locale-add-seal-comparison.json' },
} });
const settings = Object.fromEntries(['samples', 'warmup', 'calibrations'].map(name => {
  const value = Number(values[name]);
  if (!Number.isSafeInteger(value) || value < (name === 'warmup' ? 0 : 1)) throw new Error(`Invalid --${name}.`);
  return [name, value];
}));
if (values.smoke) Object.assign(settings, { samples: 1, warmup: 0, calibrations: 1 });
const scenario = values.smoke ? '1k-3-locales' : '10k-20-locales';
const order = values.smoke ? ['before', 'after'] : ['before', 'after', 'after', 'before'];
const git = async args => (await exec('git', args, { cwd: repository })).stdout.trim();
const revisions = { before: await git(['rev-parse', values.baseline]), after: await git(['rev-parse', values.current]) };
// This comparison isolates only the seal-helper move. Refuse broader snapshots.
const changed = await git(['diff', '--name-only', revisions.before, revisions.after, '--', 'packages']);
assert.equal(changed, 'packages/core/src/diagnostics.ts', 'Expected a diagnostics-only product change.');
assert.equal(await git(['status', '--porcelain', '--untracked-files=all', '--', 'packages']), '', 'Commit product edits before comparing.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const originalDistHash = hash(await readFile(path.join(repository, 'packages/core/dist/diagnostics.js')));
const temporary = await mkdtemp(path.join(benchmarkDirectory, '.live-update-compare-'));
const out = values.smoke ? path.join(temporary, 'smoke.json') : path.resolve(repository, values.out);
const snapshots = {};
const runs = [];
let child, stopping, interrupted = false;
const interrupt = () => {
  interrupted = true;
  if (!child?.pid || stopping) return;
  // Windows SIGTERM force-kills Node; stop its owned browser/worker tree too.
  stopping = process.platform === 'win32'
    ? exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => child?.kill())
    : Promise.resolve(child.kill('SIGTERM'));
};
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);

async function runNode(args, cwd) {
  if (interrupted) throw new Error('Comparison interrupted.');
  await new Promise((resolve, reject) => {
    child = spawn(process.execPath, args, { cwd, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Comparison child failed: ${code ?? signal}`)));
  });
  child = undefined;
}

async function snapshot(variant) {
  const root = path.join(temporary, variant);
  await mkdir(path.join(root, 'node_modules/@0disoft'), { recursive: true });
  for (const file of ['package.json', 'package-lock.json']) await cp(path.join(repository, file), path.join(root, file));
  // External dependencies are shared; workspace aliases always target this snapshot.
  // Optimizer caches are fresh per Vite fixture, never linked from the checkout.
  for (const entry of await readdir(path.join(repository, 'node_modules'), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === '@0disoft' || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
    await symlink(path.join(repository, 'node_modules', entry.name), path.join(root, 'node_modules', entry.name), 'junction');
  }
  for (const name of ['core', 'react', 'typegen', 'vite']) {
    const destination = path.join(root, 'packages', name);
    await mkdir(destination, { recursive: true });
    await cp(path.join(repository, 'packages', name, 'package.json'), path.join(destination, 'package.json'));
    await cp(path.join(repository, 'packages', name, 'dist'), path.join(destination, 'dist'), { recursive: true });
    await symlink(destination, path.join(root, 'node_modules/@0disoft', `saylo-${name}`), 'junction');
  }
  const core = path.join(root, 'packages/core');
  await cp(path.join(repository, 'packages/core/src'), path.join(core, 'src'), { recursive: true });
  await cp(path.join(repository, 'packages/core/tsconfig.json'), path.join(core, 'tsconfig.json'));
  const source = (await exec('git', ['show', `${revisions[variant]}:packages/core/src/diagnostics.ts`], { cwd: repository })).stdout;
  await writeFile(path.join(core, 'src/diagnostics.ts'), source);
  await runNode([path.join(repository, 'node_modules/typescript/bin/tsc'), '-p', path.join(core, 'tsconfig.json')], root);
  const harness = path.join(root, 'benchmarks/live-update');
  await mkdir(harness, { recursive: true });
  for (const name of await readdir(path.join(repository, 'benchmarks/live-update'))) {
    if (/\.(mjs|jsx|html)$/.test(name)) await cp(path.join(repository, 'benchmarks/live-update', name), path.join(harness, name));
  }
  return root;
}

try {
  for (const variant of ['before', 'after']) snapshots[variant] = await snapshot(variant);
  assert.equal(hash(await readFile(path.join(snapshots.after, 'packages/core/dist/diagnostics.js'))), originalDistHash);
  await mkdir(path.dirname(out), { recursive: true });
  for (const [index, variant] of order.entries()) {
    const runFile = `${out.replace(/\.json$/, '')}.${index + 1}-${variant}.json`;
    console.log(`[compare] ${index + 1}/${order.length}: ${variant} ${revisions[variant].slice(0, 7)}`);
    await runNode(['benchmarks/live-update/run.mjs', '--mode', 'locale-add', '--scenario', scenario,
      '--samples', String(settings.samples), '--warmup', String(settings.warmup), '--calibrations', String(settings.calibrations), '--out', runFile], snapshots[variant]);
    const result = JSON.parse(await readFile(runFile, 'utf8'));
    result.snapshotSourceRevision = revisions[variant];
    // gitRevision in run.mjs identifies the parent harness checkout, not copied sources.
    result.snapshotVariant = variant;
    await writeFile(runFile, `${JSON.stringify(result, null, 2)}\n`);
    assert.equal(result.results.length, 1);
    assert.ok(Object.values(result.instrumentation).every(value => value === false));
    const scenarioResult = result.results[0];
    assert.equal(scenarioResult.typegenEnabled, true);
    assert.equal(scenarioResult.declarationRewritten, false);
    const raw = JSON.parse(await readFile(path.join(path.dirname(runFile), scenarioResult.samplesFile), 'utf8'));
    assert.equal(raw.samples.length, settings.samples + settings.warmup);
    assert.equal(new Set(raw.samples.map(s => s.token)).size, raw.samples.length);
    const measured = raw.samples.filter(s => !s.warmup);
    assert.equal(measured.length, settings.samples);
    for (const sample of raw.samples) {
      assert.equal(sample.preSelectionCatalogReplies, 0);
      assert.equal(sample.fullReplies, 1);
      assert.equal(sample.catalogReplyEncoding, 'saylo-catalog-v1');
      assert.ok(sample.saveToListAckMs >= sample.saveToBroadcastMs);
      assert.ok(sample.saveToTranslationAckMs >= sample.saveToListAckMs + sample.selectToTranslationAckMs - .00001);
    }
    for (const metric of localeMetrics) assert.deepEqual(scenarioResult.summary[metric], summarize(measured.map(s => s[metric])));
    assert.deepEqual(scenarioResult.controlRoundTrip, summarize(scenarioResult.controlRoundTripsMs));
    runs.push({ index: index + 1, variant, sourceRevision: revisions[variant], file: path.basename(runFile), result, measured });
  }
  const first = runs[0].result.codeHashes;
  for (const run of runs) {
    const differences = Object.keys(first).filter(file => first[file] !== run.result.codeHashes[file]);
    assert.deepEqual(differences, run.variant === 'before' ? [] : ['packages/core/dist/diagnostics.js']);
  }
  const pooled = Object.fromEntries(['before', 'after'].map(variant => {
    const selected = runs.filter(run => run.variant === variant);
    const samples = selected.flatMap(run => run.measured);
    return [variant, { samples: samples.length, runFiles: selected.map(run => run.file),
      within250Ms: samples.filter(s => s.saveToListAckMs <= 250).length,
      summary: Object.fromEntries(localeMetrics.map(metric => [metric, summarize(samples.map(s => s[metric]))])),
      control: summarize(selected.flatMap(run => run.result.results[0].controlRoundTripsMs)) }];
  }));
  const comparison = { schema: 'saylo-locale-add-comparison-v1', measuredAt: new Date().toISOString(), revisions, order, settings, scenario,
    scope: 'Sequential independent fresh Vite/browser runs, reversed block order (before/after, after/before). Same current harness/dependencies with isolated workspace snapshots; only diagnostics differs. Pooled quantiles use measured samples, not averages of run p95s. No sample-level pairing, randomization, forced GC or subtraction of GC/control/cross-process clocks; not causal proof.',
    runs: runs.map(({ index, variant, sourceRevision, file, result }) => ({ index, variant, sourceRevision, file, measuredAt: result.measuredAt,
      summary: result.results[0].summary, control: result.results[0].controlRoundTrip })), pooled };
  await writeFile(out, `${JSON.stringify(comparison, null, 2)}\n`);
  console.log(JSON.stringify({ pooled, result: values.smoke ? 'smoke passed (temporary output)' : out }, null, 2));
} finally {
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  await stopping;
  const resolved = path.resolve(temporary);
  if (path.dirname(resolved) !== benchmarkDirectory || !path.basename(resolved).startsWith('.live-update-compare-')) throw new Error('Unsafe comparison cleanup path.');
  try {
    assert.equal(hash(await readFile(path.join(repository, 'packages/core/dist/diagnostics.js'))), originalDistHash, 'Checkout dist changed.');
  } finally { await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}
