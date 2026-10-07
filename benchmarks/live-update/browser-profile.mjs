import { readFile } from 'node:fs/promises';

export const browserMetrics = ['patchMs', 'freezeMs', 'snapshotMs', 'translatorMs', 'signatureMs'];
export const localeBrowserMetrics = ['decodeMs', 'freezeMs', 'acceptMs', 'acceptCheckMs', 'acceptFreezeMs', 'snapshotMs', 'translatorMs', 'signatureMs'];
export const localeBrowserReportedMetrics = [...localeBrowserMetrics, 'acceptOtherMs', 'snapshotOtherMs', 'selectionOtherMs'];

export function validateLocaleBrowserStages(sample, elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || !sample ||
      localeBrowserReportedMetrics.some(metric => !Number.isFinite(sample.timings?.[metric]) || sample.timings[metric] < 0) ||
      localeBrowserMetrics.some(metric => !Number.isSafeInteger(sample.calls?.[metric]) || sample.calls[metric] < 1))
    throw new Error('Invalid locale browser stage timings.');
  const { timings: t } = sample;
  const residuals = [
    [t.acceptMs - t.acceptCheckMs - t.acceptFreezeMs, t.acceptOtherMs],
    [t.snapshotMs - t.translatorMs - t.signatureMs, t.snapshotOtherMs],
    [elapsedMs - t.decodeMs - t.freezeMs - t.acceptMs - t.snapshotMs, t.selectionOtherMs],
  ];
  if (sample.calls.acceptCheckMs !== sample.calls.acceptMs || sample.calls.acceptFreezeMs !== sample.calls.acceptMs)
    throw new Error('Incomplete locale outcome acceptance observations.');
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
    ['packages/core/dist/loading-registry.js', 'acceptOutcome', 'acceptMs'],
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
      const matches = selected.filter(([suffix]) => file.endsWith(`/${suffix}`));
      if (!matches.length) return;
      let next = code;
      const completed = [];
      for (const [, name, metric] of matches) {
        const declaration = `export function ${name}(`;
        if (next.split(declaration).length !== 2) throw new Error(`Missing or ambiguous browser probe boundary: ${name}`);
        next = next.replace(declaration, `function __bench_${name}(`);
        if (metric === 'snapshotMs') {
          const signature = /const signature = ([\s\S]*?);\r?\n/;
          if (!signature.test(next)) throw new Error('Missing browser signature probe boundary.');
          next = next.replace(signature, (_, expression) => `const signature = measureBrowserStage('signatureMs', () => (${expression}));\n`);
        } else if (metric === 'acceptMs') {
          // Restrict the split to this function and fail if its built shape changes.
          const acceptance = /function __bench_acceptOutcome\(manifest, key, outcome\) \{\r?\n([\s\S]*?)    return freeze\(\{ \.\.\.outcome, key: \{ \.\.\.key \} \}\);\r?\n\}/g;
          if ([...next.matchAll(acceptance)].length !== 1) throw new Error('Missing or ambiguous outcome acceptance split.');
          next = next.replace(acceptance, (_, checks) => `function __bench_acceptOutcome(manifest, key, outcome) {\n` +
            `    measureBrowserStage('acceptCheckMs', () => {\n${checks}    });\n` +
            `    return measureBrowserStage('acceptFreezeMs', () => freeze({ ...outcome, key: { ...key } }));\n}`);
        }
        next += `\nexport function ${name}(...args) { return measureBrowserStage('${metric}', () => __bench_${name}(...args)); }\n`;
        completed.push(metric);
      }
      completed.forEach(metric => transformed.add(metric));
      return { code: `import { measureBrowserStage } from '${virtual}';\n${next}\n`, map: null };
    },
    transformed,
    assertTransformed() {
      if (enabled && selected.some(([, , metric]) => !transformed.has(metric)))
        throw new Error('Incomplete browser stage transforms.');
    },
  };
}
