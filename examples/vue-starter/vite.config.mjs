import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import saylo from '@0disoft/saylo-vite';

export default defineConfig({
  plugins: [vue(), saylo({ localesDir: 'locales', baseLocale: 'ko', initialLocale: 'en',
    initialNamespaces: ['demo'], timeZone: 'UTC', typegen: { outFile: 'generated.d.ts' } })],
  server: { host: '127.0.0.1', port: 5195, strictPort: true },
  preview: { host: '127.0.0.1', port: 5196, strictPort: true },
});
