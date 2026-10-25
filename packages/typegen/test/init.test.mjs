import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'vite';
import { planInit } from '../dist/init.js';
import { applyInit } from '../dist/init-write.js';
import { connectVite } from '../dist/init-vite.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const cli = fileURLToPath(new URL('../dist/catalog-cli.js', import.meta.url));

async function fixture(t, config = "import { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [], server: { port: 5199 } });\n") {
  const parent = path.join(repository, '.release');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'init-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith('init-test-'));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module', devDependencies: { vite: '8' } }));
  await writeFile(path.join(root, 'vite.config.mjs'), config);
  const run = args => spawnSync(process.execPath, [cli, 'init', ...args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  const snapshot = async () => {
    const files = await readdir(root, { recursive: true, withFileTypes: true });
    return Promise.all(files.filter(file => file.isFile()).map(async file => [
      path.relative(root, path.join(file.parentPath, file.name)), await readFile(path.join(file.parentPath, file.name), 'utf8'),
    ]));
  };
  return { root, run, snapshot };
}

test('init previews exact contents, applies once, and reruns without touching existing app or package files', async t => {
  const f = await fixture(t);
  const before = await f.snapshot();
  const preview = f.run(['--json']);
  assert.equal(preview.status, 0, preview.stderr + preview.stdout);
  const report = JSON.parse(preview.stdout);
  assert.equal(report.dryRun, true);
  assert.equal(report.changes.length, 7);
  assert.match(report.changes.find(file => file.file === 'src/saylo/i18n.ts').after, /createAppI18n/);
  assert.deepEqual(await f.snapshot(), before);
  const applied = f.run(['--apply', '--json']);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  assert.equal(JSON.parse(applied.stdout).writtenFiles.length, 7);
  assert.equal(await readFile(path.join(f.root, 'package.json'), 'utf8'), before.find(([file]) => file === 'package.json')[1]);
  assert.match(await readFile(path.join(f.root, 'vite.config.mjs'), 'utf8'), /port: 5199/);
  const after = await f.snapshot();
  const again = f.run(['--apply', '--json']);
  assert.equal(again.status, 0, again.stderr + again.stdout);
  assert.deepEqual(JSON.parse(again.stdout).writtenFiles, []);
  assert.deepEqual(await f.snapshot(), after);
});

test('init rejects invalid usage, locale, dynamic/ambiguous configs and conflicting integration files before writing', async t => {
  const f = await fixture(t);
  for (const args of [['--apply', '--dry-run'], ['--base-locale', '../ko'], ['--config', 'other.json']]) {
    const before = await f.snapshot();
    assert.equal(f.run(args).status, 2);
    assert.deepEqual(await f.snapshot(), before);
  }
  await writeFile(path.join(f.root, 'saylo.config.json'), '{"user":"keep"}');
  const before = await f.snapshot();
  assert.equal(f.run(['--apply']).status, 2);
  assert.deepEqual(await f.snapshot(), before);
  for (const source of [
    'export default () => ({ plugins: [] })',
    'export default { ...base, plugins: [] }',
    'export default { plugins: getPlugins() }',
    'export default { [key]: true, plugins: [] }',
    'export default { plugins: [], plugins: [] }',
  ]) assert.throws(() => connectVite(source), /init/);
  await rm(path.join(f.root, 'saylo.config.json'));
  await writeFile(path.join(f.root, 'vite.config.ts'), 'export default {}');
  assert.throws(() => planInit(f.root), /exactly one/);
});

test('init keeps aliases, TypeScript, comments and existing plugin order without executing source', () => {
  const source = `import { defineConfig as config } from 'vite';
const neverExecuted = (() => { throw new Error('do not execute'); });
export default config({ plugins: [framework(), /* retain */ custom()], server: { port: 5000 } } satisfies UserConfig);`;
  const patched = connectVite(source);
  assert.match(patched, /plugins: \[__sayloPlugin, framework\(\), \/\* retain \*\/ custom\(\)\]/);
  assert.match(patched, /satisfies UserConfig/);
  assert.equal(connectVite(patched), patched);
  assert.match(connectVite('export default { server: { port: 5000 } }'), /plugins: \[__sayloPlugin\]/);
});

test('init detects an edit after preview, handles cancellation and serializes competing initializers', async t => {
  const f = await fixture(t);
  const plan = planInit(f.root);
  await writeFile(path.join(f.root, 'vite.config.mjs'), 'export default {}');
  await assert.rejects(applyInit(plan), error => {
    assert.match(error.message, /File changed/);
    assert.deepEqual(error.writtenFiles, []);
    return true;
  });
  const next = planInit(f.root);
  await assert.rejects(applyInit(next, AbortSignal.abort(new Error('cancelled'))), /cancelled/);
  const outcomes = await Promise.allSettled([applyInit(next), applyInit(next)]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  assert.match(outcomes.find(outcome => outcome.status === 'rejected').reason.message, /locked/);
  assert.ok(!(await readdir(f.root)).includes('.saylo-init.lock'));
});

test('init refuses linked source directories and never writes into the linked destination', async t => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'linked-destination');
  await mkdir(outside);
  await rm(path.join(f.root, 'src'), { recursive: true });
  await symlink(outside, path.join(f.root, 'src'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => planInit(f.root), /symlink|junction/);
  assert.deepEqual(await readdir(outside), []);
});

test('init selects the existing package manager and canonicalizes locale directories', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
  const plan = planInit(f.root, 'en-us');
  assert.ok(plan.changes.some(change => change.file === 'locales/en-US/saylo.json'));
  assert.match(plan.nextSteps[0], /^pnpm add /);
});

test('an initialized app builds for browser and SSR and isolates request-owned stores', async t => {
  const f = await fixture(t);
  await applyInit(planInit(f.root));
  await writeFile(path.join(f.root, 'index.html'), '<script type="module" src="/src/main.ts"></script>');
  await writeFile(path.join(f.root, 'src/main.ts'), `import { createAppI18n } from './saylo/i18n';
const app = createAppI18n(); document.body.textContent = app.store.getSnapshot().t('saylo:greeting', { name: 'Browser' }); app.dispose();`);
  await build({ root: f.root, logLevel: 'silent', build: { minify: false } });
  const assets = await readdir(path.join(f.root, 'dist/assets'));
  assert.ok(assets.some(file => file.endsWith('.js')));
  await writeFile(path.join(f.root, 'src/server.ts'), `export { createAppI18n } from './saylo/i18n';`);
  await build({ root: f.root, logLevel: 'silent', build: { ssr: 'src/server.ts', outDir: 'server-build', minify: false } });
  const { createAppI18n } = await import(pathToFileURL(path.join(f.root, 'server-build/server.js')).href);
  const first = createAppI18n(), second = createAppI18n();
  assert.notEqual(first.store, second.store);
  assert.equal(first.store.getSnapshot().t('saylo:greeting', { name: 'SSR' }), 'Hello SSR');
  first.dispose();
  assert.equal(second.store.getSnapshot().t('saylo:greeting', { name: 'Second' }), 'Hello Second');
  second.dispose();
});
