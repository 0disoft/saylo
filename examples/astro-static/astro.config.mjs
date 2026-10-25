import { defineConfig } from 'astro/config';
import { loadProjectConfig } from '@0disoft/saylo-typegen/config';
import saylo from '@0disoft/saylo-vite';

export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  vite: { plugins: [saylo({ ...loadProjectConfig('./saylo.config.json'), maxCachedCatalogs: 6 })] },
});
