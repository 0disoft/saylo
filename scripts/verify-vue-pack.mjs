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
  for (const file of ['dist/index.js', 'dist/index.d.ts', 'dist/rich-text.js', 'dist/rich-text.d.ts', 'README.md', 'LICENSE', 'NOTICE'])
    assert.ok(vue.files.some(item => item.path === file), `Vue tarball missing ${file}`);
  const app = path.join(root, 'app'); await mkdir(app);
  const dependencies = Object.fromEntries(metadata.map(pack => [pack.name, `file:${path.join(packs, pack.filename).replaceAll('\\', '/')}`]));
  await writeFile(path.join(app, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: {
    ...dependencies, vue: '3',
  } }));
  await npm(['install', '--workspaces=false', '--ignore-scripts', '--no-audit', '--no-fund'], app);
  const installed = JSON.parse(await readFile(path.join(app, 'node_modules/@0disoft/saylo-vue/package.json'), 'utf8'));
  assert.equal(installed.private, undefined);
  assert.equal(installed.version, metadata.find(pack => pack.name === '@0disoft/saylo-core').version);
  assert.equal(installed.dependencies['@0disoft/saylo-core'], installed.version);
  assert.equal(installed.publishConfig.access, 'public');
  assert.equal(installed.publishConfig.tag, 'latest');
  assert.equal(installed.publishConfig.registry, 'https://registry.npmjs.org/');
  assert.equal(installed.homepage, 'https://www.npmjs.com/package/@0disoft/saylo-vue');
  assert.ok(installed.keywords.includes('vue'));
  for (const file of ['consumer-js.js', 'tsconfig.json'])
    await cp(path.join(repository, 'packages/vue/test', file), path.join(app, file));
  const consumer = await readFile(path.join(repository, 'packages/vue/test/consumer.ts'), 'utf8');
  await writeFile(path.join(app, 'consumer.ts'), consumer.replace('../../typegen/test/rich-generated.js', './rich-generated.js'));
  await cp(path.join(repository, 'packages/typegen/test/rich-generated.d.ts'), path.join(app, 'rich-generated.d.ts'));
  await exec(process.execPath, [path.join(repository, 'node_modules/typescript/lib/tsc.js'), '-p', path.join(app, 'tsconfig.json')],
    { cwd: app, env, windowsHide: true });
  await cp(path.join(repository, 'scripts/pack-fixtures/vue-smoke.mjs'), path.join(app, 'ssr.mjs'));
  console.log((await exec(process.execPath, [path.join(app, 'ssr.mjs')], { cwd: app, env, windowsHide: true })).stdout.trim());
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('saylo-vue-pack-'));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
