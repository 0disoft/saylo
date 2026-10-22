import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig, version } from 'vite';
import saylo, { loadProjectConfig } from '@0disoft/saylo-vite';
import { demoKeys } from './selected-keys.mjs';

export function createDemoConfig({ astRuntime = true, includeKeys, outDir = 'dist' } = {}) {
  return defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [saylo({ ...loadProjectConfig(fileURLToPath(new URL('./saylo.config.json', import.meta.url))), astRuntime, includeKeys })],
    define: { __SAYLO_SUPPORT_ENV__: JSON.stringify({ runtime: 'browser', node: process.versions.node, vite: version,
      sayloCore: JSON.parse(readFileSync(new URL('../../packages/core/package.json', import.meta.url), 'utf8')).version,
      sayloVite: JSON.parse(readFileSync(new URL('../../packages/vite/package.json', import.meta.url), 'utf8')).version,
    }) },
    build: { outDir },
  });
}

export default defineConfig(({ mode }) => createDemoConfig({
  includeKeys: mode === 'selected' ? demoKeys : undefined,
  outDir: mode === 'selected' ? 'dist-selected' : 'dist',
}));
