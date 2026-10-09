import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement as h, StrictMode, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSayloReact } from '@0disoft/saylo-react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());

const catalog = (title, other, locale = 'ko') => parseCatalog(JSON.stringify({ title, other }), { locale, namespace: 'demo' });
const catalogs = (title = '한국어', other = '다른 문구') => [catalog(title, other), catalog('English', 'Other', 'en')];
function fixture(t, records = catalogs()) {
  const original = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: records });
  const active = new Set();
  let subscriptions = 0;
  const store = { ...original, subscribe(callback) {
    subscriptions++;
    const token = {}; active.add(token);
    const off = original.subscribe(callback);
    return () => { active.delete(token); off(); };
  } };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  t.after(async () => { await act(() => root.unmount()); original.dispose(); container.remove(); });
  return { root, container, store, active, subscriptions: () => subscriptions };
}

test('selectors skip unrelated active edits and preserve state while reacting to text and locale changes', async t => {
  const { root, container, store, active, subscriptions } = fixture(t);
  const { SayloProvider, useI18nSelector } = createSayloReact();
  let titleRenders = 0, localeRenders = 0;
  function Title() {
    titleRenders++;
    const title = useI18nSelector(snapshot => snapshot.t('demo:title'));
    const [count, setCount] = useState(0);
    return h('section', null, h('h1', null, title), h('input', { defaultValue: '' }),
      h('button', { onClick: () => setCount(value => value + 1) }, String(count)), h('dialog', { open: count > 0 }));
  }
  function Locale() { localeRenders++; return h('p', null, useI18nSelector(snapshot => snapshot.locale)); }
  await act(() => root.render(h(StrictMode, null, h(SayloProvider, { instance: store }, h(Title), h(Locale)))));
  const input = container.querySelector('input');
  input.value = '선택 구독 입력';
  await act(() => container.querySelector('button').click());
  input.focus(); input.setSelectionRange(2, 2);
  const before = { titleRenders, localeRenders, subscriptions: subscriptions(), snapshot: store.getSnapshot() };
  await act(() => store.replaceCatalogs(catalogs('한국어', '관련 없는 수정')));
  assert.notEqual(store.getSnapshot(), before.snapshot);
  assert.equal(titleRenders, before.titleRenders);
  assert.equal(localeRenders, before.localeRenders);
  await act(() => store.replaceCatalogs(catalogs('제목 수정', '관련 없는 수정')));
  assert.ok(titleRenders > before.titleRenders);
  assert.equal(localeRenders, before.localeRenders);
  assert.equal(container.querySelector('h1').textContent, '제목 수정');
  await act(() => store.setLocale('en'));
  assert.equal(container.querySelector('h1').textContent, 'English');
  assert.equal(container.querySelector('p').textContent, 'en');
  assert.ok(localeRenders > before.localeRenders);
  assert.equal(container.querySelector('input'), input);
  assert.equal(input.value, '선택 구독 입력');
  assert.equal(document.activeElement, input);
  assert.equal(input.selectionStart, 2);
  assert.equal(container.querySelector('button').textContent, '1');
  assert.equal(container.querySelector('dialog').open, true);
  assert.equal(subscriptions(), before.subscriptions);
  assert.equal(active.size, 2);
  await act(() => root.unmount());
  assert.equal(active.size, 0);
  store.setLocale('ko'); // Unmount still leaves caller-owned stores usable.
});

test('object selections are cached for repeated reads and new selectors use current props and instances', async t => {
  const messages = (word, locale = 'ko') => parseCatalog(JSON.stringify({ title: `${word} {name}`, other: 'Other' }), { locale, namespace: 'demo' });
  const { root, container, store, active } = fixture(t, [messages('안녕'), messages('Hello', 'en')]);
  const other = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [messages('반가워'), messages('Hi', 'en')] });
  t.after(() => other.dispose());
  const { SayloProvider, useI18nSelector } = createSayloReact();
  let selected;
  function View({ name, field }) {
    selected = useI18nSelector(snapshot => Object.freeze({
      text: snapshot.t(field, { name }), t: snapshot.t, setLocale: snapshot.setLocale,
    }));
    const [count, setCount] = useState(0);
    return h('button', { onClick: () => setCount(value => value + 1) }, `${selected.text} ${count}`);
  }
  const app = (instance, name, field = 'demo:title') => h(SayloProvider, { instance }, h(View, { name, field }));
  await act(() => root.render(app(store, 'A')));
  const button = container.querySelector('button');
  const first = selected;
  await act(() => button.click());
  await act(() => root.render(app(store, 'B')));
  assert.equal(button.textContent, '안녕 B 1');
  await act(() => root.render(app(store, 'B', 'demo:other')));
  assert.equal(button.textContent, 'Other 1');
  await act(() => root.render(app(other, 'C')));
  assert.equal(button.textContent, '반가워 C 1');
  assert.equal(active.size, 0);
  assert.equal(container.querySelector('button'), button);
  await act(() => store.setLocale('en'));
  assert.equal(button.textContent, '반가워 C 1');
  await act(() => selected.setLocale('en'));
  assert.equal(button.textContent, 'Hi C 1');
  assert.equal(first.t('demo:title', { name: 'A' }), '안녕 A');
  assert.equal(selected.setLocale, other.setLocale);
});

test('Object.is compares selected NaN and signed zero values', async t => {
  const { root, container, store } = fixture(t);
  const { SayloProvider, useI18nSelector } = createSayloReact();
  let nanRenders = 0, zeroRenders = 0;
  function Nan() { nanRenders++; useI18nSelector(() => NaN); return null; }
  function Zero() {
    zeroRenders++;
    const zero = useI18nSelector(snapshot => snapshot.locale === 'ko' ? 0 : -0);
    return h('p', null, Object.is(zero, -0) ? '-0' : '+0');
  }
  await act(() => root.render(h(SayloProvider, { instance: store }, h(Nan), h(Zero))));
  const before = { nanRenders, zeroRenders };
  await act(() => store.setLocale('en'));
  assert.equal(nanRenders, before.nanRenders);
  assert.ok(zeroRenders > before.zeroRenders);
  assert.equal(container.querySelector('p').textContent, '-0');
});

test('selectors require the matching provider and surface selection failures', t => {
  const { store } = fixture(t);
  const first = createSayloReact(), second = createSayloReact();
  function Wrong() { second.useI18nSelector(snapshot => snapshot.locale); return null; }
  assert.throws(() => renderToString(h(first.SayloProvider, { instance: store }, h(Wrong))), /same createSayloReact factory/);
  function Broken() { first.useI18nSelector(snapshot => snapshot.t('demo:missing')); return null; }
  const instance = { ...store, getServerSnapshot: store.getSnapshot };
  assert.throws(() => renderToString(h(first.SayloProvider, { instance }, h(Broken))), /Unknown message/);
});
