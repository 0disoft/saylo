import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const { values } = parseArgs({ options: { out: { type: 'string',
  default: 'benchmarks/results/thin-layer-runtime-cpu-current.json' } } });
const output = path.resolve(repository, values.out);
assert.ok(output.endsWith('.json'));

function summarize(profile) {
  assert.equal(profile.samples.length, profile.timeDeltas.length);
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parents = new Map();
  for (const node of nodes.values()) for (const child of node.children ?? []) {
    assert.ok(nodes.has(child)); assert.ok(!parents.has(child)); parents.set(child, node.id);
  }
  const rows = new Map();
  for (const id of profile.samples) {
    const leaf = nodes.get(id); assert.ok(leaf);
    const seen = new Set(), visited = new Set();
    for (let node = leaf; node; node = nodes.get(parents.get(node.id))) {
      assert.ok(!visited.has(node.id)); visited.add(node.id);
      const frame = node.callFrame;
      let url = frame.url.replaceAll('\\', '/');
      const marker = url.lastIndexOf('/saylo/');
      if (marker >= 0) url = url.slice(marker + 7);
      const key = JSON.stringify([url, frame.lineNumber, frame.columnNumber, frame.functionName]);
      const row = rows.get(key) ?? { function: frame.functionName || '(anonymous)', file: url,
        line: frame.lineNumber + 1, column: frame.columnNumber + 1, selfSamples: 0, inclusiveSamples: 0 };
      if (!seen.has(key)) { row.inclusiveSamples++; seen.add(key); }
      if (node === leaf) row.selfSamples++;
      rows.set(key, row);
    }
  }
  const frames = [...rows.values()].sort((a, b) => b.selfSamples - a.selfSamples || b.inclusiveSamples - a.inclusiveSamples);
  assert.equal(frames.reduce((n, row) => n + row.selfSamples, 0), profile.samples.length);
  return { samples: profile.samples.length,
    negativeTimeDeltas: profile.timeDeltas.filter(n => n < 0).length,
    frames: frames.map(row => ({ ...row, selfPercent: 100 * row.selfSamples / profile.samples.length })) };
}

const directory = await mkdtemp(path.join(tmpdir(), 'saylo-runtime-cpu-'));
const execute = promisify(execFile), observations = [];
try {
  for (const variant of ['core', 'layer']) {
    const name = `${variant}.cpuprofile`;
    const result = await execute(process.execPath, ['--expose-gc', '--cpu-prof', '--cpu-prof-interval=1000',
      `--cpu-prof-dir=${directory}`, `--cpu-prof-name=${name}`,
      'benchmarks/thin-layer/runtime-cost-probe.mjs', '--worker', variant, '--keys', '10000', '--iterations', '50'],
    { cwd: repository, windowsHide: true, timeout: 180000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, TZ: 'UTC' } });
    const worker = JSON.parse(result.stdout);
    assert.equal(worker.updates.length, 58); assert.equal(worker.retainedSnapshotsVerified, 8);
    const raw = await readFile(path.join(directory, name));
    const profileFile = output.replace(/\.json$/, `.${variant}.cpuprofile`);
    await writeFile(profileFile, raw);
    const cpu = summarize(JSON.parse(raw)); assert.ok(cpu.samples > 0);
    observations.push({ variant, keys: worker.keys, commitsVerified: worker.updates.length,
      retainedSnapshotsVerified: worker.retainedSnapshotsVerified, profileFile: path.basename(profileFile),
      profileSha256: createHash('sha256').update(raw).digest('hex'), cpu });
    console.log(JSON.stringify({ variant, samples: cpu.samples, topSelf: cpu.frames.slice(0, 10) }));
  }
} finally {
  // mkdtemp creates this task-owned child of the OS temp directory.
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith('saylo-runtime-cpu-'));
  await rm(directory, { recursive: true, force: true });
}
const files = ['benchmarks/thin-layer/runtime-cpu-probe.mjs', 'benchmarks/thin-layer/runtime-cost-probe.mjs',
  'benchmarks/thin-layer/catalog-layer.mjs', 'benchmarks/thin-layer/lazy-layer.mjs',
  'benchmarks/thin-layer/lazy-source-cache.mjs', 'benchmarks/thin-layer/package-lock.json', 'package-lock.json',
  'packages/core/dist/schema.js', 'packages/core/dist/boot.js', 'packages/core/dist/loading-registry.js'];
const codeHashes = Object.fromEntries(await Promise.all(files.map(async file => [file,
  createHash('sha256').update(await readFile(path.join(repository, file))).digest('hex')])));
await writeFile(output, JSON.stringify({ format: 'saylo-thin-layer-runtime-cpu-v1', observedAt: new Date().toISOString(),
  node: process.version, codeHashes, observations,
  scope: 'Diagnostic full-worker CPU sampling at 1ms, one run per variant in core/layer order. Includes imports, fixture parsing, constructor warm-up, same-width catalog copy/freeze, refresh, asserted translations, retained snapshots, explicit GC and idle. Samples are not limited to refresh; async ancestry and inlined/native frames can be absent. Self percentages use all samples; inclusive rows overlap. Counts and timeDeltas are not exact function CPU time or allocations. Profiled worker timings are deliberately omitted and are not an unprofiled performance or end-to-end latency comparison. Prepared two-locale/one-namespace/10k fixture only.' }, null, 2) + '\n');
