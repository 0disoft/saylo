import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const repository = fileURLToPath(new URL('..', import.meta.url));
const templates = {
  react: ['style.css', 'main.tsx', 'App.tsx'],
  svelte: ['style.css', 'main.ts', 'App.svelte', 'SelectedLocale.svelte'],
  vue: ['main.ts', 'App.vue'],
};
export async function prepareLocalStarter(framework, destination) {
  assert.ok(Object.hasOwn(templates, framework), 'Choose a supported local starter framework.');
  const root = path.resolve(destination);
  let ancestor = root, physical;
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
  assert.ok(npmCli, `Run with npm run prepare:starter:${framework}.`);
  await mkdir(root, { recursive: true });
  const files = ['.gitignore', 'package.json', 'vite.config.mjs', 'tsconfig.json', 'index.html',
    'i18n.ts', 'demo-messages.ts', 'README.md', 'locales', ...templates[framework]];
  for (const file of files) await cp(path.join(repository, `examples/${framework}-starter`, file), path.join(root, file), { recursive: true });
  const vendor = path.join(root, 'vendor'); await mkdir(vendor);
  const names = ['core', framework, 'vite', 'typegen'];
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !['npm_config_allow_scripts', 'node_path'].includes(key.toLowerCase())));
  const { stdout } = await promisify(execFile)(process.execPath, [npmCli, 'pack',
    ...names.map(name => `--workspace=@0disoft/saylo-${name}`), '--ignore-scripts', '--json', '--pack-destination', vendor],
  { cwd: repository, env, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  const raw = JSON.parse(stdout), packs = Array.isArray(raw) ? raw : Object.values(raw);
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
  await writeFile(path.join(vendor, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { framework: { type: 'string' }, 'out-dir': { type: 'string' } } });
  assert.ok(values['out-dir'], 'Pass --out-dir <empty-directory-outside-Saylo>.');
  const manifest = await prepareLocalStarter(values.framework, values['out-dir']);
  console.log(JSON.stringify({ destination: path.resolve(values['out-dir']), ...manifest }, null, 2));
}
