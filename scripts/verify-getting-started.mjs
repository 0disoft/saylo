import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const repository = fileURLToPath(new URL('..', import.meta.url));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run with npm run verify:starter.');
const doc = await readFile(new URL('../docs/getting-started.md', import.meta.url), 'utf8');
const files = ['package.json', 'vite.config.mjs', 'index.html', 'main.js', 'locales/ko/demo.json', 'locales/en/demo.json'];
const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-starter-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_config_allow_scripts'));
const exec = promisify(execFile);
async function npm(args) {
  const result = await exec(process.execPath, [npmCli, ...args], { cwd: root, env, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  return result.stdout;
}
try {
  assert.ok(!root.startsWith(repository), 'Starter must be outside the workspace.');
  for (const file of files) {
    const section = doc.split(`### ${file}`)[1];
    const block = section?.match(/```\w*\r?\n([\s\S]*?)\r?\n```/);
    assert.ok(block, `Missing standalone ${file} code block`);
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, block[1] + '\n');
  }
  await npm(['install', '--ignore-scripts', '--no-audit', '--no-fund']);
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  for (const name of ['@0disoft/saylo-core', '@0disoft/saylo-vite', 'vite']) {
    const installed = lock.packages[`node_modules/${name}`];
    assert.ok(installed.resolved?.startsWith('https://registry.npmjs.org/'), `${name} must come from the public registry`);
  }
  await npm(['run', 'build']);
  const html = await readFile(path.join(root, 'dist/index.html'), 'utf8');
  const script = /<script[^>]+src="([^"]+)"/.exec(html);
  assert.ok(script);
  const source = await readFile(path.join(root, 'dist', script[1].replace(/^\//, '')), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  try {
    dom.window.eval(source);
    const { document, Event } = dom.window;
    assert.equal(document.querySelector('h1').textContent, 'Saylo from npm');
    assert.equal(document.querySelector('#status').textContent, '운영 카탈로그');
    const language = selector => document.querySelector(selector).closest('[lang]').lang;
    assert.equal(language('h1'), 'en');
    assert.equal(language('#status'), 'ko');
    assert.equal(language('#locale'), 'en');
    for (const option of document.querySelector('#locale').options) assert.equal(option.lang, option.value);
    const name = document.querySelector('#name');
    name.value = 'First user';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const locale = document.querySelector('#locale');
    locale.value = 'ko';
    locale.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(document.documentElement.lang, 'ko');
    assert.equal(document.querySelector('h1').textContent, 'npm에서 받은 Saylo');
    assert.ok(document.querySelector('[data-i18n="demo:greeting"]').textContent.includes('First user'));
    assert.equal(name.value, 'First user');
    assert.equal(language('h1'), 'ko');
    assert.equal(language('#status'), 'ko');
    assert.equal(language('#locale'), 'en');
  } finally { dom.window.close(); }
  await npm(['exec', '--yes', '--package=@0disoft/saylo-typegen@alpha', '--', 'saylo-typegen', '--locales-dir', 'locales', '--base-locale', 'ko', '--out-file', 'generated.d.ts']);
  assert.match(await readFile(path.join(root, 'generated.d.ts'), 'utf8'), /AppSchema/);
  const ts = /```ts\r?\n([\s\S]*?)\r?\n```/.exec(doc);
  const js = [...doc.matchAll(/```js\r?\n([\s\S]*?)\r?\n```/g)].find(match => match[1].startsWith('/** @type'));
  assert.ok(ts && js, 'Both TS and checkJs generated schema examples must be present.');
  const negative = '\nstore.t("demo:greeting", { name: "Typed user" });\n// @ts-expect-error unknown message must be rejected\nstore.t("demo:typo");\n// @ts-expect-error greeting requires name\nstore.t("demo:greeting");\n';
  await writeFile(path.join(root, 'consumer.ts'), ts[1] + negative);
  await writeFile(path.join(root, 'consumer.js'), "import { createStore } from '@0disoft/saylo-core';\nimport { baseLocale, initialCatalogs, initialLocale, timeZone } from 'virtual:saylo';\n" + js[1] + negative);
  await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    strict: true, noEmit: true, allowJs: true, checkJs: true, skipLibCheck: true,
    target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
    types: ['vite/client', '@0disoft/saylo-vite/virtual']
  }, files: ['consumer.ts', 'consumer.js'] }));
  await exec(process.execPath, [path.join(repository, 'node_modules/typescript/bin/tsc'), '-p', path.join(root, 'tsconfig.json')], { cwd: root, windowsHide: true });
  console.log(JSON.stringify({
    documentSha256: createHash('sha256').update(doc).digest('hex'),
    files: files.length,
    installed: Object.fromEntries(['@0disoft/saylo-core', '@0disoft/saylo-vite', 'vite'].map(name => [name, lock.packages[`node_modules/${name}`].version])),
    verified: ['public-registry installation', 'production build', 'English first render', 'locale selection', 'translated and fixed language regions', 'input interpolation and preservation', 'typegen CLI', 'TS and checkJs schema examples reject invalid keys and missing arguments'],
    limits: ['Live dev updates and actual browser rendering need separate verification.']
  }, null, 2));
} finally {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('saylo-starter-'));
  await rm(resolved, { recursive: true, force: true });
}
