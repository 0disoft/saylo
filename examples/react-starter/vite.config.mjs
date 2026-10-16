import { defineConfig } from 'vite';
import saylo from '@0disoft/saylo-vite';

export default defineConfig({
  plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', initialLocale: 'en',
    initialNamespaces: ['demo'], timeZone: 'UTC', typegen: { outFile: 'generated.d.ts' } })],
  server: { host: '127.0.0.1', port: 5197, strictPort: true },
  preview: { host: '127.0.0.1', port: 5198, strictPort: true },
});
