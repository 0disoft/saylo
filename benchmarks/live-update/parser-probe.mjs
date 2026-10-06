import { registerHooks } from 'node:module';
import { performance } from 'node:perf_hooks';

export const parserMetrics = ['jsonMs', 'strictJsonMs', 'tokenScanMs', 'positionIndexMs', 'messageLoopMs', 'freezeMs'];
let current;
export function measureParserStage(metric, work) {
  const sample = current;
  if (!sample) return work();
  const start = performance.now();
  try { return work(); }
  finally { sample[metric] += performance.now() - start; }
}
export function parserClock() { return performance.now(); }
export function recordParserStage(metric, start) { if (current) current[metric] += performance.now() - start; }
export function beginParserSample() { current = Object.fromEntries(parserMetrics.map(metric => [metric, 0])); }
export function finishParserSample() { const sample = current; current = undefined; return sample; }

export function registerParserProbe() {
  const catalog = new URL('../../packages/core/dist/catalog.js', import.meta.url).href;
  const json = new URL('../../packages/core/dist/json.js', import.meta.url).href;
  const transformed = new Set();
  const hooks = registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== catalog && url !== json) return loaded;
    let source = String(loaded.source);
    const changes = url === catalog ? [
      ['const entries = readJson(source, context);', "const entries = measureParserStage('jsonMs', () => readJson(source, context));"],
      ['const positionAt = createPositionLocator(source);', "const positionAt = measureParserStage('positionIndexMs', () => createPositionLocator(source));"],
      ['for (const entry of entries) {', 'const __loopStart = parserClock();\nfor (const entry of entries) {'],
      ['if (diagnostics.length)', "recordParserStage('messageLoopMs', __loopStart);\nif (diagnostics.length)"],
      ['return freeze({ ...context, messages });', "return measureParserStage('freezeMs', () => freeze({ ...context, messages }));"],
    ] : [
      ['object = JSON.parse(source);', "object = measureParserStage('strictJsonMs', () => JSON.parse(source));"],
      ['const entries = [];', 'const __tokensStart = parserClock();\nconst entries = [];'],
      ['if (diagnostics.length)', "recordParserStage('tokenScanMs', __tokensStart);\nif (diagnostics.length)"],
    ];
    for (const [before, after] of changes) {
      if (source.split(before).length !== 2) throw new Error(`Missing or ambiguous parser probe boundary: ${before}`);
      source = source.replace(before, after);
    }
    transformed.add(url);
    return { ...loaded, source: `import { measureParserStage, parserClock, recordParserStage } from '${import.meta.url}';\n${source}` };
  } });
  return { assertTransformed() { if (transformed.size !== 2) throw new Error('Incomplete parser transforms.'); }, dispose: () => hooks.deregister() };
}
