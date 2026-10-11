import { readFileSync } from 'node:fs';
import { defineConfig, version } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import saylo from '@0disoft/saylo-vite';

/** @param {string} id */
const packageVersion = id => JSON.parse(readFileSync(new URL(`./node_modules/@0disoft/saylo-${id}/package.json`, import.meta.url), 'utf8')).version;

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() }), saylo({
    localesDir: 'locales', baseLocale: 'ko', initialNamespaces: ['demo'], timeZone: 'UTC',
    typegen: { outFile: 'src/lib/generated.d.ts' },
  })],
  define: { __SAYLO_SUPPORT_ENV__: JSON.stringify({ runtime: 'browser', node: process.versions.node, vite: version,
    sayloCore: packageVersion('core'), sayloVite: packageVersion('vite'), sayloSvelte: packageVersion('svelte'),
  }) },
});
