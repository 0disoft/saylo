import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../../examples/vanilla/dist/index.html', import.meta.url), 'utf8');
const asset = /<script[^>]+src="([^"]+)"/.exec(html);
assert.ok(asset, 'Build the vanilla demo before checking its lifecycle');
const source = await readFile(new URL(`../../examples/vanilla/dist/${asset[1].replace(/^\//, '')}`, import.meta.url), 'utf8');
function page(t) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.eval(source);
  return dom.window;
}

test('vanilla cached page retains live locale controls and form inputs', t => {
  const window = page(t);
  const { document } = window;
  document.querySelector('#name').value = 'Returning user';
  window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: true }));
  window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
  const locale = document.querySelector('#locale');
  locale.value = 'en';
  locale.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(document.querySelector('h1').textContent, 'New words. Same input.');
  assert.equal(document.documentElement.lang, 'en');
  // The translated view follows the locale; fixed Korean guidance must not.
  const language = node => node.closest('[lang]').lang;
  assert.equal(language(document.querySelector('h1')), 'en');
  assert.equal(language(document.querySelector('#name')), 'en');
  assert.equal(language(document.querySelector('#dialog-title')), 'en');
  assert.equal(language(document.querySelector('.preview > .hint')), 'ko');
  assert.equal(language(document.querySelector('.brand span')), 'en');
  for (const selector of ['header', '#locale', '#status', '#dialog-status', '#support-status']) {
    assert.equal(language(document.querySelector(selector)), 'ko', selector);
  }
  assert.equal(language(document.querySelector('#en-editor')), 'en');
  assert.equal(document.querySelector('#en-editor').getAttribute('aria-label'), 'English catalog');
  assert.equal(language(document.querySelector('#ko-editor')), 'ko');
  assert.equal(document.querySelector('#locale option[value="en"]').lang, 'en');
  assert.equal(document.querySelector('#locale option[value="ko"]').lang, 'ko');
  assert.equal(document.querySelector('#name').value, 'Returning user');
  locale.value = 'ko';
  locale.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(language(document.querySelector('h1')), 'ko');
  assert.equal(language(document.querySelector('#en-editor')), 'en');
});

test('vanilla support controls generate reviewable metadata without form or catalog content', t => {
  const window = page(t);
  const { document } = window;
  document.querySelector('#name').value = 'PRIVATE_INPUT_MARKER';
  document.querySelector('#support-export').click();
  const field = document.querySelector('#support-report');
  const report = JSON.parse(field.value);
  assert.equal(report.schemaVersion, 'saylo.support/v1');
  assert.equal(report.environment.runtime, 'browser');
  assert.match(report.environment.node, /^\d+\.\d+\.\d+$/);
  assert.match(report.environment.vite, /^8\./);
  assert.equal(field.readOnly, true);
  for (const text of ['PRIVATE_INPUT_MARKER', 'demo.json', '번역을 바꿔도', 'New words']) assert.ok(!field.value.includes(text));
  document.querySelector('#support-clear').click();
  assert.equal(field.value, '');
  assert.match(document.querySelector('#support-status').textContent, /지웠습니다/);
  document.querySelector('#support-export').click();
  assert.deepEqual(JSON.parse(field.value).events, []);
  assert.equal(document.querySelector('#name').value, 'PRIVATE_INPUT_MARKER');
});

test('vanilla rendering error retains the last screen and clears both status areas after repair', t => {
  const window = page(t);
  const { document } = window;
  const heading = document.querySelector('h1');
  const original = heading.textContent;
  heading.dataset.message = 'demo:missing';
  document.querySelector('#count').dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(heading.textContent, original);
  assert.match(document.querySelector('#error').textContent, /demo:missing/);
  assert.match(document.querySelector('#dialog-status').textContent, /demo:missing/);
  heading.dataset.message = 'demo:heading';
  document.querySelector('#count').dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(document.querySelector('#error').textContent, '');
  assert.equal(document.querySelector('#status').textContent, '빌드된 카탈로그를 사용합니다.');
  assert.equal(document.querySelector('#dialog-status').textContent, '빌드된 카탈로그를 사용합니다.');
});
