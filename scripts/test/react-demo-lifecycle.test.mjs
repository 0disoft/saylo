import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { SourceTextModule } from 'node:vm';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const dist = process.env.SAYLO_REACT_TEST_DIST
  ? pathToFileURL(path.resolve(process.env.SAYLO_REACT_TEST_DIST) + path.sep)
  : new URL('../../examples/react/dist/', import.meta.url);
const html = await readFile(new URL('index.html', dist), 'utf8');
const asset = /<script[^>]+src="([^"]+)"/.exec(html);
assert.ok(asset, 'Build the React demo before checking its lifecycle');
const source = await readFile(new URL(asset[1].replace(/^\//, ''), dist), 'utf8');
const mainUrl = new URL(asset[1].replace(/^\//, ''), dist);

async function settle(condition, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await delay(10);
  }
  assert.fail(message);
}
async function page(t) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  console.on('error', (...args) => errors.push(args.map(String).join(' ')));
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: console });
  const window = dom.window;
  // jsdom has no native modal implementation. Test application state and node identity.
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
  t.after(() => {
    window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: false }));
    window.close();
    assert.deepEqual(errors, [], 'React production bundle logged errors');
  });
  const modules = new Map();
  async function load(url) {
    assert.ok(url.href.startsWith(dist.href), 'Bundle import escaped the built example');
    if (modules.has(url.href)) return modules.get(url.href);
    const module = new SourceTextModule(url.href === mainUrl.href ? source : await readFile(url, 'utf8'), {
      context: dom.getInternalVMContext(), identifier: url.href,
      initializeImportMeta: meta => { meta.url = url.href; },
      importModuleDynamically: async (specifier, parent) => {
        const imported = await load(new URL(specifier, parent.identifier));
        if (imported.status === 'unlinked') await imported.link(link);
        if (imported.status === 'linked') await imported.evaluate();
        return imported;
      },
    });
    modules.set(url.href, module);
    return module;
  }
  const link = (specifier, parent) => load(new URL(specifier, parent.identifier));
  const main = await load(mainUrl);
  await main.link(link);
  await main.evaluate();
  await settle(() => window.document.querySelector('#name'), 'React initial render timed out');
  return window;
}
function input(window, selector, value) {
  const field = window.document.querySelector(selector);
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(field, value);
  field.dispatchEvent(new window.Event('input', { bubbles: true }));
}

test('React production app retains inputs, modal and working controls across repeated cached history events', async t => {
  const window = await page(t);
  const { document } = window;
  const name = document.querySelector('#name');
  name.focus();
  input(window, '#name', 'Returning user');
  input(window, '#count', '3');
  await settle(() => document.querySelector('#summary').textContent.includes('3'), 'Count input did not update React state');
  document.querySelector('#order-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const dialog = document.querySelector('#confirmation');
  await settle(() => dialog.open, 'React dialog did not open');
  input(window, '#confirmation-note', 'Keep this confirmation');
  document.querySelector('#support-export').click();
  await settle(() => document.querySelector('#support-report').value.length > 0, 'Report generation failed');
  const report = document.querySelector('#support-report').value;
  for (let index = 0; index < 2; index++) {
    window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
    assert.equal(document.querySelector('#name'), name, 'Cached page unmounted the React root');
    assert.equal(name.value, 'Returning user');
    assert.equal(document.querySelector('#confirmation'), dialog);
    assert.equal(dialog.open, true);
    assert.equal(document.querySelector('#confirmation-note').value, 'Keep this confirmation');
    assert.equal(document.querySelector('#support-report').value, report);
  }
  input(window, '#count', '4');
  await settle(() => document.querySelector('#summary').textContent.includes('4'), 'Controls stopped updating after history restoration');
  const locale = document.querySelector('#locale');
  locale.value = 'en';
  locale.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(() => document.querySelector('h1')?.textContent === 'New words. Same input.', 'Lazy locale loading stopped after history restoration');
  assert.equal(document.documentElement.lang, 'en');
  const language = selector => document.querySelector(selector).closest('[lang]').lang;
  for (const selector of ['h1', '#name', '#dialog-title']) assert.equal(language(selector), 'en', selector);
  for (const selector of ['header', '#locale', '.preview > .hint', '#status', '#dialog-status', '#support-status']) {
    assert.equal(language(selector), 'ko', selector);
  }
  assert.equal(language('.brand span'), 'en');
  assert.equal(language('[aria-label="English catalog"]'), 'en');
  assert.equal(language('[aria-label="한국어 카탈로그"]'), 'ko');
  for (const option of locale.options) assert.equal(option.lang, option.value);
  assert.equal(document.querySelector('#confirmation'), dialog);
  assert.equal(dialog.open, true);
  document.querySelector('#support-clear').click();
  await settle(() => document.querySelector('#support-report').value === '', 'Support clear stopped working after restoration');
  assert.equal(document.querySelector('#name'), name);
  assert.equal(name.value, 'Returning user', 'Controlled React input lost its value on a later render');
  window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: false }));
  assert.equal(document.querySelector('#root').childElementCount, 0, 'Terminal exit retained the React root');
  window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: false }));
  assert.equal(document.querySelector('#root').childElementCount, 0);
});
