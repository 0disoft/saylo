import assert from 'node:assert/strict';
import test from 'node:test';
import { createRenderer, createSSRApp, h, isReadonly, nextTick } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSayloVue, useVueStore } from '@0disoft/saylo-vue';

const catalogs = (ko = '한국어', en = 'English') => [
  parseCatalog(JSON.stringify({ title: ko }), { locale: 'ko', namespace: 'demo' }),
  parseCatalog(JSON.stringify({ title: en }), { locale: 'en', namespace: 'demo' }),
];
function fixture(t, locale = 'ko') {
  const store = createStore({ baseLocale: 'ko', locale, catalogs: catalogs() });
  t.after(() => store.dispose());
  const subscriptions = new Set(), disposers = new Set();
  const track = (tokens, subscribe) => listener => {
    const token = {}; tokens.add(token);
    const off = subscribe(listener);
    return () => { tokens.delete(token); off(); };
  };
  return { store, subscriptions, disposers, instance: { ...store,
    subscribe: track(subscriptions, store.subscribe), onDispose: track(disposers, store.onDispose) } };
}
const element = type => ({ type, children: [], text: '', parent: null });
const renderer = createRenderer({
  createElement: element, createText: text => ({ ...element('text'), text }), createComment: element,
  setText: (node, text) => { node.text = text; }, setElementText: (node, text) => { node.text = text; node.children = []; },
  patchProp: () => {}, parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  insert(node, parent, anchor = null) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    const index = anchor ? parent.children.indexOf(anchor) : parent.children.length;
    parent.children.splice(index, 0, node); node.parent = parent;
  },
  remove(node) { node.parent?.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
});
function mount(t, component) {
  const root = element('root'), app = renderer.createApp(component);
  t.after(() => app.unmount());
  return { app, root, start() { app.mount(root); } };
}

test('mounted translations react to edits/locale, preserve snapshot t and release component resources', async t => {
  const f = fixture(t); let state;
  const ui = mount(t, { setup() { state = useVueStore(f.instance); return () => h('p', state.value.t('demo:title')); } });
  assert.equal(f.subscriptions.size, 0);
  ui.start();
  const first = state.value;
  assert.ok(Object.isFrozen(first)); assert.ok(isReadonly(state));
  assert.equal(f.subscriptions.size, 1); assert.equal(f.disposers.size, 1);
  f.store.replaceCatalogs(catalogs('수정됨')); await nextTick();
  assert.equal(ui.root.children[0].text, '수정됨');
  assert.equal(first.t('demo:title'), '한국어');
  assert.equal(state.value.setLocale, f.instance.setLocale);
  const stable = state.value;
  f.store.replaceCatalogs(catalogs('수정됨', 'New English'));
  assert.equal(state.value, stable);
  state.value.setLocale('en'); await nextTick();
  assert.equal(ui.root.children[0].text, 'New English');
  ui.app.unmount(); ui.app.unmount();
  assert.equal(f.subscriptions.size, 0); assert.equal(f.disposers.size, 0);
  f.store.setLocale('ko'); assert.equal(state.value.locale, 'en');
});

test('refreshes a catalog commit between setup and mount', async t => {
  const f = fixture(t); let state;
  const ui = mount(t, { setup() {
    state = useVueStore(f.instance);
    assert.equal(f.subscriptions.size, 0);
    f.store.replaceCatalogs(catalogs('마운트 전 수정'));
    return () => h('p', state.value.t('demo:title'));
  } });
  ui.start(); await nextTick();
  assert.equal(state.value.t('demo:title'), '마운트 전 수정');
  assert.equal(ui.root.children[0].text, '마운트 전 수정');
});

test('caller disposal stops both listener kinds; subsequent component cleanup is harmless', t => {
  const f = fixture(t);
  const ui = mount(t, { setup() { const state = useVueStore(f.instance); return () => h('p', state.value.locale); } });
  ui.start(); f.store.dispose();
  assert.equal(f.subscriptions.size, 0); assert.equal(f.disposers.size, 0);
  ui.app.unmount();
});

test('lazy actions return their original promises and publish only committed state', async t => {
  const f = fixture(t); let state, release;
  const gate = new Promise(resolve => { release = resolve; });
  const transition = gate.then(() => f.store.setLocale('en'));
  const namespace = Promise.resolve();
  const instance = { ...f.instance, setLocale: () => transition, loadNamespace: () => namespace };
  const ui = mount(t, { setup() { state = useVueStore(instance); return () => h('p', state.value.locale); } });
  ui.start();
  assert.equal(state.value.setLocale('en'), transition);
  assert.equal(state.value.loadNamespace('demo'), namespace);
  assert.equal(state.value.locale, 'ko');
  release(); await transition; await nextTick();
  assert.equal(state.value.locale, 'en');
});

test('SSR isolates concurrent requests and nested providers without retaining any subscriptions', async t => {
  const bindings = createSayloVue();
  const ko = fixture(t, 'ko'), en = fixture(t, 'en');
  const Read = { setup() { const state = bindings.useI18n(); return () => h('p', state.value.t('demo:title')); } };
  const Inner = { setup() { bindings.provideI18n(en.instance); return () => h(Read); } };
  const Outer = { setup() { bindings.provideI18n(ko.instance); return () => h('main', [h(Read), h(Inner), h(Read)]); } };
  const English = { setup() { bindings.provideI18n(en.instance); return () => h(Read); } };
  const result = await Promise.all([renderToString(createSSRApp(Outer)), renderToString(createSSRApp(English))]);
  assert.deepEqual(result, ['<main><p>한국어</p><p>English</p><p>한국어</p></main>', '<p>English</p>']);
  for (const f of [ko, en]) { assert.equal(f.subscriptions.size, 0); assert.equal(f.disposers.size, 0); }
});

test('rejects missing/mismatched factories and use outside component setup', t => {
  const f = fixture(t), first = createSayloVue(), second = createSayloVue();
  assert.throws(() => useVueStore(f.instance), /during component setup/);
  assert.throws(() => first.provideI18n(f.instance), /during component setup/);
  const Child = { setup() { second.useI18n(); return () => h('p'); } };
  const errors = [];
  const ui = mount(t, { setup() { first.provideI18n(f.instance); return () => h(Child); } });
  ui.app.config.warnHandler = () => {};
  ui.app.config.errorHandler = error => errors.push(error);
  ui.start();
  assert.match(errors[0].message, /same createSayloVue factory/);
  assert.equal(f.subscriptions.size, 0);
});

test('mount-time registration failure releases the already acquired subscription', t => {
  const f = fixture(t), errors = [];
  const ui = mount(t, { setup() {
    const state = useVueStore({ ...f.instance, onDispose: () => { throw new Error('registration failed'); } });
    return () => h('p', state.value.locale);
  } });
  ui.app.config.errorHandler = error => errors.push(error);
  ui.start();
  assert.equal(errors[0].message, 'registration failed');
  assert.equal(f.subscriptions.size, 0);
  assert.equal(f.store.getSnapshot().locale, 'ko');
});
