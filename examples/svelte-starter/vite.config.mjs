import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import saylo from '@0disoft/saylo-vite';

export default defineConfig({
  plugins: [svelte(), saylo({ localesDir: 'locales', baseLocale: 'ko', initialLocale: 'en',
    initialNamespaces: ['demo'], timeZone: 'UTC', typegen: { outFile: 'generated.d.ts' } })],
  server: { host: '127.0.0.1', port: 5199, strictPort: true },
  preview: { host: '127.0.0.1', port: 5200, strictPort: true },
});
