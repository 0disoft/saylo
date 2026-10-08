import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import saylo from '@0disoft/saylo-vite';

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() }), saylo({
    localesDir: 'locales', baseLocale: 'ko', initialNamespaces: ['demo'], timeZone: 'UTC',
    typegen: { outFile: 'src/lib/generated.d.ts' },
  })],
});
