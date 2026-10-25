// Uses the already-installed SvelteKit example toolchain; no dependency installation or server subprocess.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { planInit } from '../packages/typegen/dist/init.js';
import { applyInit } from '../packages/typegen/dist/init-write.js';

const repository = fileURLToPath(new URL('..', import.meta.url));
const initialDirectory = process.cwd();
const parent = path.join(repository, '.release');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(path.join(parent, 'init-kit-'));
let server;
let browser;
let devServer;
const links = [];
const run = (file, args) => execFileSync(process.execPath, [path.join(root, 'node_modules', file), ...args],
  { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
try {
  await mkdir(path.join(root, 'src/routes'), { recursive: true });
  const dependencies = path.join(repository, 'examples/sveltekit/node_modules');
  await mkdir(path.join(root, 'node_modules/@0disoft'), { recursive: true });
  const link = async (target, destination) => {
    await symlink(target, destination, process.platform === 'win32' ? 'junction' : 'dir');
    links.push(destination);
  };
  for (const entry of await readdir(dependencies, { withFileTypes: true })) {
    if (entry.isDirectory() && !['@0disoft', '$app'].includes(entry.name) && !entry.name.startsWith('.'))
      await link(path.join(dependencies, entry.name), path.join(root, 'node_modules', entry.name));
  }
  for (const id of ['core', 'svelte', 'typegen', 'vite'])
    await link(path.join(repository, 'packages', id), path.join(root, 'node_modules/@0disoft', `saylo-${id}`));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module', devDependencies: {
    vite: '8', svelte: '5', '@sveltejs/kit': '3', '@sveltejs/adapter-node': '6' } }));
  await writeFile(path.join(root, 'vite.config.mjs'), `import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
export default defineConfig({ plugins: [sveltekit({ adapter: adapter(), paths: { base: '/application' } })] });`);
  await writeFile(path.join(root, 'src/app.html'), '<!doctype html><html lang="en"><head>%sveltekit.head%</head><body><div>%sveltekit.body%</div></body></html>');
  await writeFile(path.join(root, 'src/routes/+page.svelte'), '<h1>Existing home</h1>');
  await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ extends: '$app/tsconfig', compilerOptions: {
    strict: true, types: ['$app/types', 'node', 'vite/client', '@0disoft/saylo-vite/virtual'] }, include: ['src'] }));
  await applyInit(planInit(root, 'en', { framework: 'sveltekit' }));
  run('@sveltejs/kit/svelte-kit.js', ['sync']);
  console.log(run('svelte-check/bin/svelte-check', ['--tsconfig', './tsconfig.json']));
  const log = run('vite/bin/vite.js', ['build']);
  console.log(log.split('\n').filter(line => /built in|done|adapter-node/.test(line)).join('\n'));
  const { handler } = await import(pathToFileURL(path.join(root, 'build/handler.js')));
  server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/application`;
  const [en, ko] = await Promise.all(['en', 'ko'].map(locale => fetch(`${origin}/saylo?locale=${locale}`)));
  assert.equal(en.status, 200); assert.equal(ko.status, 200);
  assert.match(await en.text(), /Hello Saylo/);
  assert.match(await ko.text(), /안녕하세요 Saylo/);
  assert.match(ko.headers.get('set-cookie'), /SAYLO_LOCALE=ko/);
  assert.match(ko.headers.get('set-cookie'), /Path=\/application\/saylo/);
  const saved = await fetch(`${origin}/saylo`, { headers: { cookie: 'SAYLO_LOCALE=ko' } });
  assert.match(await saved.text(), /안녕하세요 Saylo/);
  const explicit = await fetch(`${origin}/saylo?locale=en`, { headers: { cookie: 'SAYLO_LOCALE=ko' } });
  assert.match(await explicit.text(), /Hello Saylo/);
  console.log('PASS request isolation, SSR locale, cookie preference and explicit URL precedence');
  if (process.argv[2]) {
    const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])));
    browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/saylo?locale=en`);
    await page.waitForFunction(() => !document.querySelector('#saylo-locale').disabled);
    await page.locator('#saylo-name').fill('Preserved');
    await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
    // Use keyboard-independent DOM selection while the modal is open.
    await page.evaluate(() => {
      window.__sayloDocument = document;
      const select = document.querySelector('#saylo-locale');
      select.value = 'ko'; select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('#saylo-greeting').textContent === '안녕하세요 Preserved');
    assert.equal(await page.locator('#saylo-name').inputValue(), 'Preserved');
    assert.equal(await page.locator('dialog[open]').count(), 1);
    assert.equal(await page.evaluate(() => window.__sayloDocument === document), true);
    assert.deepEqual(errors, []);
    console.log('PASS production hydration and query navigation preserve input, dialog and document');
    process.chdir(root);
    const { createServer: createViteServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));
    devServer = await createViteServer({ root, configFile: path.join(root, 'vite.config.mjs'),
      server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
    await devServer.listen();
    const response = await page.goto(`http://127.0.0.1:${devServer.httpServer.address().port}/application/saylo?locale=en`);
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => !document.querySelector('#saylo-locale').disabled);
    await page.locator('#saylo-name').fill('Live edit');
    await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
    await page.evaluate(() => { window.__sayloDocument = document; });
    await writeFile(path.join(root, 'locales/en/saylo.json'), JSON.stringify({ greeting: 'Updated {name}' }));
    await page.waitForFunction(() => document.querySelector('#saylo-greeting').textContent === 'Updated Live edit');
    assert.equal(await page.locator('#saylo-name').inputValue(), 'Live edit');
    assert.equal(await page.locator('dialog[open]').count(), 1);
    assert.equal(await page.evaluate(() => window.__sayloDocument === document), true);
    assert.deepEqual(errors, []);
    console.log('PASS live translation edits preserve input, open dialog and document');
  }
} finally {
  await browser?.close();
  await devServer?.close();
  process.chdir(initialDirectory);
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  assert.equal(path.dirname(root), parent);
  assert.ok(path.basename(root).startsWith('init-kit-'));
  // Remove only the owned junction before recursively cleaning the verified fixture directory.
  for (const link of links) await rm(link, { force: true, recursive: true });
  await rm(root, { recursive: true, force: true });
}
