import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig, version } from 'vite';
import saylo from '@0disoft/saylo-vite';

export function createDemoConfig({ astRuntime = true } = {}) {
  return defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', astRuntime })],
    define: { __SAYLO_SUPPORT_ENV__: JSON.stringify({ runtime: 'browser', node: process.versions.node, vite: version,
      sayloCore: JSON.parse(readFileSync(new URL('../../packages/core/package.json', import.meta.url), 'utf8')).version,
      sayloVite: JSON.parse(readFileSync(new URL('../../packages/vite/package.json', import.meta.url), 'utf8')).version,
    }) },
    build: { outDir: 'dist' },
  });
}

export default createDemoConfig();
