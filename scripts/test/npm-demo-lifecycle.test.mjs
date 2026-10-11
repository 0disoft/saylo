import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../../examples/npm/dist/index.html', import.meta.url), 'utf8');
const script = /<script[^>]+src="([^"]+)"/.exec(html);
assert.ok(script, 'Build the standalone npm example before checking its lifecycle.');
const source = await readFile(new URL(`../../examples/npm/dist/${script[1].replace(/^\//, '')}`, import.meta.url), 'utf8');

function page(t) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.eval(source);
  const { window } = dom;
  const document = window.document;
  const name = document.querySelector('#name');
  name.value = 'Returning user';
  name.dispatchEvent(new window.Event('input', { bubbles: true }));
  return { window, document, name };
}

test('cached page retains input and live locale controls after history return', t => {
  const { window, document, name } = page(t);
  window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: true }));
  window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
  const select = document.querySelector('#locale');
  select.value = 'ko';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(document.documentElement.lang, 'ko');
  assert.equal(document.querySelector('h1').textContent, 'npm으로 설치해 쓰는 Saylo');
  assert.equal(name.value, 'Returning user');
  name.value = 'Back again';
  name.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.ok(document.querySelector('[data-i18n="demo:greeting"]').textContent.includes('Back again'));
});

test('discarded page releases its handlers and repeated cleanup stays safe', t => {
  const { window, document } = page(t);
  window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: false }));
  window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: false }));
  const select = document.querySelector('#locale');
  select.value = 'ko';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(document.documentElement.lang, 'en');
});

test('missing message keeps the last rendered screen and clears guidance after repair', t => {
  const { window, document, name } = page(t);
  const heading = document.querySelector('h1');
  const original = heading.textContent;
  heading.dataset.i18n = 'demo:missing';
  name.value = 'Still editing';
  name.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(heading.textContent, original);
  assert.match(document.querySelector('#status').textContent, /demo:missing/);
  assert.match(document.querySelector('#dialog-status').textContent, /save again/);
  heading.dataset.i18n = 'demo:heading';
  name.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(document.querySelector('#status').textContent, 'Production catalogs');
  assert.equal(document.querySelector('#dialog-status').textContent, 'Production catalogs');
  assert.ok(document.querySelector('[data-i18n="demo:greeting"]').textContent.includes('Still editing'));
});
