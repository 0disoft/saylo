import assert from 'node:assert/strict';
import test from 'node:test';
import { createRenderer, createSSRApp, h, isReadonly, nextTick, ref, watch } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSayloVue, useVueStore, useVueSelector } from '@0disoft/saylo-vue';

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

test('mount errors retain their cause when subscription cleanup also throws', t => {
  const f = fixture(t), errors = [];
  const setup = new Error('registration failed'), cleanup = new Error('cleanup failed');
  const ui = mount(t, { setup() {
    const state = useVueStore({ ...f.instance,
      subscribe(listener) { const off = f.instance.subscribe(listener); return () => { off(); throw cleanup; }; },
      onDispose() { throw setup; },
    });
    return () => h('p', state.value.locale);
  } });
  ui.app.config.errorHandler = error => errors.push(error);
  ui.start();
  assert.equal(f.subscriptions.size, 0);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof AggregateError);
  assert.deepEqual(errors[0].errors, [setup, cleanup]);
  assert.equal(errors[0].cause, setup);
});

test('app plugins isolate mounted roots and leave instance disposal to the caller', async t => {
  const bindings = createSayloVue();
  const ko = fixture(t, 'ko'), en = fixture(t, 'en');
  const Root = { setup() { const state = bindings.useI18n(); return () => h('p', state.value.t('demo:title')); } };
  const first = mount(t, Root), second = mount(t, Root);
  first.app.use(bindings.createPlugin(ko.instance));
  second.app.use(bindings.createPlugin(en.instance));
  for (const f of [ko, en]) { assert.equal(f.subscriptions.size, 0); assert.equal(f.disposers.size, 0); }
  first.start(); second.start();
  assert.equal(first.root.children[0].text, '한국어');
  assert.equal(second.root.children[0].text, 'English');
  ko.store.replaceCatalogs(catalogs('앱 하나만 수정')); await nextTick();
  assert.equal(first.root.children[0].text, '앱 하나만 수정');
  assert.equal(second.root.children[0].text, 'English');
  first.app.unmount();
  assert.equal(ko.subscriptions.size, 0); assert.equal(ko.disposers.size, 0);
  assert.equal(en.subscriptions.size, 1); assert.equal(en.disposers.size, 1);
  ko.store.setLocale('en'); assert.equal(ko.store.getSnapshot().locale, 'en');
  second.app.unmount();
  assert.equal(en.subscriptions.size, 0); assert.equal(en.disposers.size, 0);
  en.store.setLocale('ko'); assert.equal(en.store.getSnapshot().locale, 'ko');
});

test('app plugin SSR preserves component overrides and concurrent request isolation', async t => {
  const bindings = createSayloVue();
  const ko = fixture(t, 'ko'), en = fixture(t, 'en');
  const Read = { setup() { const state = bindings.useI18n(); return () => h('p', state.value.t('demo:title')); } };
  const Inner = { setup() { bindings.provideI18n(en.instance); return () => h(Read); } };
  const Root = { setup() { return () => h('main', [h(Read), h(Inner), h(Read)]); } };
  const result = await Promise.all([
    renderToString(createSSRApp(Root).use(bindings.createPlugin(ko.instance))),
    renderToString(createSSRApp(Read).use(bindings.createPlugin(en.instance))),
  ]);
  assert.deepEqual(result, ['<main><p>한국어</p><p>English</p><p>한국어</p></main>', '<p>English</p>']);
  for (const f of [ko, en]) { assert.equal(f.subscriptions.size, 0); assert.equal(f.disposers.size, 0); }
});

test('plugin reinstall retains the original instance and mismatched factories stay isolated', t => {
  const first = createSayloVue(), second = createSayloVue();
  const ko = fixture(t, 'ko'), en = fixture(t, 'en');
  const Root = { setup() { const state = first.useI18n(); return () => h('p', state.value.locale); } };
  const ui = mount(t, Root);
  ui.app.use(first.createPlugin(ko.instance));
  // New plugin objects for the same caller-owned instance do not overwrite provide.
  ui.app.use(first.createPlugin(ko.instance));
  assert.throws(() => ui.app.use(first.createPlugin(en.instance)), /different instance/);
  ui.start(); assert.equal(ui.root.children[0].text, 'ko');
  const errors = [];
  const other = mount(t, { setup() { second.useI18n(); return () => h('p'); } });
  other.app.config.warnHandler = () => {};
  other.app.config.errorHandler = error => errors.push(error);
  other.app.use(first.createPlugin(ko.instance)); other.start();
  assert.match(errors[0].message, /same createSayloVue factory/);
});

test('selector skips unrelated renders and shares setup/mount/disposal ownership', async t => {
  const f = fixture(t), bindings = createSayloVue();
  let selected, renders = 0;
  const ui = mount(t, { setup() {
    selected = bindings.useI18nSelector(snapshot => snapshot.t('demo:title'));
    assert.ok(isReadonly(selected));
    assert.equal(f.subscriptions.size, 0);
    // The mounted refresh must include this edit too.
    f.store.replaceCatalogs(catalogs('Before mount'));
    return () => { renders++; return h('p', selected.value); };
  } });
  ui.app.use(bindings.createPlugin(f.instance)); ui.start(); await nextTick();
  assert.equal(ui.root.children[0].text, 'Before mount');
  const rendered = renders;
  const withOther = value => [...catalogs('Before mount'), parseCatalog(JSON.stringify({ title: value }), { locale: 'ko', namespace: 'other' })];
  f.store.replaceCatalogs(withOther('new unrelated value')); await nextTick();
  assert.equal(renders, rendered);
  assert.equal(f.subscriptions.size, 1); assert.equal(f.disposers.size, 1);
  f.store.replaceCatalogs(catalogs('Changed')); await nextTick();
  assert.equal(ui.root.children[0].text, 'Changed');
  assert.equal(renders, rendered + 1);
  f.store.dispose();
  assert.equal(f.subscriptions.size, 0); assert.equal(f.disposers.size, 0);
  ui.app.unmount();
});

test('selector tracks reactive arguments and retries a failed read after correction', async t => {
  const f = fixture(t), suffix = ref('one'), fail = ref(false);
  let selected;
  const errors = [];
  const ui = mount(t, { setup() {
    selected = useVueSelector(f.instance, snapshot => {
      if (fail.value) throw new Error('selection failed');
      return `${snapshot.t('demo:title')} ${suffix.value}`;
    });
    return () => h('p', selected.value);
  } });
  ui.app.config.errorHandler = error => errors.push(error);
  ui.start(); suffix.value = 'two'; await nextTick();
  assert.equal(ui.root.children[0].text, '한국어 two');
  fail.value = true; await nextTick();
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /selection failed/);
  fail.value = false; f.store.setLocale('en'); await nextTick();
  assert.equal(ui.root.children[0].text, 'English two');
  ui.app.unmount();
  assert.equal(f.subscriptions.size, 0); assert.equal(f.disposers.size, 0);
});

test('selector compares stable references, NaN and signed zero using Object.is', async t => {
  const f = fixture(t), input = ref(NaN), object = Object.freeze({ label: 'same' });
  const values = [];
  const ui = mount(t, { setup() {
    const selected = useVueSelector(f.instance, () => input.value);
    const stable = useVueSelector(f.instance, () => object);
    watch(selected, value => values.push(value), { immediate: true });
    watch(stable, () => values.push('object'), { immediate: true });
    return () => h('p', String(selected.value));
  } });
  ui.start(); input.value = NaN; f.store.setLocale('en'); await nextTick();
  assert.deepEqual(values, [NaN, 'object']);
  input.value = 0; await nextTick(); input.value = -0; await nextTick();
  assert.deepEqual(values, [NaN, 'object', 0, -0]);
});

test('selector SSR isolates requests/providers with no subscriptions and enforces setup/factory', async t => {
  const bindings = createSayloVue(), other = createSayloVue();
  const ko = fixture(t, 'ko'), en = fixture(t, 'en');
  assert.throws(() => useVueSelector(ko.instance, snapshot => snapshot.locale), /during component setup/);
  assert.throws(() => bindings.useI18nSelector(snapshot => snapshot.locale), /during component setup/);
  const Read = { setup() { const title = bindings.useI18nSelector(snapshot => snapshot.t('demo:title')); return () => h('p', title.value); } };
  const Inner = { setup() { bindings.provideI18n(en.instance); return () => h(Read); } };
  const Root = { render: () => h('main', [h(Read), h(Inner), h(Read)]) };
  assert.deepEqual(await Promise.all([
    renderToString(createSSRApp(Root).use(bindings.createPlugin(ko.instance))),
    renderToString(createSSRApp(Read).use(bindings.createPlugin(en.instance))),
  ]), ['<main><p>한국어</p><p>English</p><p>한국어</p></main>', '<p>English</p>']);
  for (const f of [ko, en]) { assert.equal(f.subscriptions.size, 0); assert.equal(f.disposers.size, 0); }
  const errors = [];
  const ui = mount(t, { setup() { other.useI18nSelector(snapshot => snapshot.locale); return () => h('p'); } });
  ui.app.config.warnHandler = () => {};
  ui.app.config.errorHandler = error => errors.push(error);
  ui.app.use(bindings.createPlugin(ko.instance)); ui.start();
  assert.match(errors[0].message, /same createSayloVue factory/);
});
