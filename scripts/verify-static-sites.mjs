import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

// Public registry consumer proof. No monorepo dependency links or dev/SSR servers.
const { values } = parseArgs({ options: {
  framework: { type: 'string' }, 'playwright-module': { type: 'string' }, report: { type: 'string' },
} });
const framework = values.framework;
assert(['astro', 'sveltekit'].includes(framework), 'Use --framework astro or sveltekit');
const source = new URL(`../examples/${framework}-static/`, import.meta.url);
const root = await mkdtemp(path.join(tmpdir(), `saylo-${framework}-static-`));
const exec = promisify(execFile);
const run = async (args, failure = false) => {
  try {
    const result = await exec('bun', args, { cwd: root, timeout: 180000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    assert(!failure, `Expected bun ${args.join(' ')} to reject invalid input`);
    return result.stdout;
  } catch (error) {
    if (!failure || typeof error.code !== 'number' || error.code === 0) throw error;
    return `${error.stdout}\n${error.stderr}`;
  }
};
let server, browser;
const failures = [];
const requests = [];
try {
  console.log(`[static:${framework}] isolated consumer: ${root}`);
  await cp(source, root, { recursive: true, filter: file => !['node_modules', 'dist', 'build', '.astro', '.svelte-kit'].includes(path.basename(file)) });
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert(!JSON.stringify(pkg).match(/(?:workspace|file|link):/), 'Example must install registry dependencies');
  console.log(await run(['install', '--no-cache', '--ignore-scripts']));
  console.log(await run(['run', 'build']));
  const output = path.join(root, framework === 'astro' ? 'dist' : 'build');
  const expected = { en: 'Hello, Saylo!', ko: '안녕하세요, Saylo!', ja: 'こんにちは、Saylo！' };
  for (const [locale, heading] of Object.entries(expected)) {
    const html = await readFile(path.join(output, locale, 'index.html'), 'utf8');
    assert(html.includes(heading), `Missing static ${locale} heading`);
    assert(html.includes(`<html lang="${locale}">`), `Missing static ${locale} document language`);
  }

  // Execute an ESM consumer inside the isolated folder (the package has no CJS export).
  await writeFile(path.join(root, 'runtime-contract.mjs'), `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTranslator, parseCatalog, UnknownMessageError, NamespaceNotLoadedError } from '@0disoft/saylo-core';
const expected = ${JSON.stringify(expected)};
const base = parseCatalog(await readFile('locales/en/common.json', 'utf8'), { locale: 'en', namespace: 'common' });
const partial = parseCatalog('{}', { locale: 'ko', namespace: 'common' });
const fallback = createTranslator({ locale: 'ko', baseCatalogs: [base], translations: [partial] });
assert.equal(fallback.t('common:hello', { name: 'Saylo' }), expected.en);
const japanese = parseCatalog(await readFile('locales/ja/common.json', 'utf8'), { locale: 'ja', namespace: 'common' });
const explicit = createTranslator({ locale: 'ko', baseCatalogs: [base], translations: [partial, japanese], fallbackLocales: ['ja'] });
assert.equal(explicit.t('common:hello', { name: 'Saylo' }), expected.ja);
assert.throws(() => fallback.t('common:doesNotExist'), UnknownMessageError);
assert.throws(() => fallback.t('cart:items', { count: 2 }), NamespaceNotLoadedError);
`);
  await run(['run', 'runtime-contract.mjs']);

  // Prove the advertised build gates reject a typo, a wrong numeric argument,
  // a translated argument rename and an incomplete target catalog.
  const probe = path.join(root, 'src/lib/negative-contract.ts');
  for (const call of ["t('common:doesNotExist')", "t('common:total', { count: 'two' })"]) {
    await writeFile(probe, `import type { Translate } from '@0disoft/saylo-core';\nimport type { AppSchema } from './generated';\ndeclare const t: Translate<AppSchema>;\n${call};\n`);
    const error = await run(['run', 'check'], true);
    assert(error.includes('negative-contract.ts'), error);
  }
  await rm(probe);
  const target = path.join(root, 'locales/ko/common.json');
  const original = await readFile(target, 'utf8');
  for (const change of [catalog => { catalog.hello = 'Hello, {renamed}!'; }, catalog => { delete catalog.hello; }]) {
    const catalog = JSON.parse(original); change(catalog);
    await writeFile(target, JSON.stringify(catalog));
    try { await run(['run', 'build'], true); }
    finally { await writeFile(target, original); }
  }

  // Serve bytes from the output directory only; no framework runtime is available.
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  server = createServer((req, res) => { void (async () => {
    try {
      if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
      const file = path.resolve(output, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
      if (!file.startsWith(output + path.sep) && file !== output) { res.writeHead(403).end(); return; }
      const target = (await stat(file)).isDirectory() ? path.join(file, 'index.html') : file;
      res.setHeader('Content-Type', types[path.extname(target)] ?? 'application/octet-stream');
      res.end(await readFile(target));
    } catch { res.writeHead(404).end(); }
  })(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const playwright = values['playwright-module'] ? await import(pathToFileURL(values['playwright-module']).href) : await import('playwright');
  browser = await playwright.chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ locale: 'ko-KR' });
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.goto(origin + '/?test=1#kept');
  await page.waitForURL('**/ko/?test=1#kept');
  await page.waitForFunction(() => !document.querySelector('#locale').disabled);
  assert.equal(await page.locator('#greeting').textContent(), expected.ko);
  assert.equal(await page.locator('#cart').textContent(), '');
  await page.locator('#name').fill('Preserved');
  await page.locator('#open-dialog').click();
  await page.locator('#close-dialog').click();
  const initialRequests = new Set(requests);
  const beforeCart = requests.length;
  await page.locator('#load-cart').click();
  await page.waitForFunction(() => document.querySelector('#cart').textContent.includes('2'));
  const cartRequests = requests.slice(beforeCart);
  const cartChunks = cartRequests.filter(file => file.endsWith('.js'));
  assert.equal(cartChunks.length, 2, 'Cart should fetch only selected + base catalogs');
  assert(cartChunks.every(file => !initialRequests.has(file)), 'Cart chunks must not download before the button is used');
  const beforeJapanese = requests.length;
  await page.locator('#locale').selectOption('ja');
  await page.waitForFunction(() => document.querySelector('#greeting').textContent.includes('こんにちは'));
  await page.waitForURL('**/ja/?test=1#kept');
  const japaneseChunks = requests.slice(beforeJapanese).filter(file => file.endsWith('.js'));
  assert.equal(japaneseChunks.length, 2, 'Changing to ja should fetch common + cart, reusing the cached base');
  assert(japaneseChunks.every(file => !initialRequests.has(file) && !cartChunks.includes(file)), 'Japanese chunks must not download in advance');
  assert.equal(await page.locator('#name').inputValue(), 'Preserved');
  // A modal permits interaction inside itself only: open it, invoke the public
  // select handler programmatically, and verify the element was not replaced.
  await page.locator('#open-dialog').click();
  await page.locator('#locale').evaluate(select => { select.value = 'en'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector('#greeting').textContent === 'Hello, Preserved!');
  assert.equal(await page.locator('dialog').evaluate(dialog => dialog.open), true);
  assert.equal(await page.locator('#name').inputValue(), 'Preserved');
  await page.reload();
  assert.equal(await page.locator('#greeting').textContent(), expected.en);
  assert.deepEqual(failures, []);
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  for (const [locale, heading] of Object.entries(expected)) {
    const plain = await noJs.newPage();
    await plain.goto(`${origin}/${locale}/`);
    assert.equal(await plain.locator('#greeting').textContent(), heading);
    await plain.close();
  }
  await noJs.close();
  const versions = Object.fromEntries(await Promise.all(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).map(async name => [name,
    JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version])));
  const report = { framework, verifiedAt: new Date().toISOString(), node: process.version, bun: (await run(['--version'])).trim(), versions,
    assertions: ['three-language-static-html', 'static-document-language', 'no-js-html', 'browser-language-negotiation', 'locale-switch-query-hash', 'preserved-form-modal', 'only-selected-and-base-namespace-loaded', 'base-and-explicit-fallback', 'unloaded-namespace-rejected', 'unknown-key-rejected', 'wrong-argument-rejected', 'schema-mismatch-rejected', 'missing-translation-rejected', 'no-browser-errors'], cartRequests, japaneseChunks };
  if (values.report) await writeFile(values.report, JSON.stringify(report, null, 2) + '\n');
  // Preserve resolved dependencies and generated contracts for the checked-in example.
  await cp(path.join(root, 'bun.lock'), new URL('bun.lock', source));
  await cp(path.join(root, 'src/lib/generated.d.ts'), new URL('src/lib/generated.d.ts', source));
  console.log(JSON.stringify(report, null, 2));
} finally {
  try { await browser?.close(); }
  finally {
    try { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
    finally {
      assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
      assert(path.basename(root).startsWith(`saylo-${framework}-static-`));
      await rm(root, { recursive: true, force: true });
    }
  }
}
