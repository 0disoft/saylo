import { registerHooks } from 'node:module';
import { performance } from 'node:perf_hooks';

export const fileMetrics = ['pathCheckMs', 'fileReadMs', 'catalogParseMs', 'candidateOtherMs'];
const observedMetrics = fileMetrics.slice(0, -1);
let enabled = false;
let current;

export function measureFileSync(metric, work) {
  const sample = current;
  if (!sample) return work();
  const startedAt = performance.now();
  try { return work(); }
  finally { sample.timings[metric] += performance.now() - startedAt; sample.calls[metric]++; }
}

export async function measureFileAsync(metric, work) {
  const sample = current;
  if (!sample) return work();
  const startedAt = performance.now();
  try { return await work(); }
  finally { sample.timings[metric] += performance.now() - startedAt; sample.calls[metric]++; }
}

export function beginFileSample() {
  if (enabled) current = { timings: Object.fromEntries(observedMetrics.map(metric => [metric, 0])),
    calls: Object.fromEntries(observedMetrics.map(metric => [metric, 0])) };
}

export function finishFileSample(candidateMs) {
  if (!enabled) return;
  const sample = current;
  current = undefined;
  if (!sample || observedMetrics.some(metric => sample.calls[metric] !== 1))
    throw new Error('Expected exactly one catalog path check, read and parse per edit.');
  const accountedMs = observedMetrics.reduce((total, metric) => total + sample.timings[metric], 0);
  const residual = candidateMs - accountedMs;
  if (!Number.isFinite(residual) || residual < 0) throw new Error('File timings exceed their candidate window.');
  sample.timings.candidateOtherMs = residual;
  return sample;
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
    code = code.replace(parse, (_, expression) => `const catalog = measureFileSync('catalogParseMs', () => ${expression});`);
    transformed = true;
    return { ...loaded, source: `import { measureFileSync, measureFileAsync } from '${import.meta.url}';\n${code}` };
  } });
  return { assertTransformed() { if (!transformed) throw new Error('Catalog file module was not instrumented.'); },
    dispose() { hooks.deregister(); enabled = false; current = undefined; } };
}
