import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { summarize } from './statistics.mjs';
import { beginParserSample, finishParserSample, registerParserProbe, parserMetrics } from './parser-probe.mjs';

const probe = registerParserProbe();
const { parseCatalog } = await import('@0disoft/saylo-core');
probe.assertTransformed();
const out = process.argv[2] ?? 'benchmarks/results/parser-stages-before.json';
const codeHashes = {};
for (const file of ['packages/core/dist/catalog.js', 'packages/core/dist/json.js', 'packages/core/dist/diagnostics.js',
  'benchmarks/live-update/parser-stages.mjs', 'benchmarks/live-update/parser-probe.mjs', 'package-lock.json'])
  codeHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
const results = [];
try {
  for (const messagesPerLocale of [1000, 10000]) {
    const messages = { probe: 'change:000000' };
    for (let i = 1; i < messagesPerLocale; i++) messages[`message${i}`] = `en Message ${i} {name}`;
    const options = { locale: 'en', namespace: 'bench', sourceName: 'en/bench.json' };
    let previous = parseCatalog(JSON.stringify(messages), options);
    const samples = [];
    for (let i = 0; i < 60; i++) {
      messages.probe = `change:${String(i + 1).padStart(6, '0')}`;
      const source = JSON.stringify(messages);
      beginParserSample();
      const start = performance.now();
      const next = parseCatalog(source, options, previous);
      const totalMs = performance.now() - start;
      const stages = finishParserSample();
      assert.equal(next.messages.message1, previous.messages.message1);
      assert.equal(next.messages.probe.source, messages.probe);
      samples.push({ warmup: i < 10, totalMs, ...stages });
      previous = next;
    }
    const measured = samples.filter(sample => !sample.warmup);
    const summary = Object.fromEntries(['totalMs', ...parserMetrics].map(metric => [metric, summarize(measured.map(sample => sample[metric]))]));
    results.push({ messagesPerLocale, summary, samples });
    console.log(JSON.stringify({ messagesPerLocale, summary }));
  }
  await writeFile(out, `${JSON.stringify({ measuredAt: new Date().toISOString(),
    gitRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    workingTreeStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(),
    node: process.version, settings: { warmup: 10, samples: 50 }, codeHashes,
    scope: 'Synchronous parser-only benchmark, one same-length probe edit; immutable prior catalog; input stringify, disk, watcher, validation and browser excluded. tokenScan includes key decoding; json includes strictJson and tokenScan. Nested p95s must not be added. Clock overhead included.', results }, null, 2)}\n`);
} finally { probe.dispose(); }
