import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createI18n, createBaseSchema, parseCatalog, freezeCatalogs } from '@0disoft/saylo-core';
import { createLazyLayerSync } from './lazy-layer.mjs';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const { values } = parseArgs({ options: { worker: { type: 'string' }, keys: { type: 'string', default: '1000' },
  iterations: { type: 'string', default: '30' }, out: { type: 'string', default: 'benchmarks/results/thin-layer-runtime-cost-current.json' } } });
const keyCount = Number(values.keys), iterations = Number(values.iterations);
assert.ok(Number.isSafeInteger(keyCount) && keyCount >= 3 && keyCount <= 100000);
assert.ok(Number.isSafeInteger(iterations) && iterations >= 10 && iterations <= 1000);
const label = version => `C${String(version).padStart(8, '0')} Ada`;
function fixture() {
  const original = Object.create(null), translated = Object.create(null);
  for (let index = 0; index < keyCount - 2; index++) {
    original[`item${index}`] = `Base ${index} {name}`;
    translated[`item${index}`] = index ? `RU ${index} {name}` : 'C00000000 {name}';
  }
  original.rows = '{count, plural, one {one row} other {# rows}}';
  original.when = '{at, date} / {at, time, ::HHmm}';
  const base = parseCatalog(JSON.stringify(original), { locale: 'en', namespace: 'demo' });
  let target = parseCatalog(JSON.stringify(translated), { locale: 'ru', namespace: 'demo' });
  const fingerprint = createBaseSchema(base).fingerprint;
  let revision = 0, manifest, loads = 0;
  const outcome = locale => Object.freeze({ sessionId: 'runtime-cost', key: Object.freeze({ locale, namespace: 'demo' }),
    status: 'present', catalogVersion: locale === 'en' ? 1 : revision + 1,
    namespaceSchemaFingerprint: fingerprint, catalog: locale === 'en' ? base : target });
  const updateManifest = () => { manifest = Object.freeze({ sessionId: 'runtime-cost', registryRevision: revision,
    baseLocale: 'en', availableLocales: Object.freeze(['en', 'ru']), availableNamespaces: Object.freeze(['demo']),
    catalogs: Object.freeze(['en', 'ru'].map(locale => { const { catalog: _, ...metadata } = outcome(locale); return Object.freeze(metadata); })) }); };
  updateManifest();
  const source = { readManifest: () => manifest, loadCatalog: async locale => { loads++; return outcome(locale); } };
  return { source, seed: () => ['en', 'ru'].map(outcome), loads: () => loads,
    update(version) {
      // Same-width edits keep every unchanged message's source positions valid.
      // Parsing, O(N) dictionary copying and source freezing are outside timing.
      const message = parseCatalog(JSON.stringify({ item0: `C${String(version).padStart(8, '0')} {name}` }),
        { locale: 'ru', namespace: 'demo' }).messages.item0;
      assert.equal(message.position.offset, target.messages.item0.position.offset);
      target = freezeCatalogs([{ ...target, messages: Object.freeze(Object.assign(Object.create(null), target.messages, { item0: message })) }])[0];
      revision++; updateManifest();
    } };
}
function render(instance, version) {
  assert.equal(instance.t('demo:item0', { name: 'Ada' }), label(version));
  assert.equal(instance.t('demo:rows', { count: 21 }), '21 rows');
  assert.equal(instance.t('demo:when', { at: Date.parse('2026-01-01T00:30:00Z') }), '1/1/2026 / 00:30');
}
async function heap() {
  // Resolved i18next init promises can hold an engine until their reaction jobs
  // run. Drain the task before comparing collected heaps with synchronous core.
  await new Promise(setImmediate); globalThis.gc(); return process.memoryUsage().heapUsed;
}
async function worker() {
  assert.equal(typeof globalThis.gc, 'function', 'Worker needs --expose-gc');
  const create = values.worker === 'core' ? createI18n : createLazyLayerSync;
  assert.ok(['core', 'layer'].includes(values.worker));
  const f = fixture(), constructors = [], updates = [], retained = [];
  const options = () => ({ catalogSource: f.source, locale: 'ru', timeZone: 'UTC', initialNamespaces: ['demo'], initialCatalogs: f.seed() });
  // An explicit untimed warm-up avoids comparing module/JIT initialization.
  { let warm = create(options()); render(warm, 0); warm.dispose(); warm = null; }
  for (let index = 0; index < 3; index++) {
    globalThis.gc(); const started = performance.now();
    let trial = create(options()); assert.equal(trial.then, undefined); render(trial, 0);
    constructors.push(performance.now() - started); trial.dispose(); trial = null;
  }
  const before = await heap(); let instance = create(options()); render(instance, 0);
  const live = await heap(); let steady;
  for (let version = 1; version <= iterations + 8; version++) {
    if (version > iterations) retained.push({ snapshot: instance.getSnapshot(), version: version - 1 });
    f.update(version);
    const started = performance.now(); await instance.refresh(); render(instance, version);
    updates.push({ version, retainedPhase: version > iterations, milliseconds: performance.now() - started });
    if (version === iterations) steady = await heap();
  }
  const withRetained = await heap();
  for (const entry of retained) assert.equal(entry.snapshot.t('demo:item0', { name: 'Ada' }), label(entry.version));
  retained.length = 0; const released = await heap();
  const hotStarted = performance.now();
  for (let index = 0; index < 500; index++) render(instance, iterations + 8);
  const hotReads = { calls: 1500, milliseconds: performance.now() - hotStarted };
  const stats = instance.getProbeStats?.(); assert.equal(f.loads(), iterations + 8);
  instance.dispose(); instance = null; const disposed = await heap();
  return { variant: values.worker, keys: keyCount, targetKeys: keyCount - 2, iterations, constructors, updates, hotReads,
    sourceLoads: f.loads(), stats, heapBytes: { before, live, steady, withRetained, released, disposed },
    heapDeltas: { live: live - before, steady: steady - before, retained: withRetained - released,
      additionalPhase: withRetained - steady,
      released: released - before, disposed: disposed - before }, retainedSnapshotsVerified: 8 };
}
if (values.worker) { console.log(JSON.stringify(await worker())); }
else {
  const exec = promisify(execFile), observations = [];
  // Independent child heaps; sequential ABBA ordering is an observation design,
  // not a claim that the machine's scheduler or JIT is identical across runs.
  for (const keys of [1000, 10000]) for (const [block, variant] of ['core', 'layer', 'layer', 'core'].entries()) {
    const result = await exec(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--worker', variant,
      '--keys', String(keys), '--iterations', values.iterations], { cwd: repository, windowsHide: true, timeout: 180000,
      maxBuffer: 2 * 1024 * 1024, env: { ...process.env, TZ: 'UTC' } });
    const data = JSON.parse(result.stdout); observations.push({ block, ...data });
    console.log(`[runtime cost] ${keys}/${variant}/${block}: ${data.updates.length} commits; retained snapshots verified`);
  }
  const percentile = (list, q) => [...list].sort((a, b) => a - b)[Math.max(0, Math.ceil(list.length * q) - 1)];
  const summaries = [1000, 10000].flatMap(keys => ['core', 'layer'].map(variant => {
    const runs = observations.filter(run => run.keys === keys && run.variant === variant);
    const samples = runs.flatMap(run => run.updates.filter(sample => !sample.retainedPhase).map(sample => sample.milliseconds));
    return { keys, variant, commits: samples.length, commitP50Ms: percentile(samples, .5), commitP95Ms: percentile(samples, .95),
      steadyHeapDeltas: runs.map(run => run.heapDeltas.steady), retainedHeapDeltas: runs.map(run => run.heapDeltas.retained),
      hotReadMilliseconds: runs.map(run => run.hotReads.milliseconds) };
  }));
  const files = ['benchmarks/thin-layer/runtime-cost-probe.mjs', 'benchmarks/thin-layer/lazy-layer.mjs',
    'benchmarks/thin-layer/lazy-source-cache.mjs', 'benchmarks/thin-layer/catalog-layer.mjs', 'benchmarks/thin-layer/ast-format.mjs',
    'benchmarks/thin-layer/package-lock.json', 'packages/core/dist/i18n.js', 'packages/core/dist/catalog-loader.js',
    'packages/core/dist/loading-registry.js', 'packages/core/dist/formatters.js', 'packages/core/dist/schema.js', 'package-lock.json'];
  const codeHashes = Object.fromEntries(await Promise.all(files.map(async file => [file,
    createHash('sha256').update(await readFile(path.join(repository, file))).digest('hex')])));
  await writeFile(path.resolve(repository, values.out), JSON.stringify({ format: 'saylo-thin-layer-runtime-cost-v1',
    observedAt: new Date().toISOString(), node: process.version, codeHashes, observations, summaries,
    scope: 'Isolated Node runtime costs with independent --expose-gc child processes in sequential ABBA order. One namespace, two prepared immutable catalogs, 1k/10k baseline keys, base schema cache warmed equally before constructors. Same-width single-message update preparation/parse/copy/freeze, I/O, Vite wire decode, React/DOM and modules are excluded from timing. Refresh plus three asserted translations is timed; task/microtasks drain before each forced-GC heap observation. Not peak/RSS/browser memory or end-to-end 100ms/250ms goals. Eight intentional old snapshots are verified; retained delta compares their held vs released heaps at the same final source version. Server snapshot remains part of each live instance. Other source input graphs continue evolving, so heap differences are not exact library-only bytes. No causal, leak, broad-scale or production-size claim.' }, null, 2) + '\n');
  console.log(JSON.stringify(summaries, null, 2));
}
