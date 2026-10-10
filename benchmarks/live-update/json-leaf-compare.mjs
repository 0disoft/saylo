import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { parseCatalog } from '@0disoft/saylo-core';
import { summarize } from './statistics.mjs';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const directory = path.join(repository, 'benchmarks');
const root = await mkdtemp(path.join(directory, '.json-leaf-'));
const beforeRef = '78b23b7';
const original = execFileSync('git', ['show', `${beforeRef}:packages/core/src/catalog.ts`], { cwd: repository, encoding: 'utf8' });
const hash = value => createHash('sha256').update(value).digest('hex');
const signedSummary = values => {
  const shift = Math.max(0, -Math.min(...values));
  const result = summarize(values.map(value => value + shift));
  return { ...result, p50Ms: result.p50Ms - shift, p95Ms: result.p95Ms - shift,
    minMs: result.minMs - shift, maxMs: result.maxMs - shift };
};
const results = [];
try {
  // Node 24 strips the baseline's types. Both variants share unchanged current
  // JSON/ICU/schema/freeze dependencies; no baseline source is rewritten in git.
  let code = original;
  for (const name of ['diagnostics', 'json', 'schema', 'simple-message']) {
    const needle = `from './${name}.js'`;
    assert.equal(code.split(needle).length, 2);
    code = code.replace(needle, `from ${JSON.stringify(pathToFileURL(path.join(repository, 'packages/core/dist', `${name}.js`)).href)}`);
  }
  const file = path.join(root, 'before.mts');
  await writeFile(file, code);
  const { parseCatalog: before } = await import(pathToFileURL(file).href);
  const options = { locale: 'en', namespace: 'bench', sourceName: 'en/bench.json' };
  for (const mode of ['same-length', 'variable-length', 'cold']) {
    const warmup = mode === 'cold' ? 5 : 20;
    const count = mode === 'cold' ? 20 : 100;
    const messages = { probe: 'saylo:000000' };
    for (let i = 1; i < 10000; i++) messages[`message${i}`] = `en Message ${i} {name}`;
    const initial = JSON.stringify(messages);
    const sources = Array.from({ length: warmup + count }, (_, i) => {
      messages.probe = mode === 'variable-length' ? `saylo:${'x'.repeat(i % 11 + 1)}:${i}` : `saylo:${String(i + 1).padStart(6, '0')}`;
      return JSON.stringify(messages);
    });
    let previousBefore = mode === 'cold' ? undefined : before(initial, options);
    let previousAfter = mode === 'cold' ? undefined : parseCatalog(initial, options);
    const samples = [];
    for (let i = 0; i < sources.length; i++) {
      const order = i % 2 === 0 ? ['before', 'after'] : ['after', 'before'];
      const next = {};
      const timings = {};
      for (const variant of order) {
        const started = performance.now();
        next[variant] = variant === 'before' ? before(sources[i], options, previousBefore) : parseCatalog(sources[i], options, previousAfter);
        timings[variant] = performance.now() - started;
      }
      assert.deepEqual(next.after, next.before, `${mode}:${i}`);
      if (mode !== 'cold') { previousBefore = next.before; previousAfter = next.after; }
      samples.push({ warmup: i < warmup, order, beforeMs: timings.before, afterMs: timings.after,
        deltaMs: timings.after - timings.before });
    }
    const measured = samples.filter(sample => !sample.warmup);
    const result = { mode, warmup, count, messages: 10000, equalResults: sources.length,
      before: summarize(measured.map(sample => sample.beforeMs)), after: summarize(measured.map(sample => sample.afterMs)),
      pairedDelta: signedSummary(measured.map(sample => sample.deltaMs)), improvedPairs: measured.filter(sample => sample.deltaMs < 0).length, samples };
    results.push(result);
    console.log(JSON.stringify({ mode, before: result.before, after: result.after, improvedPairs: result.improvedPairs }));
  }
  const files = ['packages/core/src/catalog.ts', 'packages/core/dist/catalog.js', 'packages/core/dist/catalog-json.js',
    'packages/core/dist/json.js', 'packages/core/dist/diagnostics.js', 'packages/core/dist/schema.js', 'packages/core/dist/simple-message.js',
    'benchmarks/live-update/json-leaf-compare.mjs', 'benchmarks/live-update/statistics.mjs', 'package-lock.json'];
  const codeHashes = Object.fromEntries(await Promise.all(files.map(async name => [name, hash(await readFile(path.join(repository, name)))])));
  const output = { schema: 'saylo-json-leaf-compare-v1', observedAt: new Date().toISOString(), node: process.version,
    beforeRef, beforeSourceHash: hash(original), beforeExecutableHash: hash(code), codeHashes,
    scope: 'Single-process parser-only comparison, alternating before/after pair order. Exact baseline TS read from git and stripped by Node 24; unchanged dependencies shared with current dist. Same-length/variable-length edits reuse each variant own previous catalog. Cold never passes a previous catalog. Input stringify and deep equality excluded from timing. GC/OS/JIT not controlled. Stores successful-parse JSON spans; retained-memory overhead not quantified. No Vite/browser or p95 target claim.', results };
  await writeFile(path.join(repository, 'benchmarks/results/json-leaf-compare-2026-10-11.json'), JSON.stringify(output, null, 2) + '\n');
} finally {
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== directory || !path.basename(resolved).startsWith('.json-leaf-')) throw new Error('Unsafe cleanup path.');
  await rm(resolved, { recursive: true, force: true });
}
