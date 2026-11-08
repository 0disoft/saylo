import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { reviewPage } from '../dist/review-page.js';
import { startReviewServer } from '../dist/review-server.js';

const row = (id = 'title') => ({ locale: 'ko', namespace: 'demo', id, source: id,
  originalTranslation: 'Saved ' + id, context: {}, status: 'review' });
const state = (revision = 'original', rows = [row(), row('other')]) => ({ revision, rows, total: rows.length, diagnostics: [] });
const response = value => ({ ok: true, json: async () => value });
const settle = () => new Promise(resolve => setImmediate(resolve));
async function wait(condition) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Review page did not settle');
}
function mount(t, html, fetch) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', beforeParse(window) {
    window.fetch = fetch;
    window.confirm = () => false;
    // Trigger the real search debounce deterministically without wall-clock sleeps.
    window.setTimeout = (callback, delay) => delay === 200 ? (queueMicrotask(callback), 0) : setTimeout(callback, delay);
  } });
  t.after(() => dom.window.close());
  const { window } = dom;
  const element = id => window.document.getElementById(id);
  const input = (id, value) => { element(id).value = value; element(id).dispatchEvent(new window.Event('input', { bubbles: true })); };
  const protectedDraft = () => {
    const event = new window.Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { window, element, input, protectedDraft };
}

for (const mode of ['refresh', 'search']) test(`${mode} responses preserve edits, selection and the original save revision`, async t => {
  const reads = [], writes = [];
  let initial = true;
  const f = mount(t, reviewPage('fixture-token', 'fixture-nonce'), (url, options) => {
    if (options.method === 'POST') { writes.push(JSON.parse(options.body)); return Promise.resolve(response({ blocked: false })); }
    if (initial) { initial = false; return Promise.resolve(response(state())); }
    return new Promise(resolve => reads.push({ url, resolve: value => resolve(response(value)) }));
  });
  await wait(() => f.element('list').children.length === 2);
  f.element('list').firstChild.click();
  const identity = f.element('identity').textContent, editor = f.element('draft');
  if (mode === 'refresh') f.element('reload').click();
  else f.input('search', 'other');
  await wait(() => reads.length === 1);
  if (mode === 'search') assert.match(reads[0].url, /q=other$/);
  f.input('draft', 'Draft written during ' + mode);
  editor.focus(); editor.setSelectionRange(2, 7);
  // The search result need not contain the selected row; its editor must survive.
  reads[0].resolve(state('newer', mode === 'search' ? [row('other')] : [row(), row('other')]));
  await settle();
  assert.equal(f.element('draft'), editor);
  assert.equal(editor.value, 'Draft written during ' + mode);
  assert.equal(editor.disabled, false);
  assert.equal(f.element('identity').textContent, identity);
  assert.equal(f.window.document.activeElement, editor);
  assert.equal(editor.selectionStart, 2); assert.equal(editor.selectionEnd, 7);
  assert.equal(f.element('draft-status').textContent, 'Unsaved draft');
  assert.equal(f.protectedDraft(), true);
  assert.equal(f.element('approve').disabled, true);
  if (mode === 'refresh') assert.equal(f.element('list').firstChild.getAttribute('aria-current'), 'true');
  let confirmations = 0;
  f.window.confirm = () => { confirmations++; return false; };
  f.element('list').lastChild.click();
  assert.equal(confirmations, 1);
  assert.equal(editor.value, 'Draft written during ' + mode);
  assert.equal(f.element('identity').textContent, identity);
  f.element('validate').click();
  await settle();
  assert.equal(writes[0].revision, 'original');
  assert.equal(writes[0].entry.id, 'title');
  assert.equal(writes[0].entry.translation, 'Draft written during ' + mode);
  assert.equal(f.protectedDraft(), true);
});

test('selection changes during a read survive its response and older errors cannot replace newer results', async t => {
  let initial = true;
  const reads = [];
  const f = mount(t, reviewPage('fixture-token', 'fixture-nonce'), () => {
    if (initial) { initial = false; return Promise.resolve(response(state())); }
    return new Promise((resolve, reject) => reads.push({ resolve: value => resolve(response(value)), reject }));
  });
  await wait(() => f.element('list').children.length === 2);
  f.element('list').firstChild.click();
  f.element('reload').click();
  f.element('list').lastChild.click();
  const identity = f.element('identity').textContent;
  reads[0].resolve(state('newer'));
  await settle();
  assert.equal(f.element('identity').textContent, identity);
  assert.equal(f.element('draft').value, 'Saved other');
  assert.equal(f.element('draft').disabled, false);
  f.input('draft', 'Latest draft');
  f.window.confirm = () => true;
  f.element('reload').click(); f.element('reload').click();
  f.input('draft', 'Still editing');
  reads[2].resolve(state('latest', [row('other')]));
  await settle();
  const status = f.element('status').textContent;
  reads[1].reject(new Error('obsolete read failed'));
  await settle();
  assert.equal(f.element('status').textContent, status);
  assert.equal(f.element('draft').value, 'Still editing');
  assert.equal(f.protectedDraft(), true);
});

test('preserved drafts still conflict with external catalog changes instead of overwriting them', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-review-page-'));
  let server;
  t.after(async () => {
    await server?.close();
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('saylo-review-page-'));
    await rm(root, { recursive: true, force: true });
  });
  const localesDir = path.join(root, 'locales');
  for (const locale of ['en', 'ko']) await mkdir(path.join(localesDir, locale), { recursive: true });
  const target = path.join(localesDir, 'ko/demo.json');
  await writeFile(path.join(localesDir, 'en/demo.json'), '{"title":"Hello"}');
  await writeFile(target, '{"title":"Original"}');
  server = await startReviewServer({ localesDir, baseLocale: 'en', checkLocales: ['ko'] });
  const html = await (await fetch(server.url)).text();
  let reads = 0, release;
  const f = mount(t, html, async (url, options) => {
    const result = await fetch(new URL(url, server.url), { ...options, headers: { ...options.headers, Origin: server.url } });
    if (options.method === 'GET' && ++reads === 2) await new Promise(resolve => { release = resolve; });
    return result;
  });
  await wait(() => f.element('list').children.length === 1);
  f.element('list').firstChild.click();
  await writeFile(target, '{"title":"External edit"}');
  f.element('reload').click();
  await wait(() => release);
  f.input('draft', 'New local draft');
  release();
  await wait(() => f.element('list').firstChild?.getAttribute('aria-current') === 'true');
  f.element('save').click();
  await wait(() => f.element('result').textContent.includes('changed. Refresh before saving.'));
  assert.equal(JSON.parse(await readFile(target, 'utf8')).title, 'External edit');
  assert.equal(f.element('draft').value, 'New local draft');
  assert.equal(f.element('draft').disabled, false);
  assert.equal(f.element('draft-status').textContent, 'Unsaved draft');
  assert.equal(f.protectedDraft(), true);
});
