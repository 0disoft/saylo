import { readFile } from 'node:fs/promises';

export const browserMetrics = ['patchMs', 'freezeMs', 'snapshotMs', 'translatorMs', 'signatureMs'];
const virtual = 'virtual:saylo-benchmark/browser-profile';
const resolved = `\0${virtual}`;
const stages = [
  ['packages/vite/dist/catalog-patch.js', 'applyCatalogPatch', 'patchMs'],
  ['packages/vite/dist/freeze.js', 'freezeCatalogs', 'freezeMs'],
  ['packages/core/dist/loading-registry.js', 'createLoadedSnapshot', 'snapshotMs'],
  ['packages/core/dist/translator.js', 'createBoundTranslator', 'translatorMs'],
];

// Benchmark-only Vite transforms; published sources and dist files stay intact.
export function browserStagePlugin(enabled) {
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
      const stage = stages.find(([suffix]) => file.endsWith(`/${suffix}`));
      if (!stage) return;
      const [, name, metric] = stage;
      const declaration = `export function ${name}(`;
      if (!code.includes(declaration)) throw new Error(`Missing browser probe boundary: ${name}`);
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
  };
}
