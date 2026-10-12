import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const repository = fileURLToPath(new URL('..', import.meta.url));
const exec = promisify(execFile);
assert.ok(process.env.npm_execpath, 'Run with npm run verify:pack:vue');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['npm_config_allow_scripts', 'node_path'].includes(key.toLowerCase())));
const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-vue-pack-'));
const npm = async (args, cwd) => (await exec(process.execPath, [process.env.npm_execpath, ...args],
  { cwd, env, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })).stdout;
try {
  const packs = path.join(root, 'packs'); await mkdir(packs);
  const result = JSON.parse(await npm(['pack', '--workspace=@0disoft/saylo-core', '--workspace=@0disoft/saylo-vue',
    '--ignore-scripts', '--json', '--pack-destination', packs], repository));
  const metadata = Array.isArray(result) ? result : Object.values(result);
  assert.equal(metadata.length, 2);
  const vue = metadata.find(pack => pack.name === '@0disoft/saylo-vue');
  for (const file of ['dist/index.js', 'dist/index.d.ts', 'README.md', 'LICENSE', 'NOTICE'])
    assert.ok(vue.files.some(item => item.path === file), `Vue tarball missing ${file}`);
  const app = path.join(root, 'app'); await mkdir(app);
  const dependencies = Object.fromEntries(metadata.map(pack => [pack.name, `file:${path.join(packs, pack.filename).replaceAll('\\', '/')}`]));
  await writeFile(path.join(app, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: {
    ...dependencies, vue: '3',
  } }));
  await npm(['install', '--workspaces=false', '--ignore-scripts', '--no-audit', '--no-fund'], app);
  for (const file of ['consumer.ts', 'consumer-js.js', 'tsconfig.json'])
    await cp(path.join(repository, 'packages/vue/test', file), path.join(app, file));
  await exec(process.execPath, [path.join(repository, 'node_modules/typescript/lib/tsc.js'), '-p', path.join(app, 'tsconfig.json')],
    { cwd: app, env, windowsHide: true });
  await writeFile(path.join(app, 'ssr.mjs'), `
import assert from 'node:assert/strict';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSayloVue } from '@0disoft/saylo-vue';
const bindings = createSayloVue();
const catalog = (title, locale) => parseCatalog(JSON.stringify({ title }), { locale, namespace: 'demo' });
const run = async locale => {
  const store = createStore({ baseLocale: 'ko', locale, catalogs: [catalog('한국어', 'ko'), catalog('English', 'en')] });
  let subscribed = 0;
  const instance = { ...store, subscribe() { subscribed++; throw new Error('SSR must not subscribe'); } };
  const Child = { setup() { const state = bindings.useI18n(); return () => h('p', state.value.t('demo:title')); } };
  try { const result = await renderToString(createSSRApp({ setup() { bindings.provideI18n(instance); return () => h(Child); } }));
    assert.equal(subscribed, 0); return result;
  } finally { store.dispose(); }
};
assert.deepEqual(await Promise.all([run('ko'), run('en')]), ['<p>한국어</p>', '<p>English</p>']);
console.log('Independent JS/TS Vue tarball and concurrent SSR passed');
`);
  console.log((await exec(process.execPath, [path.join(app, 'ssr.mjs')], { cwd: app, env, windowsHide: true })).stdout.trim());
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('saylo-vue-pack-'));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
