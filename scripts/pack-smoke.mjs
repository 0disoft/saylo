import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
const fixtures = fileURLToPath(new URL('./pack-fixtures/', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this smoke with npm run verify:pack.');
const exec = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-pack-'));
const packs = path.join(root, 'packs');
const majors = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8')).devDependencies;
const packages = Object.fromEntries(['core', 'react', 'typegen', 'vite'].map(id => [`@0disoft/saylo-${id}`, id]));
const names = Object.keys(packages);
// npm run can export .npmrc allow-scripts as an env override, which newer npm
// rejects for project installs. Install scripts are disabled explicitly below.
const childEnv = { ...Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => key.toLowerCase() !== 'npm_config_allow_scripts')), NODE_PATH: '' };
function inside(directory, target) {
  const relative = path.relative(directory, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
async function npm(args, cwd) {
  try {
    const result = await exec(process.execPath, [npmCli, ...args], { cwd, windowsHide: true,
      env: childEnv, maxBuffer: 4 * 1024 * 1024 });
    return result.stdout;
  } catch (error) {
    throw new Error(`npm ${args.join(' ')} failed in ${path.basename(cwd)}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, { cause: error });
  }
}
try {
  assert.ok(!inside(repository, root), 'Consumer must live outside the repository.');
  await mkdir(packs);
  const metadata = JSON.parse(await npm(['pack', '--workspaces', '--ignore-scripts', '--json', '--pack-destination', packs], repository));
  const packed = Array.isArray(metadata) ? metadata : Object.values(metadata);
  assert.deepEqual(packed.map(pack => pack.name).sort(), [...names].sort());
  for (const pack of packed) {
    const directory = path.join(repository, 'packages', packages[pack.name]);
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const files = new Set(pack.files.map(file => file.path));
    for (const target of [...Object.values(manifest.exports).flatMap(entry => Object.values(entry)), ...Object.values(manifest.bin ?? {})])
      assert.ok(files.has(target.replace(/^\.\//, '')), `${pack.name} is missing ${target}`);
    console.log(`[pack] ${pack.name}: ${pack.files.length} files, ${pack.size} bytes`);
  }
  for (const language of ['js', 'ts']) {
    const app = path.join(root, language);
    await cp(path.join(fixtures, 'shared'), app, { recursive: true });
    await cp(path.join(fixtures, language), path.join(app, 'src'), { recursive: true });
    await writeFile(path.join(app, 'index.html'), `<html><body><div id="app"></div><script type="module" src="/src/main.${language}"></script></body></html>\n`);
    await writeFile(path.join(app, 'package.json'), JSON.stringify({ name: `saylo-packed-${language}`, private: true, type: 'module',
      scripts: { typegen: 'saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts',
        typecheck: 'tsc -p tsconfig.json', build: 'vite build' },
      dependencies: { ...Object.fromEntries(packed.map(pack => [pack.name, `file:../packs/${pack.filename}`])),
        react: majors.react, 'react-dom': majors['react-dom'] },
      devDependencies: Object.fromEntries(['typescript', 'vite', '@types/node', '@types/react', '@types/react-dom'].map(name => [name, majors[name]])) }, null, 2));
    await writeFile(path.join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022',
      module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2022', 'DOM'], strict: true,
      allowJs: true, checkJs: true, noEmit: true, types: ['node', 'vite/client', '@0disoft/saylo-vite/virtual'] },
      include: [`src/**/*.${language}`, 'generated.d.ts', 'vite.config.mjs'] }, null, 2));
    console.log(`[pack] ${language}: installing tarballs and declared peer/tool major ranges outside the workspace`);
    await npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--workspaces=false'], app);
    for (const name of names) {
      const installed = path.join(app, 'node_modules', name);
      assert.equal((await lstat(installed)).isSymbolicLink(), false, `${name} is a workspace link`);
      assert.ok(inside(await realpath(app), await realpath(installed)), `${name} escaped the consumer`);
    }
    console.log((await npm(['run', 'typegen'], app)).trim());
    assert.match(await readFile(path.join(app, 'generated.d.ts'), 'utf8'), /"demo:items": \{ "count": number;/);
    await npm(['run', 'typecheck'], app);
    const smoke = await exec(process.execPath, ['smoke.mjs'], { cwd: app, windowsHide: true, env: childEnv });
    console.log(smoke.stdout.trim());
    console.log((await npm(['run', 'build'], app)).trim());
    const bundle = JSON.parse(await readFile(path.join(app, 'dist/.vite/manifest.json'), 'utf8'));
    assert.ok(Object.values(bundle).some(entry => entry.isDynamicEntry), 'Lazy translation chunk was not emitted.');
    console.log(`[pack] ${language}: CLI, ${language === 'js' ? 'checkJs' : 'TypeScript'}, runtime/React SSR, Vite lazy build passed`);
  }
  console.log('[pack] All four packed packages passed independent JS and TS consumption.');
} finally {
  const resolved = path.resolve(root);
  const temporaryParent = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== temporaryParent || !path.basename(resolved).startsWith('saylo-pack-')) throw new Error('Unsafe pack smoke cleanup path.');
  await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
