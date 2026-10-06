import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import saylo from '@0disoft/saylo-vite';

export function createDemoConfig({ astRuntime = true } = {}) {
  return defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [saylo({ localesDir: '../vanilla/locales', baseLocale: 'ko', astRuntime, initialNamespaces: ['demo'], typegen: { outFile: 'generated.d.ts' } })],
    build: { outDir: 'dist' },
  });
}

export default createDemoConfig();
