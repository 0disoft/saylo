import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { loadProjectConfig } from '@0disoft/saylo-typegen/config';
import saylo from '@0disoft/saylo-vite';

export default defineConfig({ plugins: [
  sveltekit({ adapter: adapter() }),
  saylo({ ...loadProjectConfig('./saylo.config.json'), maxCachedCatalogs: 6 }),
] });
