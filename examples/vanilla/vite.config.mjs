import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import saylo from '@0disoft/saylo-vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko' })],
  build: { outDir: 'dist' },
});
