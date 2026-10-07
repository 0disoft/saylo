import { registerHooks } from 'node:module';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { replyObservedMetrics } from './reply-receipt.mjs';

let current;
export function beginReplySample(selectionAt) {
  if (current || !Number.isFinite(selectionAt) || selectionAt < 0) throw new Error('Invalid or overlapping reply sample.');
  current = { selectionAt, timings: Object.fromEntries(replyObservedMetrics.map(m => [m, 0])),
    calls: Object.fromEntries(replyObservedMetrics.map(m => [m, 0])) };
}
export function measureReplySync(metric, work) {
  if (!current?.inHandler) return work();
  if (!['lookupMs', 'encodeMs', 'sendMs'].includes(metric)) throw new Error('Unknown reply metric.');
  const sample = current, startedAt = performance.now();
  if (metric === 'sendMs') sample.timings.requestToSendMs = startedAt - sample.requestAt;
  try { return work(); }
  finally { sample.timings[metric] += performance.now() - startedAt; sample.calls[metric]++; }
}
export function withCatalogReplyProbe(request, work) {
  if (!current || request?.locale !== 'en-GB' || request.namespace !== 'bench') return work();
  const sample = current;
  if (request.known || sample.requestAt !== undefined) throw new Error('Expected one fresh target catalog request.');
  sample.requestId = request.requestId; sample.generation = request.generation;
  sample.requestAt = performance.now();
  sample.timings.selectionToRequestMs = sample.requestAt - sample.selectionAt;
  sample.inHandler = true;
  try { return work(); }
  finally { sample.timings.handlerMs = performance.now() - sample.requestAt; sample.calls.handlerMs++; sample.inHandler = false; }
}
export function finishReplySample() {
  const sample = current; current = undefined;
  if (!sample || replyObservedMetrics.some(m => sample.calls[m] !== 1)) throw new Error('Incomplete full reply sample.');
  const t = sample.timings;
  const residual = t.handlerMs - t.lookupMs - t.encodeMs - t.sendMs;
  if (!Number.isFinite(residual) || residual < -0.00001) throw new Error('Reply stages exceed handler window.');
  t.handlerOtherMs = Math.max(0, residual);
  return { requestId: sample.requestId, generation: sample.generation, timings: t, calls: sample.calls };
}

export function transformReplyModule(code) {
  const boundaries = [
    ['const requestCatalog = (data, client) => {', 'const requestCatalog = (data, client) => withCatalogReplyProbe(data, () => {'],
    ['    };\n    const onFile =', '    });\n    const onFile ='],
    ["        client.send({ type: 'custom', event: CATALOG_EVENT, data: { request: data,\n                result: encodeCatalogResult(registry.loadDelta(data.locale, data.namespace, data.known)) } });",
      "        const outcome = measureReplySync('lookupMs', () => registry.loadDelta(data.locale, data.namespace, data.known));\n" +
      "        client.send({ type: 'custom', event: CATALOG_EVENT, data: { request: data,\n                result: measureReplySync('encodeMs', () => encodeCatalogResult(outcome)) } });"],
  ];
  let next = code.replaceAll('\r\n', '\n');
  for (const [before, after] of boundaries) {
    if (next.split(before).length !== 2) throw new Error('Missing or ambiguous server reply probe boundary.');
    next = next.replace(before, after);
  }
  return `import { withCatalogReplyProbe, measureReplySync } from '${import.meta.url}';\n${next}`;
}
export function registerReplyProbe(active) {
  if (!active) return { assertTransformed() {}, dispose() {} };
  let transformed = false;
  const target = new URL('../../packages/vite/dist/index.js', import.meta.url).href;
  const hooks = registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== target) return loaded;
    const source = transformReplyModule(String(loaded.source)); transformed = true;
    return { ...loaded, source };
  } });
  return { assertTransformed() { if (!transformed) throw new Error('Missing server reply module transform.'); },
    dispose() { hooks.deregister(); current = undefined; } };
}

const virtual = 'virtual:saylo-benchmark/reply-profile', resolved = `\0${virtual}`;
export function replyReceiptPlugin(active) {
  return { name: 'saylo-benchmark-reply-receipt', resolveId(id) { if (id === virtual) return resolved; },
    async load(id) {
      if (id !== resolved) return;
      return `export const replyStagesEnabled = ${Boolean(active)};\n` + (active
        ? await readFile(new URL('./reply-receipt.mjs', import.meta.url), 'utf8')
        : 'export const captureReplyReceipt = () => {}; export const finishReplyReceipt = () => undefined;');
    } };
}
