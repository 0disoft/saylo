import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import path from 'node:path';
import { summarize } from './statistics.mjs';
import { beginParserSample, finishParserSample, registerParserProbe, parserMetrics, parserDetailMetrics } from './parser-probe.mjs';
import { observeGc, gcInWindow } from './gc-profile.mjs';

const mode = process.argv[3] ?? 'incremental';
if (!['incremental', 'cold'].includes(mode)) throw new Error('Parser mode must be incremental or cold.');
const detailed = mode === 'cold';
const warmup = detailed ? 5 : 10, count = detailed ? 20 : 50;
const out = process.argv[2] ?? `benchmarks/results/parser-stages-${detailed ? 'cold' : 'before'}.json`;
const probe = registerParserProbe({ detailed });
const gc = observeGc();
const results = [];
const residual = (whole, parts) => {
  const value = whole - parts.reduce((sum, part) => sum + part, 0);
  if (value < -0.00001) throw new Error('Nested timings exceed their parent.');
  return Math.max(0, value);
};
try {
  const { parseCatalog } = await import('@0disoft/saylo-core');
  probe.assertTransformed();
  const codeHashes = {};
  for (const file of ['packages/core/dist/catalog.js', 'packages/core/dist/json.js', 'packages/core/dist/diagnostics.js',
    'packages/core/dist/schema.js', 'packages/core/dist/simple-message.js', 'benchmarks/live-update/gc-profile.mjs',
    'benchmarks/live-update/parser-stages.mjs', 'benchmarks/live-update/parser-probe.mjs', 'benchmarks/live-update/statistics.mjs', 'package-lock.json'])
    codeHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  for (const messagesPerLocale of [1000, 10000]) {
    const messages = { probe: 'change:000000' };
    for (let i = 1; i < messagesPerLocale; i++) messages[`message${i}`] = `en Message ${i} {name}`;
    const options = { locale: detailed ? 'en-GB' : 'en', namespace: 'bench', sourceName: detailed ? 'en-GB/bench.json' : 'en/bench.json' };
    let previous = detailed ? undefined : parseCatalog(JSON.stringify(messages), options);
    const samples = [];
    const scenarioStart = performance.now();
    for (let i = 0; i < warmup + count; i++) {
      messages.probe = `change:${String(i + 1).padStart(6, '0')}`;
      const source = JSON.stringify(messages);
      const heapBeforeBytes = process.memoryUsage().heapUsed;
      beginParserSample(detailed);
      const startTimeMs = performance.now();
      const next = parseCatalog(source, options, previous);
      const endTimeMs = performance.now();
      const stages = finishParserSample();
      const heapAfterBytes = process.memoryUsage().heapUsed;
      assert.equal(next.messages.probe.source, messages.probe);
      assert.equal(Object.keys(next.messages).length, messagesPerLocale);
      assert.ok(Object.isFrozen(next.messages.message1.ast));
      if (detailed) {
        assert.equal(previous, undefined);
        for (const metric of ['astMs', 'argumentsMs', 'argumentFreezeMs', 'messageFreezeMs']) assert.equal(stages.calls[metric], messagesPerLocale);
        assert.equal(stages.calls.reusedMessageFreezeMs, 0);
      } else assert.equal(next.messages.message1, previous.messages.message1);
      for (const metric of parserMetrics) assert.equal(stages.calls[metric], 1);
      samples.push({ warmup: i < warmup, startTimeMs, endTimeMs, totalMs: endTimeMs - startTimeMs,
        heapBeforeBytes, heapAfterBytes, heapDeltaBytes: heapAfterBytes - heapBeforeBytes, ...stages,
        ...(detailed ? {
          argumentInferenceOnlyMs: residual(stages.argumentsMs, [stages.argumentFreezeMs]),
          messageLoopOtherMs: residual(stages.messageLoopMs, [stages.astMs, stages.argumentsMs, stages.messageFreezeMs, stages.reusedMessageFreezeMs]),
        } : {}),
        unattributedMs: residual(endTimeMs - startTimeMs, [stages.jsonMs, stages.positionIndexMs, stages.messageLoopMs, stages.freezeMs]),
      });
      if (!detailed) previous = next; // Cold samples never retain a prior catalog.
    }
    const scenarioEnd = performance.now();
    const events = await gc.drain();
    for (const sample of samples) sample.gc = gcInWindow(events, sample.startTimeMs, sample.endTimeMs);
    const measured = samples.filter(sample => !sample.warmup);
    const metrics = ['totalMs', ...parserMetrics, ...(detailed ? [...parserDetailMetrics, 'argumentInferenceOnlyMs', 'messageLoopOtherMs'] : []), 'unattributedMs'];
    const summary = Object.fromEntries(metrics.map(metric => [metric, summarize(measured.map(sample => sample[metric]))]));
    const gcSummary = {
      scope: 'Timestamp overlap with synchronous parser calls. Observed GC durations are not measured pause/CPU time and must not be subtracted from parser timings. Heap deltas are net heapUsed changes, including uncollected garbage, not allocated bytes.',
      samplesWithGc: measured.filter(sample => sample.gc.count).length,
      overlap: summarize(measured.map(sample => sample.gc.observedOverlapMs)),
      withGc: measured.some(sample => sample.gc.count) ? summarize(measured.filter(sample => sample.gc.count).map(sample => sample.totalMs)) : null,
      withoutGc: measured.some(sample => !sample.gc.count) ? summarize(measured.filter(sample => !sample.gc.count).map(sample => sample.totalMs)) : null,
      scenario: gcInWindow(events, scenarioStart, scenarioEnd),
    };
    const samplesFile = `${out.replace(/\.json$/, '')}.${messagesPerLocale}.samples.json`;
    await writeFile(samplesFile, `${JSON.stringify({ mode, messagesPerLocale, samples }, null, 2)}\n`);
    results.push({ messagesPerLocale, locale: options.locale, inputBytes: Buffer.byteLength(JSON.stringify(messages)), summary, gcSummary,
      samplesFile: path.basename(samplesFile) });
    console.log(JSON.stringify({ mode, messagesPerLocale, summary, samplesWithGc: gcSummary.samplesWithGc }));
  }
  await writeFile(out, `${JSON.stringify({ schema: 'saylo-parser-stages-v2', measuredAt: new Date().toISOString(),
    gitRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    workingTreeStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(),
    node: process.version, environment: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
    mode, settings: { warmup, samples: count, detailed, forcedGc: false }, codeHashes,
    scope: 'Synchronous parser-only benchmark. Cold: no previous catalog; full literal/simple interpolation parsing each call. Incremental: same-length single probe edit, immutable prior catalog. Input stringify, heapUsed readings, assertions, disk, watcher, translation validation and browser excluded. json includes strictJson and tokenScan; messageLoop includes AST, arguments and message freeze; arguments includes argument freeze. Residuals are calculated per sample before summarizing. Nested p95s must not be added. Clock/counter instrumentation overhead included; GC observed asynchronously and matched by timestamp.', results }, null, 2)}\n`);
} finally { gc.dispose(); probe.dispose(); }
