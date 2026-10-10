import assert from 'node:assert/strict';
import { Session } from 'node:inspector';
import { performance } from 'node:perf_hooks';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpus, platform, arch } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCatalog } from '@0disoft/saylo-core';
import { summarizeParserCpu } from './parser-cpu-summary.mjs';
import { summarize } from './statistics.mjs';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const mode = process.argv[2] ?? 'incremental';
if (!['cold', 'incremental'].includes(mode)) throw new Error('Mode must be cold or incremental.');
const out = path.resolve(process.argv[3] ?? `benchmarks/results/parser-cpu-${mode}.json`);
const count = Number(process.argv[4] ?? 100);
if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('Samples must be an integer from 1 to 1000.');
const warmup = mode === 'cold' ? 5 : 50;
const rawFile = out.replace(/\.json$/, '') + '.cpuprofile';
assert.notEqual(out, rawFile);
const messages = { probe: 'saylo:00000' };
for (let index = 1; index < 10000; index++) messages[`message${index}`] = `en Message ${index} {name}`;
const options = { locale: mode === 'cold' ? 'en-GB' : 'en', namespace: 'bench', sourceName: `${mode === 'cold' ? 'en-GB' : 'en'}/bench.json` };
// Prepare all source strings before profiling so stringify does not enter it.
const sources = Array.from({ length: warmup + count }, (_, index) => {
  messages.probe = `saylo:${String(index).padStart(5, '0')}`;
  return JSON.stringify(messages);
});
let previous = mode === 'cold' ? undefined : parseCatalog(sources[0], options);
let last;
for (let index = 0; index < warmup; index++) {
  last = parseCatalog(sources[index], options, previous);
  if (mode === 'incremental') previous = last;
}
const unchanged = previous?.messages.message1;
const codeHashes = {};
for (const file of ['packages/core/dist/catalog.js', 'packages/core/dist/catalog-json.js', 'packages/core/dist/json.js', 'packages/core/dist/simple-message.js',
  'packages/core/dist/schema.js', 'packages/core/dist/diagnostics.js', 'benchmarks/live-update/parser-cpu.mjs',
  'benchmarks/live-update/parser-cpu-summary.mjs', 'benchmarks/live-update/statistics.mjs', 'package-lock.json']) {
  codeHashes[file] = createHash('sha256').update(await readFile(path.join(repository, file))).digest('hex');
}
const session = new Session();
const post = (method, params = {}) => new Promise((resolve, reject) =>
  session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
const samples = [];
let profile;
try {
  session.connect();
  await post('Profiler.enable');
  await post('Profiler.setSamplingInterval', { interval: 1000 });
  await post('Profiler.start');
  for (let index = warmup; index < sources.length; index++) {
    const startTimeMs = performance.now();
    last = parseCatalog(sources[index], options, previous);
    const endTimeMs = performance.now();
    if (mode === 'incremental') previous = last;
    samples.push({ startTimeMs, endTimeMs, durationMs: endTimeMs - startTimeMs });
  }
  ({ profile } = await post('Profiler.stop'));
} finally { session.disconnect(); }
await mkdir(path.dirname(out), { recursive: true });
await writeFile(rawFile, `${JSON.stringify(profile)}\n`);
assert.equal(last.messages.probe.source, messages.probe);
assert.equal(Object.keys(last.messages).length, 10000);
if (mode === 'incremental') assert.equal(last.messages.message1, unchanged);
const cpu = summarizeParserCpu(profile);
assert.ok(cpu.attributedSamples > 0, 'No parser/core stack was sampled.');
const result = { schema: 'saylo-parser-cpu-v1', measuredAt: new Date().toISOString(),
  gitRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  workingTreeStatus: execFileSync('git', ['status', '--short'], { cwd: repository, encoding: 'utf8' }).trim(),
  node: process.version, environment: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
  settings: { mode, messages: 10000, warmup, measuredCalls: count, samplingIntervalUs: 1000, forcedGc: false, detailedStageClocks: false },
  codeHashes, rawProfileFile: path.basename(rawFile),
  scope: 'Single-file parser-only workload of literal/ASCII argument messages. Source stringify, startup, warmup, assertions and disk writes excluded from the profiling interval. Includes loop/timer overhead and observed GC. Frame rows include stacks with parseCatalog or a core dist frame even when the parser caller is absent; missing callers are not synthesized. Percentages use attributed sample counts, not timeDelta weights or all profile samples. Anonymous harness frames are outsideOrUnattributed and must not be assumed to be harness overhead; inlining/native attribution can hide work. positionTicks retain profiler line counters at dist coordinates and are not source-level CPU times. Negative timeDeltas are reported and preserved without clamping. Counts are not exact CPU time or allocation measurements; inclusive rows overlap. Profiled wall-time quantiles are not an unprofiled performance baseline or watcher/browser latency. Cold does not reuse a previous catalog; incremental changes one same-length probe and reuses immutable messages. All input strings are prepared and retained before profiling. OS load and GC are not controlled.',
  wallTime: summarize(samples.map(sample => sample.durationMs)), cpu, samples };
await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ mode, wallTime: result.wallTime, buckets: cpu.buckets, timeDeltas: cpu.timeDeltas,
  topSelf: cpu.frames.slice(0, 10).map(({ functionName, url, lineNumber, attributedSelfPercent, lineTicks }) =>
    ({ functionName, url: url.replaceAll('\\', '/').split('/saylo/').at(-1), line: lineNumber + 1, attributedSelfPercent, lineTicks: lineTicks.slice(0, 3) })) }, null, 2));
