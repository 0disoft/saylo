import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, createServer, preview } from 'vite';
import { planInit } from '../packages/typegen/dist/init.js';
import { applyInit } from '../packages/typegen/dist/init-write.js';

const repository = fileURLToPath(new URL('..', import.meta.url));
const parent = path.join(repository, '.release');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(path.join(parent, 'init-react-'));
let browser, dev, production;
try {
  await mkdir(path.join(root, 'src'));
  await symlink(path.join(repository, 'node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module', dependencies: { react: '19', 'react-dom': '19' }, devDependencies: { vite: '8' } }));
  await writeFile(path.join(root, 'vite.config.mjs'), "import { defineConfig } from 'vite'; export default defineConfig({});");
  await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', strict: true,
    module: 'ESNext', moduleResolution: 'Bundler', target: 'ES2022', noEmit: true }, include: ['src'] }));
  await applyInit(planInit(root, 'en', { framework: 'react' }));
  execFileSync(process.execPath, [path.join(repository, 'node_modules/typescript/bin/tsc'), '-p', root], { windowsHide: true, encoding: 'utf8' });
  const configFile = path.join(root, 'saylo.demo.config.mjs');
  await build({ root, configFile, logLevel: 'error' });
  assert.match(await readFile(path.join(root, 'dist-saylo-demo/saylo.html'), 'utf8'), /Saylo React demo/);
  console.log('PASS React preset consumer types and isolated production build');
  if (process.argv[2]) {
    const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])));
    browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    dev = await createServer({ root, configFile: path.join(root, 'vite.config.mjs'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
    await dev.listen();
    await page.goto(`http://127.0.0.1:${dev.httpServer.address().port}/saylo.html?locale=en`);
    await page.locator('#saylo-name').fill('Preserved');
    await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
    await page.evaluate(() => {
      window.__document = document;
      const select = document.querySelector('#saylo-locale');
      select.value = 'ko'; select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('#saylo-greeting')?.textContent === '안녕하세요 Preserved');
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('#saylo-locale').selectOption('en');
    await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
    await writeFile(path.join(root, 'locales/en/saylo.json'), JSON.stringify({ greeting: 'Edited {name}' }));
    await page.waitForFunction(() => document.querySelector('#saylo-greeting')?.textContent === 'Edited Preserved');
    assert.equal(await page.locator('#saylo-name').inputValue(), 'Preserved');
    assert.equal(await page.locator('dialog[open]').count(), 1);
    assert.equal(await page.evaluate(() => document === window.__document), true);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#saylo-greeting')?.textContent === 'Edited Saylo');
    assert.deepEqual(errors, []);
    production = await preview({ root, configFile, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
    await page.goto(`http://127.0.0.1:${production.httpServer.address().port}/saylo.html?locale=ko`);
    await page.waitForFunction(() => document.querySelector('#saylo-greeting')?.textContent === '안녕하세요 Saylo');
    assert.deepEqual(errors, []);
    console.log('PASS React StrictMode, live edits, locale switching, state preservation and production rendering');
  }
} finally {
  await browser?.close();
  await dev?.close();
  if (production) await new Promise(resolve => { production.httpServer.close(resolve); production.httpServer.closeAllConnections(); });
  assert.equal(path.dirname(root), parent);
  assert.ok(path.basename(root).startsWith('init-react-'));
  await rm(path.join(root, 'node_modules'), { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
}
