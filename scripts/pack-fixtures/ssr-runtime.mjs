import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

for (const name of ['@0disoft/saylo-vite', '@0disoft/saylo-typegen', 'vite'])
  await assert.rejects(access(`node_modules/${name}`), { code: 'ENOENT' });
const { entry } = JSON.parse(await readFile('ssr-output.json', 'utf8'));
const { render } = await import(`./dist-ssr/${entry}`);
assert.deepEqual(await Promise.all([render('ko'), render('en')]), ['안녕 SSR', 'Hello SSR']);
console.log('[pack] SSR imports and renders two locales after development dependencies are removed.');
