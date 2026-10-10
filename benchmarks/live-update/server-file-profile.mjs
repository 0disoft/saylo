import { registerHooks } from 'node:module';
import { performance } from 'node:perf_hooks';
import { startRuntimeWindow, endRuntimeWindow, union, remainder } from './runtime-profile.mjs';

export const fileMetrics = ['pathCheckMs', 'fileReadMs', 'catalogParseMs', 'candidateOtherMs'];
const observedMetrics = fileMetrics.slice(0, -1);
let enabled = false;
let current;

export function measureFileSync(metric, work, details) {
  const sample = current;
  if (!sample) return work();
  const startedAt = performance.now();
  const operation = { metric, startMs: startedAt - sample.startedAt, ...details, status: 'running' };
  sample.operations.push(operation);
  const window = startRuntimeWindow(metric);
  try { const value = work(); operation.status = 'ok'; return value; }
  catch (error) { operation.status = 'error'; operation.codes = error?.diagnostics?.map(d => d.code); throw error; }
  finally { operation.endMs = performance.now() - sample.startedAt; sample.calls[metric]++; endRuntimeWindow(window); }
}

export async function measureFileAsync(metric, work) {
  const sample = current;
  if (!sample) return work();
  const startedAt = performance.now();
  const operation = { metric, startMs: startedAt - sample.startedAt, status: 'running' };
  sample.operations.push(operation);
  const window = startRuntimeWindow(metric);
  try { const value = await work(); operation.status = 'ok'; return value; }
  catch (error) { operation.status = 'error'; operation.code = error?.code; throw error; }
  finally { operation.endMs = performance.now() - sample.startedAt; sample.calls[metric]++; endRuntimeWindow(window); }
}

export function beginFileSample() {
  if (current) throw new Error('Overlapping file samples.');
  const startedAt = performance.now();
  if (enabled) current = { startedAt, operations: [], timings: Object.fromEntries(observedMetrics.map(metric => [metric, 0])),
    calls: Object.fromEntries(observedMetrics.map(metric => [metric, 0])) };
  return startedAt;
}

const duration = intervals => union(intervals).reduce((total, [start, end]) => total + end - start, 0);

/** Completed operations must be covered by the actual batch candidate windows. */
export function summarizeFileSample(sample, candidateIntervals) {
  if (!sample || !sample.operations.length || sample.operations.some(op =>
    !observedMetrics.includes(op.metric) || !['ok', 'error'].includes(op.status) || !Number.isFinite(op.endMs)))
    throw new Error('Missing or unfinished catalog file operations.');
  for (const metric of observedMetrics) {
    if (sample.calls[metric] !== sample.operations.filter(op => op.metric === metric).length)
      throw new Error('Catalog file operation count mismatch.');
  }
  if (!(sample.calls.pathCheckMs >= sample.calls.fileReadMs && sample.calls.fileReadMs >= sample.calls.catalogParseMs &&
    sample.operations.some(op => op.metric === 'catalogParseMs' && op.status === 'ok')))
    throw new Error('Missing successful catalog parse or invalid operation order.');
  const spans = sample.operations.map(op => [op.startMs, op.endMs]);
  if (remainder(spans, candidateIntervals).length) throw new Error('File operations escape their candidate windows.');
  sample.timings = Object.fromEntries(observedMetrics.map(metric => [metric,
    duration(sample.operations.filter(op => op.metric === metric).map(op => [op.startMs, op.endMs]))]));
  sample.timings.candidateOtherMs = duration(remainder(candidateIntervals, spans));
  return sample;
}

export function finishFileSample(candidateIntervals) {
  if (!enabled) return;
  const sample = current;
  current = undefined;
  try { return summarizeFileSample(sample, candidateIntervals); }
  catch (error) { error.message += ` ${JSON.stringify(sample)}`; throw error; }
}

// Transform the exact Node module in memory before Saylo is imported; no product instrumentation.
export function registerFileProbe(active) {
  enabled = active;
  let transformed = false;
  if (!active) return { assertTransformed() {}, dispose() {} };
  const target = new URL('../../packages/typegen/dist/catalog-files.js', import.meta.url).href;
  const hooks = registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== target) return loaded;
    let code = String(loaded.source);
    const boundaries = [
      ['await assertInside(root, file);', "await measureFileAsync('pathCheckMs', () => assertInside(root, file));"],
      ['const source = await read();', "const source = await measureFileAsync('fileReadMs', read);"],
    ];
    for (const [before, after] of boundaries) {
      if (code.split(before).length !== 2) throw new Error(`Missing or ambiguous file probe boundary: ${before}`);
      code = code.replace(before, after);
    }
    const parse = /const catalog = (parseCatalog\([^\n]+\));/g;
    if ([...code.matchAll(parse)].length !== 1) throw new Error('Missing or ambiguous catalog parse probe boundary.');
    code = code.replace(parse, (_, expression) => `const catalog = measureFileSync('catalogParseMs', () => ${expression}, { sourceLength: source.length, hasPrevious: previous !== undefined });`);
    transformed = true;
    return { ...loaded, source: `import { measureFileSync, measureFileAsync } from '${import.meta.url}';\n${code}` };
  } });
  return { assertTransformed() { if (!transformed) throw new Error('Catalog file module was not instrumented.'); },
    dispose() { hooks.deregister(); enabled = false; current = undefined; } };
}
