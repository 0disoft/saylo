import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import saylo from '@0disoft/saylo-vite';
import { supportEnvironment } from '../shared/support-environment.mjs';
import { demoKeys } from './selected-keys.mts';

export function createDemoConfig({ astRuntime = true, includeKeys, outDir = 'dist' } = {}) {
  return defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [saylo({ localesDir: '../vanilla/locales', baseLocale: 'ko', astRuntime, includeKeys, initialNamespaces: ['demo'], typegen: { outFile: 'generated.d.ts' } })],
    define: { __SAYLO_SUPPORT_ENV__: JSON.stringify(supportEnvironment('react')) },
    build: { outDir },
  });
}

export default defineConfig(({ mode }) => createDemoConfig({
  includeKeys: mode === 'selected' ? demoKeys : undefined,
  outDir: mode === 'selected' ? 'dist-selected' : 'dist',
}));
