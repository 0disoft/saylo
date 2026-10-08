import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import saylo from '@0disoft/saylo-vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [svelte(), saylo({ localesDir: 'locales', baseLocale: 'ko', initialNamespaces: ['demo'], timeZone: 'UTC',
    typegen: { outFile: 'generated.d.ts' } })],
  server: { port: 5190, strictPort: true },
  build: { outDir: 'dist' },
});
