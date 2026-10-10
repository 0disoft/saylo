import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseCatalog } from '@0disoft/saylo-core';
import { createCatalogPatch as after } from '../../packages/vite/dist/catalog-patch.js';
import { summarize } from './statistics.mjs';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const { values } = parseArgs({ options: {
  baseline: { type: 'string', default: 'ed2bc8c' },
  out: { type: 'string', default: 'benchmarks/results/patch-allocations.json' },
} });
const baseline = execFileSync('git', ['rev-parse', values.baseline], { cwd: repository, encoding: 'utf8' }).trim();
const source = execFileSync('git', ['show', `${baseline}:packages/vite/src/catalog-patch.ts`], { cwd: repository, encoding: 'utf8' });
const { createCatalogPatch: before } = await import('data:text/javascript;base64,' +
  Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const messages = Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [`m${i}`, `Message ${i} {name}`]));
const parse = input => parseCatalog(JSON.stringify(input), { locale: 'en', namespace: 'bench' });
const original = parse(messages);
const base = { sessionId: 'bench', catalogVersion: 1 };
const inputs = {
  sameLength: { ...messages, m0: 'Changed 0 {name}' },
  uniform: { ...messages, m0: 'Longer changed message 0 {name}' },
  mixed: { ...messages, m5000: 'Longer changed message 5000 {name}' },
};
const results = [];
for (const [scenario, input] of Object.entries(inputs)) {
  const outcome = { status: 'present', key: { locale: 'en', namespace: 'bench' }, sessionId: 'bench',
    catalogVersion: 2, namespaceSchemaFingerprint: 'bench', catalog: parse(input) };
  const samples = [];
  for (let index = 0; index < 120; index++) {
    const functions = index % 2 ? { after, before } : { before, after };
    const sample = { warmup: index < 20, index };
    const patches = {};
    for (const [variant, fn] of Object.entries(functions)) {
      const start = performance.now();
      patches[variant] = fn(original, outcome, base);
      sample[variant + 'Ms'] = performance.now() - start;
    }
    assert.deepEqual(patches.before, patches.after);
    sample.diffMs = sample.afterMs - sample.beforeMs;
    samples.push(sample);
  }
  const measured = samples.filter(s => !s.warmup);
  const diffs = measured.map(s => s.diffMs).sort((a, b) => a - b);
  const summary = { before: summarize(measured.map(s => s.beforeMs)), after: summarize(measured.map(s => s.afterMs)),
    diffMedianMs: diffs[49], diffP95Ms: diffs[94], improved: measured.filter(s => s.diffMs < 0).length };
  results.push({ scenario, summary, samples });
  console.log(scenario, summary);
}
const files = ['packages/vite/src/catalog-patch.ts', 'packages/vite/src/catalog-registry.ts',
  'packages/vite/dist/catalog-patch.js', 'packages/vite/dist/catalog-registry.js', 'package-lock.json',
  'benchmarks/live-update/patch-compare.mjs'];
const hash = value => createHash('sha256').update(value).digest('hex');
const codeHashes = Object.fromEntries(await Promise.all(files.map(async file =>
  [file, hash(await readFile(path.join(repository, file)))])));
await writeFile(path.resolve(repository, values.out), JSON.stringify({ schema: 'saylo-patch-allocation-comparison-v1',
  measuredAt: new Date().toISOString(), baseline, baselineSourceHash: hash(source),
  environment: { node: process.version, platform: process.platform }, settings: { messages: 10000, samples: 100, warmup: 20 },
  scope: 'Alternating same-process calls on the same parsed input, deepEqual each pair. No randomization, forced GC or browser measurements. CatalogRegistry threshold change is excluded from timed calls.',
  codeHashes, results }, null, 2) + '\n');
