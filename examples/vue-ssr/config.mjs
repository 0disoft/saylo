import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import saylo from '@0disoft/saylo-vite';

export const config = {
  configFile: false, appType: 'custom',
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [vue(), saylo({ localesDir: '../vue/locales', baseLocale: 'ko', initialNamespaces: ['demo'], timeZone: 'UTC' })],
};
