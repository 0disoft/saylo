import { readFile } from 'node:fs/promises';

export const browserMetrics = ['patchMs', 'freezeMs', 'snapshotMs', 'translatorMs', 'signatureMs'];
export const localeBrowserMetrics = ['decodeMs', 'freezeMs', 'snapshotMs', 'translatorMs', 'signatureMs'];
export const localeBrowserReportedMetrics = [...localeBrowserMetrics, 'snapshotOtherMs', 'selectionOtherMs'];

export function validateLocaleBrowserStages(sample, elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || !sample ||
      localeBrowserReportedMetrics.some(metric => !Number.isFinite(sample.timings?.[metric]) || sample.timings[metric] < 0) ||
      localeBrowserMetrics.some(metric => !Number.isSafeInteger(sample.calls?.[metric]) || sample.calls[metric] < 1))
    throw new Error('Invalid locale browser stage timings.');
  const { timings: t } = sample;
  const residuals = [
    [t.snapshotMs - t.translatorMs - t.signatureMs, t.snapshotOtherMs],
    [elapsedMs - t.decodeMs - t.freezeMs - t.snapshotMs, t.selectionOtherMs],
  ];
  if (residuals.some(([expected, actual]) => expected < -0.00001 || Math.abs(expected - actual) > 0.00001))
    throw new Error('Invalid nested locale browser stage residuals.');
}
const virtual = 'virtual:saylo-benchmark/browser-profile';
const resolved = `\0${virtual}`;
const stages = [
  ['packages/vite/dist/catalog-patch.js', 'applyCatalogPatch', 'patchMs'],
  ['packages/vite/dist/freeze.js', 'freezeCatalogs', 'freezeMs'],
  ['packages/core/dist/loading-registry.js', 'createLoadedSnapshot', 'snapshotMs'],
  ['packages/core/dist/translator.js', 'createBoundTranslator', 'translatorMs'],
];

// Benchmark-only Vite transforms; published sources and dist files stay intact.
export function browserStagePlugin(enabled, mode = 'edit') {
  if (!['edit', 'locale-add'].includes(mode)) throw new Error('Unknown browser stage mode.');
  const selected = mode === 'locale-add' ? [
    ['packages/vite/dist/catalog-wire.js', 'decodeCatalogResult', 'decodeMs'],
    ...stages.slice(1),
  ] : stages;
  const transformed = new Set();
  return {
    name: 'saylo-benchmark-browser-stages', enforce: 'pre',
    resolveId(id) { if (id === virtual) return resolved; },
    async load(id) {
      if (id !== resolved) return;
      return enabled ? readFile(new URL('./browser-probe.mjs', import.meta.url), 'utf8')
        : 'export const beginBrowserSample = () => {}; export const finishBrowserSample = () => undefined;';
    },
    transform(code, id) {
      if (!enabled) return;
      const file = id.split('?')[0].replaceAll('\\', '/');
      const stage = selected.find(([suffix]) => file.endsWith(`/${suffix}`));
      if (!stage) return;
      const [, name, metric] = stage;
      const declaration = `export function ${name}(`;
      if (code.split(declaration).length !== 2) throw new Error(`Missing or ambiguous browser probe boundary: ${name}`);
      let next = code.replace(declaration, `function __bench_${name}(`);
      if (metric === 'snapshotMs') {
        const signature = /const signature = ([\s\S]*?);\r?\n/;
        if (!signature.test(next)) throw new Error('Missing browser signature probe boundary.');
        next = next.replace(signature, (_, expression) => `const signature = measureBrowserStage('signatureMs', () => (${expression}));\n`);
      }
      transformed.add(metric);
      return { code: `import { measureBrowserStage } from '${virtual}';\n${next}\n` +
        `export function ${name}(...args) { return measureBrowserStage('${metric}', () => __bench_${name}(...args)); }\n`, map: null };
    },
    transformed,
    assertTransformed() {
      if (enabled && selected.some(([, , metric]) => !transformed.has(metric)))
        throw new Error('Incomplete browser stage transforms.');
    },
  };
}
