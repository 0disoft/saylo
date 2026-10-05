import { defineConfig } from 'vite';
import saylo from '@saylo/vite';

export default defineConfig({
  plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', initialNamespaces: ['demo'] })],
  build: { manifest: true },
});
