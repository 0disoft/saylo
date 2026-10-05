import { fileURLToPath } from 'node:url';
import saylo from '@saylo/vite';

export const config = {
  configFile: false,
  appType: 'custom',
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [saylo({ localesDir: '../vanilla/locales', baseLocale: 'ko', initialNamespaces: ['demo'] })],
};
