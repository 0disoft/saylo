import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement as h, StrictMode, useState } from 'react';
import { createBaseSchema, createI18n, createStore, parseCatalog } from '@saylo/core';
import { createSayloReact } from '@saylo/react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());

const catalog = (title, locale = 'ko') => parseCatalog(JSON.stringify({ title }), { locale, namespace: 'demo' });
const catalogs = (title = '한국어', english = 'English') => [catalog(title), catalog(english, 'en')];
function fixture(t, locale = 'ko') {
  const original = createStore({ baseLocale: 'ko', locale, catalogs: catalogs() });
  const active = new Set();
  let subscriptions = 0;
  const store = Object.freeze({ ...original, subscribe(callback) {
    subscriptions++;
    const token = {};
    active.add(token);
    const off = original.subscribe(callback);
    return () => { active.delete(token); off(); };
  } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  t.after(async () => { await act(() => root.unmount()); original.dispose(); container.remove(); });
  return { root, container, store, active, subscriptions: () => subscriptions };
}

test('lazy locale and namespace intents commit together without remounting React state', async t => {
  const { root, container } = fixture(t);
  const records = [...catalogs(), parseCatalog('{"title":"도움말"}', { locale: 'ko', namespace: 'help' }),
    parseCatalog('{"title":"Help"}', { locale: 'en', namespace: 'help' })];
  const fingerprint = ns => createBaseSchema(records.find(c => c.locale === 'ko' && c.namespace === ns)).fingerprint;
  const outcome = (locale, namespace) => ({ sessionId: 'one', status: 'present', key: { locale, namespace }, catalogVersion: 1,
    namespaceSchemaFingerprint: fingerprint(namespace), catalog: records.find(c => c.locale === locale && c.namespace === namespace) });
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const source = {
    readManifest: () => ({ sessionId: 'one', registryRevision: 0, baseLocale: 'ko', availableLocales: ['en', 'ko'], availableNamespaces: ['demo', 'help'],
      catalogs: records.map(c => ({ key: { locale: c.locale, namespace: c.namespace }, status: 'present', catalogVersion: 1, namespaceSchemaFingerprint: fingerprint(c.namespace) })) }),
    loadCatalog: async (locale, namespace) => { if (locale === 'en' && namespace === 'demo') await slow; return outcome(locale, namespace); },
  };
  const instance = createI18n({ catalogSource: source, locale: 'ko', initialNamespaces: ['demo'], initialCatalogs: [outcome('ko', 'demo')] });
  t.after(() => instance.dispose());
  const { SayloProvider, useI18n } = createSayloReact();
  let current;
  let commits = 0;
  instance.subscribe(() => commits++);
  function Form() {
    current = useI18n();
    const [count, setCount] = useState(0);
    return h('section', null, h('h1', null, current.t('demo:title')), h('input', { defaultValue: '' }),
      h('button', { onClick: () => setCount(v => v + 1) }, `${count}`), h('dialog', { open: count > 0 }, 'confirmation'),
      h('p', null, current.loadedNamespaces.includes('help') ? current.t('help:title') : 'not loaded'));
  }
  await act(() => root.render(h(StrictMode, null, h(SayloProvider, { instance }, h(Form)))));
  const input = container.querySelector('input');
  input.value = '비동기 입력 유지';
  await act(() => container.querySelector('button').click());
  input.focus(); input.setSelectionRange(2, 2);
  const before = current;
  let locale, namespace;
  await act(async () => { locale = current.setLocale('en'); namespace = current.loadNamespace('help'); await new Promise(resolve => setImmediate(resolve)); });
  assert.equal(container.querySelector('h1').textContent, '한국어');
  assert.equal(current, before);
  await act(async () => { release(); await Promise.all([locale, namespace]); });
  assert.equal(commits, 1);
  assert.equal(container.querySelector('h1').textContent, 'English');
  assert.equal(container.querySelector('p').textContent, 'Help');
  assert.equal(container.querySelector('input'), input);
  assert.equal(input.value, '비동기 입력 유지');
  assert.equal(document.activeElement, input);
  assert.equal(input.selectionStart, 2);
  assert.equal(container.querySelector('dialog').open, true);
  assert.equal(container.querySelector('button').textContent, '1');
  assert.equal(current.loadNamespace, before.loadNamespace);
  assert.equal(before.t('demo:title'), '한국어');
});

test('StrictMode preserves DOM, component state, focus and snapshot-bound t across catalog updates', async t => {
  const { root, store, container, active, subscriptions } = fixture(t);
  const { SayloProvider, useI18n } = createSayloReact();
  let current;
  function Form() {
    current = useI18n();
    const [count, setCount] = useState(0);
    const [open, setOpen] = useState(false);
    return h('section', null, h('h1', null, current.t('demo:title')),
      h('input', { defaultValue: '' }),
      h('button', { onClick: () => { setCount(value => value + 1); setOpen(true); } }, `${count}`),
      h('dialog', { open }, 'confirmation'));
  }
  await act(() => root.render(h(StrictMode, null, h(SayloProvider, { instance: store }, h(Form)))));
  const input = container.querySelector('input');
  const dialog = container.querySelector('dialog');
  input.value = '입력 유지';
  await act(() => container.querySelector('button').click());
  input.focus(); input.setSelectionRange(2, 2);
  const previous = current;
  const beforeSubscriptions = subscriptions();
  await act(() => store.replaceCatalogs(catalogs('새 한국어')));
  assert.equal(container.querySelector('h1').textContent, '새 한국어');
  assert.equal(container.querySelector('input'), input);
  assert.equal(input.value, '입력 유지');
  assert.equal(document.activeElement, input);
  assert.equal(input.selectionStart, 2);
  assert.equal(container.querySelector('dialog'), dialog);
  assert.equal(dialog.open, true);
  assert.equal(container.querySelector('button').textContent, '1');
  assert.equal(previous.t('demo:title'), '한국어');
  assert.equal(current.t('demo:title'), '새 한국어');
  assert.equal(previous.setLocale, current.setLocale);
  assert.equal(subscriptions(), beforeSubscriptions);
  assert.equal(active.size, 1);
  assert.ok(Object.isFrozen(current));
  await act(() => root.unmount());
  assert.equal(active.size, 0);
  store.setLocale('en'); // Provider unmount does not dispose caller-owned store.
});

test('equivalent and inactive edits skip renders; locale switch uses the updated catalog', async t => {
  const { root, store, container } = fixture(t);
  const { SayloProvider, useI18n } = createSayloReact();
  let renders = 0;
  let current;
  function Preview() { renders++; current = useI18n(); return h('h1', null, current.t('demo:title')); }
  await act(() => root.render(h(SayloProvider, { instance: store }, h(Preview))));
  const initial = current;
  const before = renders;
  await act(() => store.replaceCatalogs(catalogs()));
  await act(() => store.replaceCatalogs(catalogs('한국어', 'Updated English')));
  assert.equal(renders, before);
  assert.equal(current, initial);
  await act(() => current.setLocale('en'));
  assert.equal(container.querySelector('h1').textContent, 'Updated English');
  assert.equal(initial.t('demo:title'), '한국어');
});

test('provider instance replacement releases old subscription while preserving component state', async t => {
  const { root, store, container, active } = fixture(t);
  const other = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: catalogs('다른 store') });
  t.after(() => other.dispose());
  const { SayloProvider, useI18n } = createSayloReact();
  function Preview() {
    const { t } = useI18n();
    const [count, setCount] = useState(0);
    return h('button', { onClick: () => setCount(value => value + 1) }, `${t('demo:title')} ${count}`);
  }
  await act(() => root.render(h(SayloProvider, { instance: store }, h(Preview))));
  const button = container.querySelector('button');
  await act(() => button.click());
  await act(() => root.render(h(SayloProvider, { instance: other }, h(Preview))));
  assert.equal(active.size, 0);
  assert.equal(container.querySelector('button'), button);
  assert.equal(button.textContent, '다른 store 1');
  await act(() => store.replaceCatalogs(catalogs('오래된 store')));
  assert.equal(button.textContent, '다른 store 1');
  await act(() => other.replaceCatalogs(catalogs('새 store')));
  assert.equal(button.textContent, '새 store 1');
  await act(() => root.unmount());
});

test('independent factories and nested providers read their own nearest store', async t => {
  const { root, store, container } = fixture(t);
  const other = createStore({ baseLocale: 'ko', locale: 'en', catalogs: catalogs() });
  t.after(() => other.dispose());
  const first = createSayloReact();
  const second = createSayloReact();
  function Preview({ name, hook }) { return h('p', { 'data-name': name }, hook().t('demo:title')); }
  await act(() => root.render(h(first.SayloProvider, { instance: store },
    h(Preview, { name: 'outer', hook: first.useI18n }),
    h(first.SayloProvider, { instance: other }, h(Preview, { name: 'nested', hook: first.useI18n })),
    h(second.SayloProvider, { instance: other }, h(Preview, { name: 'independent', hook: second.useI18n })))));
  assert.deepEqual([...container.querySelectorAll('p')].map(node => node.textContent), ['한국어', 'English', 'English']);
  await act(() => store.replaceCatalogs(catalogs('바깥')));
  assert.deepEqual([...container.querySelectorAll('p')].map(node => node.textContent), ['바깥', 'English', 'English']);
  await act(() => root.unmount());
});

test('hook outside its matching provider reports a clear error', async t => {
  const { root, store } = fixture(t);
  const first = createSayloReact();
  const second = createSayloReact();
  function WrongConsumer() { second.useI18n(); return null; }
  await assert.rejects(async () => { await act(() => root.render(h(first.SayloProvider, { instance: store }, h(WrongConsumer)))); }, /same createSayloReact factory/);
});
