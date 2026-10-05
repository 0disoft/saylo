import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { parseCatalog } from '@saylo/core';
import { summarize } from './statistics.mjs';

// Alternate both parsers in one process to limit run-to-run scheduling drift.
const repository = fileURLToPath(new URL('../..', import.meta.url));
const benchmarkDirectory = path.join(repository, 'benchmarks');
const baseline = process.argv[2] ?? 'HEAD';
const out = path.resolve(process.argv[3] ?? 'benchmarks/results/parse-compare.json');
const exec = promisify(execFile);
const temporary = await mkdtemp(path.join(benchmarkDirectory, '.live-update-parser-'));
try {
  const baselineRevision = (await exec('git', ['rev-parse', baseline], { cwd: repository })).stdout.trim();
  const sources = (await exec('git', ['ls-tree', '-r', '--name-only', baselineRevision, 'packages/core/src'], { cwd: repository })).stdout.trim().split('\n');
  await mkdir(path.join(temporary, 'src'));
  for (const file of sources.filter(file => file.endsWith('.ts'))) {
    const { stdout } = await exec('git', ['show', `${baselineRevision}:${file}`], { cwd: repository });
    await writeFile(path.join(temporary, 'src', path.basename(file)), stdout);
  }
  await writeFile(path.join(temporary, 'package.json'), '{"type":"module"}');
  const config = JSON.parse(await readFile(path.join(repository, 'packages/core/tsconfig.json'), 'utf8'));
  config.compilerOptions.declaration = false;
  await writeFile(path.join(temporary, 'tsconfig.json'), JSON.stringify(config));
  await exec(process.execPath, [path.join(repository, 'node_modules/typescript/bin/tsc'), '-p', path.join(temporary, 'tsconfig.json')], { cwd: repository });
  const original = (await import(pathToFileURL(path.join(temporary, 'dist/catalog.js')).href)).parseCatalog;
  const messages = { probe: 'saylo:00000' };
  for (let index = 1; index < 10000; index++) messages[`message${index}`] = `en Message ${index} {name}`;
  const options = { locale: 'en', namespace: 'bench', sourceName: 'en/bench.json' };
  const parsers = [original, parseCatalog];
  const previous = parsers.map(parser => parser(JSON.stringify(messages), options));
  const samples = [];
  for (let index = 0; index < 150; index++) {
    messages.probe = `saylo:${String(index).padStart(5, '0')}`;
    const source = JSON.stringify(messages);
    const durations = [];
    const order = index % 2 ? [1, 0] : [0, 1];
    for (const variant of order) {
      const started = performance.now();
      previous[variant] = parsers[variant](source, options, previous[variant]);
      durations[variant] = performance.now() - started;
    }
    assert.deepEqual(previous[0], previous[1]);
    if (index >= 50) samples.push({ beforeMs: durations[0], afterMs: durations[1], afterMinusBeforeMs: durations[1] - durations[0] });
  }
  const hashes = Object.fromEntries(await Promise.all(['catalog.js', 'json.js'].map(async name =>
    [name, createHash('sha256').update(await readFile(path.join(repository, 'packages/core/dist', name))).digest('hex')])));
  const differences = samples.map(sample => sample.afterMinusBeforeMs).sort((a, b) => a - b);
  const result = { schema: 'saylo-parser-comparison-v1', measuredAt: new Date().toISOString(), baselineRevision,
    currentCodeHashes: hashes, node: process.version, messages: 10000, warmup: 50, measuredPairs: samples.length,
    scope: 'Same-process alternating incremental parser calls; one same-length value edit; excludes JSON.stringify, equality checks, disk, watcher, validation and browser.',
    before: summarize(samples.map(sample => sample.beforeMs)), after: summarize(samples.map(sample => sample.afterMs)),
    pairedDifference: { medianMs: differences[49], p95Ms: differences[94], improvedPairs: differences.filter(value => value < 0).length }, samples };
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ before: result.before, after: result.after, pairedDifference: result.pairedDifference }, null, 2));
} finally {
  const resolved = path.resolve(temporary);
  if (path.dirname(resolved) !== benchmarkDirectory || !path.basename(resolved).startsWith('.live-update-parser-')) throw new Error('Unsafe parser benchmark cleanup path.');
  await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
