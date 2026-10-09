import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { build } from 'vite';
import saylo from '@0disoft/saylo-vite';

// Use the plugin defaults; a consumer noExternal override would hide the deployment bug.
const result = await build({ configFile: false, root: process.cwd(), logLevel: 'silent',
  plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', initialNamespaces: ['demo'] })],
  build: { ssr: 'ssr-entry.mjs', outDir: 'dist-ssr', minify: false,
    rolldownOptions: { preserveEntrySignatures: 'strict' } } });
const chunks = result.output.filter(output => output.type === 'chunk');
assert.ok(chunks.some(chunk => chunk.isDynamicEntry), 'SSR must exercise a lazy locale chunk.');
for (const chunk of chunks) assert.ok(!chunk.imports.some(id => id.startsWith('@0disoft/saylo-vite')),
  'Production SSR must not import the development-only plugin package.');
await writeFile('ssr-output.json', JSON.stringify({ entry: chunks.find(chunk => chunk.isEntry).fileName }));
console.log('[pack] Default SSR build contains its catalog client runtime.');
