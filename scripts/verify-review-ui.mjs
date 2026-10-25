import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startReviewServer } from '../packages/typegen/dist/review-server.js';

if (!process.argv[2]) throw new Error('Supply the path to a Playwright module.');
const repository = fileURLToPath(new URL('..', import.meta.url));
const parent = path.join(repository, '.release');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(path.join(parent, 'review-ui-'));
let server, browser;
try {
  const localesDir = path.join(root, 'locales');
  for (const locale of ['en', 'ko']) await mkdir(path.join(localesDir, locale), { recursive: true });
  await writeFile(path.join(localesDir, 'en/common.json'), JSON.stringify({ greeting: 'Hello {name}' }));
  await writeFile(path.join(localesDir, 'ko/common.json'), '{}');
  const metadataFile = path.join(root, 'notes.json');
  await writeFile(metadataFile, JSON.stringify({ format: 'saylo-translation-metadata/v1', messages: {
    'common:greeting': { description: '<img src=x onerror="window.pwned=true"> Checkout greeting', maxLength: 40 } } }));
  server = await startReviewServer({ localesDir, baseLocale: 'en', checkLocales: ['ko'] }, { metadataFile });
  const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])));
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.url);
  await page.getByRole('button', { name: /ko common:greeting/ }).click();
  assert.match(await page.locator('#context').textContent(), /Checkout greeting/);
  assert.equal(await page.locator('#context img').count(), 0);
  await page.locator('#draft').fill('안녕하세요 {name}');
  await page.getByRole('button', { name: 'Validate draft', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#result').textContent.includes('"blocked": false'));
  assert.deepEqual(JSON.parse(await readFile(path.join(localesDir, 'ko/common.json'), 'utf8')), {});
  await page.getByRole('button', { name: 'Save translation', exact: true }).click();
  await page.getByRole('button', { name: /ko common:greeting — REVIEW_REQUIRED/ }).click();
  assert.equal(await page.locator('#draft').inputValue(), '안녕하세요 {name}');
  await page.locator('#reviewer').fill('Browser reviewer');
  await page.getByRole('button', { name: 'Approve saved translation', exact: true }).click();
  await page.getByRole('button', { name: /ko common:greeting — approved/ }).waitFor();
  const ledger = JSON.parse(await readFile(path.join(root, '.saylo-reviews.json'), 'utf8'));
  assert.equal(ledger.entries[0].reviewer, 'Browser reviewer');
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.deepEqual(errors, []);
  console.log('PASS real-browser review context, literal metadata, read-only validation, guarded save and explicit approval');
} finally {
  await browser?.close(); await server?.close();
  assert.equal(path.dirname(root), parent); assert.ok(path.basename(root).startsWith('review-ui-'));
  await rm(root, { recursive: true, force: true });
}
