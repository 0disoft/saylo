import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import saylo from '@0disoft/saylo-vite';
import { supportEnvironment } from '../shared/support-environment.mjs';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [vue(), saylo({ localesDir: 'locales', baseLocale: 'ko', initialNamespaces: ['demo'], timeZone: 'UTC',
    typegen: { outFile: 'generated.d.ts' } })],
  define: { __SAYLO_SUPPORT_ENV__: JSON.stringify(supportEnvironment('vue')) },
  server: { port: 5192, strictPort: true },
  build: { outDir: 'dist' },
});
