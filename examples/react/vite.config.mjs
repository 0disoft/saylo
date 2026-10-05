import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import saylo from '@saylo/vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [saylo({ localesDir: '../vanilla/locales', baseLocale: 'ko', typegen: { outFile: 'generated.d.ts' } })],
  build: { outDir: 'dist' },
});
