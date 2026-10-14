import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { compileFixtures } from './compile-fixtures.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Text', 'Comment', 'Event', 'CustomEvent']) globalThis[key] = dom.window[key];
after(() => dom.window.close());
const { mount, hydrate, unmount, flushSync } = await import('svelte');
const output = await compileFixtures('client');
const { default: Parent } = await import(new URL('Parent.mjs', output));
const { default: RichView } = await import(new URL('RichView.mjs', output));
const catalog = (title, locale = 'ko') => parseCatalog(JSON.stringify({ title }), { locale, namespace: 'demo' });
const catalogs = title => [catalog(title), catalog('English', 'en')];

test('rich snippets retain independent state and focus when text is inserted', async t => {
  const records = message => [parseCatalog(JSON.stringify({ message }), { locale: 'en', namespace: 'rich' })];
  const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: records('<counter>{name}</counter> <counter>Other</counter>') });
  const target = document.body.appendChild(document.createElement('div'));
  const app = mount(RichView, { target, props: { instance: store, name: 'Ada' } });
  flushSync();
  t.after(async () => { await unmount(app); store.dispose(); target.remove(); });
  const [first, second] = target.querySelectorAll('button');
  first.click(); flushSync(); first.focus();
  store.replaceCatalogs(records('Prefix <counter>{name}</counter> <counter>Other changed</counter>')); flushSync();
  assert.equal(target.querySelectorAll('button')[0], first);
  assert.equal(target.querySelectorAll('button')[1], second);
  assert.equal(first.textContent, 'Ada 1');
  assert.equal(second.textContent, 'Other changed 0');
  assert.equal(document.activeElement, first);
});

test('rich snippets hydrate matching SSR markup and retain mapped links through updates', async t => {
  const records = message => [parseCatalog(JSON.stringify({ message }), { locale: 'en', namespace: 'rich' })];
  const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: records('<link>Hello <strong>{name}</strong></link> <script>safe</script> <constructor>end</constructor>') });
  const target = document.body.appendChild(document.createElement('div'));
  target.innerHTML = await readFile(new URL('./.compiled/server/rich-hydration.html', import.meta.url), 'utf8');
  const link = target.querySelector('a');
  const app = hydrate(RichView, { target, props: { instance: store } });
  flushSync();
  t.after(async () => { await unmount(app); store.dispose(); target.remove(); });
  assert.equal(target.querySelector('a'), link);
  store.replaceCatalogs(records('Prefix <link>Updated <strong>{name}</strong></link>')); flushSync();
  assert.equal(target.querySelector('a'), link);
  assert.equal(target.querySelector('strong').textContent, '<img src=x>');
  assert.equal(target.querySelector('img'), null);
});

test('catalog edits and locale switches preserve input, focus, selection, dialog and component state', async t => {
  const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: catalogs('한국어') });
  let active = 0;
  const instance = { ...store, subscribe(listener) {
    active++;
    const off = store.subscribe(listener);
    return () => { active--; off(); };
  } };
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(Parent, { target, props: { instance } });
  flushSync();
  t.after(async () => { await unmount(app); store.dispose(); target.remove(); });
  const input = target.querySelector('input'), dialog = target.querySelector('dialog');
  input.value = '입력 유지'; input.dispatchEvent(new Event('input', { bubbles: true }));
  target.querySelector('button').click(); flushSync();
  input.focus(); input.setSelectionRange(2, 2);
  store.replaceCatalogs(catalogs('새 한국어')); flushSync();
  assert.equal(target.querySelector('h1').textContent, '새 한국어');
  store.setLocale('en'); flushSync();
  assert.equal(target.querySelector('h1').textContent, 'English');
  assert.equal(target.querySelector('input'), input);
  assert.equal(input.value, '입력 유지');
  assert.equal(document.activeElement, input);
  assert.equal(input.selectionStart, 2);
  assert.equal(target.querySelector('dialog'), dialog);
  assert.equal(dialog.open, true);
  assert.equal(target.querySelector('button').textContent, '1');
  assert.equal(active, 1);
  await unmount(app);
  assert.equal(active, 0);
  store.setLocale('ko');
});

test('hydrates matching SSR markup in place and applies later catalog changes', async t => {
  const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: catalogs('한국어') });
  const target = document.createElement('div');
  target.innerHTML = await readFile(new URL('./.compiled/server/hydration.html', import.meta.url), 'utf8');
  document.body.append(target);
  const heading = target.querySelector('h1'), input = target.querySelector('input');
  const app = hydrate(Parent, { target, props: { instance: store } });
  flushSync();
  t.after(async () => { await unmount(app); store.dispose(); target.remove(); });
  assert.equal(target.querySelector('h1'), heading);
  assert.equal(target.querySelector('input'), input);
  input.value = 'Hydrated input'; input.dispatchEvent(new Event('input', { bubbles: true }));
  store.replaceCatalogs(catalogs('Hydrated update')); flushSync();
  assert.equal(heading.textContent, 'Hydrated update');
  assert.equal(input.value, 'Hydrated input');
});

test('selector hydration skips unrelated notifications and retains DOM state through edits and locale changes', async t => {
  const records = (title = '한국어', note = '메모') => ['ko', 'en'].map(locale => parseCatalog(JSON.stringify({
    title: locale === 'ko' ? title : 'English', note,
  }), { locale, namespace: 'demo' }));
  const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: records() });
  let active = 0;
  const instance = { ...store, subscribe(listener) {
    active++;
    const off = store.subscribe(listener);
    return () => { active--; off(); };
  } };
  const target = document.createElement('div');
  target.innerHTML = await readFile(new URL('./.compiled/server/selector-hydration.html', import.meta.url), 'utf8');
  document.body.append(target);
  const heading = target.querySelector('h1'), input = target.querySelector('input');
  const notifications = [];
  const app = hydrate(Parent, { target, props: { instance, selected: true, onSelection: value => notifications.push(value) } });
  flushSync();
  t.after(async () => { await unmount(app); store.dispose(); target.remove(); });
  assert.equal(target.querySelector('h1'), heading);
  assert.deepEqual(notifications, ['한국어']);
  input.value = '선택 구독 입력'; input.dispatchEvent(new Event('input', { bubbles: true }));
  target.querySelector('button').click(); flushSync();
  input.focus(); input.setSelectionRange(2, 2);
  store.replaceCatalogs(records('한국어', '관련 없는 수정')); flushSync();
  assert.deepEqual(notifications, ['한국어']);
  store.replaceCatalogs(records('선택 제목 수정', '관련 없는 수정')); flushSync();
  store.setLocale('en'); flushSync();
  assert.deepEqual(notifications, ['한국어', '선택 제목 수정', 'English']);
  assert.equal(heading.textContent, 'English');
  assert.equal(target.querySelector('input'), input);
  assert.equal(input.value, '선택 구독 입력');
  assert.equal(document.activeElement, input);
  assert.equal(input.selectionStart, 2);
  assert.equal(target.querySelector('button').textContent, '1');
  assert.equal(target.querySelector('dialog').open, true);
  assert.equal(active, 1);
  await unmount(app);
  assert.equal(active, 0);
});
