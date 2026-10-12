import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const repository = fileURLToPath(new URL('..', import.meta.url));
export async function prepareVueStarter(destination) {
  const root = path.resolve(destination);
  let ancestor = root;
  let physical;
  while (!physical) {
    try { physical = path.resolve(await realpath(ancestor), path.relative(ancestor, root)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      assert.notEqual(parent, ancestor, 'Destination has no existing parent.');
      ancestor = parent;
    }
  }
  const relative = path.relative(await realpath(repository), physical);
  assert.ok(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'Choose a directory outside the Saylo repository.');
  let entries;
  try { entries = await readdir(root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.ok(!entries?.length, 'Destination must be empty; existing files will not be overwritten.');
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'Run with npm run prepare:starter:vue -- --out-dir <empty-directory>.');
  await mkdir(root, { recursive: true });
  const template = path.join(repository, 'examples/vue-starter');
  // Copy only authored inputs, even if the template has local build/install output.
  for (const name of ['.gitignore', 'package.json', 'vite.config.mjs', 'tsconfig.json', 'index.html',
    'main.ts', 'i18n.ts', 'App.vue', 'demo-messages.ts', 'README.md', 'locales'])
    await cp(path.join(template, name), path.join(root, name), { recursive: true });
  const vendor = path.join(root, 'vendor'); await mkdir(vendor);
  const names = ['core', 'vue', 'vite', 'typegen'];
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !['npm_config_allow_scripts', 'node_path'].includes(key.toLowerCase())));
  const result = await promisify(execFile)(process.execPath, [npmCli, 'pack',
    ...names.map(name => `--workspace=@0disoft/saylo-${name}`), '--ignore-scripts', '--json', '--pack-destination', vendor],
  { cwd: repository, env, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  const raw = JSON.parse(result.stdout);
  const packs = Array.isArray(raw) ? raw : Object.values(raw);
  assert.equal(packs.length, names.length);
  for (const name of names) {
    const pack = packs.find(value => value.name === `@0disoft/saylo-${name}`);
    assert.ok(pack && path.basename(pack.filename) === pack.filename, `Missing safe ${name} tarball`);
    await rename(path.join(vendor, pack.filename), path.join(vendor, `saylo-${name}.tgz`));
  }
  const manifest = { source: 'local-unpublished', packages: packs.map(pack => ({
    name: pack.name, version: pack.version, integrity: pack.integrity,
    file: `vendor/saylo-${pack.name.slice('@0disoft/saylo-'.length)}.tgz`,
  })) };
  await writeFile(path.join(root, 'vendor/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { 'out-dir': { type: 'string' } } });
  assert.ok(values['out-dir'], 'Pass --out-dir <empty-directory-outside-Saylo>.');
  const manifest = await prepareVueStarter(values['out-dir']);
  console.log(JSON.stringify({ destination: path.resolve(values['out-dir']), ...manifest }, null, 2));
}
