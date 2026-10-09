import assert from 'node:assert/strict';
import test from 'node:test';
import { derived, get } from 'svelte/store';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSvelteStore, selectSvelteStore } from '@0disoft/saylo-svelte';

const catalog = (title, note, locale = 'ko') => parseCatalog(JSON.stringify({ title, note }), { locale, namespace: 'demo' });
const catalogs = (title = '한국어', note = '메모') => [catalog(title, note), catalog('English', 'Note', 'en')];
function fixture(t) {
  const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: catalogs() });
  const subscriptions = new Set(), disposers = new Set();
  const track = (collection, subscribe) => listener => {
    const token = {}; collection.add(token);
    const off = subscribe(listener);
    return () => { collection.delete(token); off(); };
  };
  const instance = { ...store, subscribe: track(subscriptions, store.subscribe), onDispose: track(disposers, store.onDispose) };
  t.after(() => store.dispose());
  return { store, source: createSvelteStore(instance), subscriptions, disposers };
}

test('selected stores skip unrelated edits and share the source until the final consumer leaves', t => {
  const { store, source, subscriptions, disposers } = fixture(t);
  const title = selectSvelteStore(source, snapshot => snapshot.t('demo:title'));
  const locale = selectSvelteStore(source, snapshot => snapshot.locale);
  const titles = [], languages = [], duplicate = [];
  let invalidations = 0;
  const offTitle = title.subscribe(value => titles.push(value), () => invalidations++);
  const offDuplicate = title.subscribe(value => duplicate.push(value));
  const offLocale = locale.subscribe(value => languages.push(value));
  assert.deepEqual(titles, ['한국어']);
  assert.equal(subscriptions.size, 1);
  assert.equal(disposers.size, 1);
  const previous = store.getSnapshot();
  store.replaceCatalogs(catalogs('한국어', '다른 메모'));
  assert.notEqual(store.getSnapshot(), previous);
  assert.deepEqual(titles, ['한국어']);
  assert.deepEqual(languages, ['ko']);
  assert.equal(invalidations, 0);
  store.replaceCatalogs(catalogs('수정 제목', '다른 메모'));
  assert.deepEqual(titles, ['한국어', '수정 제목']);
  assert.equal(invalidations, 1);
  store.setLocale('en');
  assert.deepEqual(titles, ['한국어', '수정 제목', 'English']);
  assert.deepEqual(duplicate, titles);
  assert.deepEqual(languages, ['ko', 'en']);
  offTitle(); offTitle(); offDuplicate();
  assert.equal(subscriptions.size, 1);
  offLocale();
  assert.equal(subscriptions.size, 0);
  assert.equal(disposers.size, 0);
  store.setLocale('ko');
});

test('Object.is suppresses stable objects, functions, undefined and NaN but distinguishes signed zero', t => {
  const { store, source } = fixture(t);
  const stable = Object.freeze({ id: 'constant' });
  const selectors = [() => stable, snapshot => snapshot.setLocale, () => undefined, () => NaN];
  const values = selectors.map(() => []);
  const offs = selectors.map((selector, index) => selectSvelteStore(source, selector).subscribe(value => values[index].push(value)));
  const zeros = [];
  offs.push(selectSvelteStore(source, snapshot => snapshot.locale === 'ko' ? 0 : -0).subscribe(value => zeros.push(value)));
  t.after(() => offs.forEach(off => off()));
  store.replaceCatalogs(catalogs('수정 제목'));
  store.setLocale('en');
  assert.ok(values.every(entries => entries.length === 1));
  assert.equal(values[0][0], stable);
  assert.equal(values[1][0], store.setLocale);
  assert.equal(values[2][0], undefined);
  assert.ok(Number.isNaN(values[3][0]));
  assert.equal(zeros.length, 2);
  assert.ok(Object.is(zeros[0], 0));
  assert.ok(Object.is(zeros[1], -0));
});

test('resubscription and synchronous SSR reads refresh dormant selections without keeping resources', t => {
  const { store, source, subscriptions, disposers } = fixture(t);
  const selection = selectSvelteStore(source, snapshot => snapshot);
  const before = get(selection);
  assert.equal(subscriptions.size, 0);
  store.replaceCatalogs(catalogs('구독 없이 수정'));
  const after = get(selection);
  assert.equal(after.t('demo:title'), '구독 없이 수정');
  assert.equal(before.t('demo:title'), '한국어');
  assert.equal(after.setLocale, store.setLocale);
  assert.equal(after.loadNamespace, undefined);
  assert.equal(subscriptions.size, 0);
  assert.equal(disposers.size, 0);
  const off = selection.subscribe(() => {});
  store.dispose();
  assert.equal(subscriptions.size, 0);
  assert.equal(disposers.size, 0);
  off(); off();
});

test('selected stores compose with Svelte derived without mixed revisions or stalled unchanged branches', t => {
  const { store, source } = fixture(t);
  const title = selectSvelteStore(source, snapshot => snapshot.t('demo:title'));
  const locale = selectSvelteStore(source, snapshot => snapshot.locale);
  const combined = derived([title, locale], ([title, locale]) => `${locale}|${title}`);
  const values = [];
  const off = combined.subscribe(value => values.push(value));
  t.after(off);
  store.replaceCatalogs(catalogs('한국어', '메모 수정'));
  store.setLocale('en');
  store.setLocale('ko');
  assert.deepEqual(values, ['ko|한국어', 'en|English', 'ko|한국어']);
});

test('initial selector failures release subscriptions and later SSR reads can recover', t => {
  const { store, source, subscriptions, disposers } = fixture(t);
  const failure = new Error('initial selection failed');
  let broken = true;
  const selection = selectSvelteStore(source, snapshot => {
    if (broken) throw failure;
    return snapshot.t('demo:title');
  });
  for (const subscribe of [() => selection.subscribe(() => assert.fail('failed selection cannot publish')), () => get(selection)]) {
    assert.throws(subscribe, error => error === failure);
    assert.equal(subscriptions.size, 0);
    assert.equal(disposers.size, 0);
  }
  broken = false;
  assert.equal(get(selection), '한국어');
  broken = true;
  assert.throws(() => get(selection), error => error === failure);
  assert.equal(subscriptions.size, 0);
  assert.equal(disposers.size, 0);
  broken = false;
  store.setLocale('en');
  assert.equal(get(selection), 'English');
});

test('a failed new selector leaves a healthy shared source subscribed without retaining its own listener', t => {
  const { store, source, subscriptions, disposers } = fixture(t);
  const locale = selectSvelteStore(source, snapshot => snapshot.locale);
  const locales = [];
  const off = locale.subscribe(value => locales.push(value));
  t.after(off);
  let calls = 0;
  const failed = selectSvelteStore(source, () => { calls++; throw undefined; });
  let threw = false;
  try { get(failed); } catch (error) { threw = true; assert.equal(error, undefined); }
  assert.equal(threw, true);
  store.setLocale('en');
  assert.equal(calls, 1);
  assert.deepEqual(locales, ['ko', 'en']);
  assert.equal(subscriptions.size, 1);
  off();
  assert.equal(subscriptions.size, 0);
  assert.equal(disposers.size, 0);
});

test('live selector errors retain the last value, report once and recover without stalling other derived stores', t => {
  const { store, source, subscriptions, disposers } = fixture(t);
  const errors = [], values = [], locales = [];
  let invalidations = 0;
  const selection = selectSvelteStore(source, snapshot => snapshot.t('demo:title'), { onError: error => errors.push(error) });
  const healthy = derived(selectSvelteStore(source, snapshot => snapshot.locale), value => `locale:${value}`);
  const off = selection.subscribe(value => values.push(value), () => invalidations++);
  const offHealthy = healthy.subscribe(value => locales.push(value));
  t.after(() => { off(); offHealthy(); });
  const missing = ['ko', 'en'].map(locale => parseCatalog('{"note":"Only note"}', { locale, namespace: 'demo' }));
  assert.doesNotThrow(() => store.replaceCatalogs(missing));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].name, 'UnknownMessageError');
  assert.deepEqual(values, ['한국어']);
  assert.equal(invalidations, 0);
  assert.doesNotThrow(() => store.setLocale('en'));
  assert.deepEqual(locales, ['locale:ko', 'locale:en']);
  store.replaceCatalogs(catalogs('복구 제목'));
  assert.deepEqual(values, ['한국어', 'English']);
  assert.equal(invalidations, 1);
  off(); offHealthy();
  assert.equal(subscriptions.size, 0);
  assert.equal(disposers.size, 0);
});

test('default reporting and a throwing reporter preserve the Svelte notification queue', t => {
  const { store, source } = fixture(t);
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args));
  const failure = new Error('selector failed'), reporterFailure = new Error('reporter failed');
  let broken = false;
  const selector = snapshot => { if (broken) throw failure; return snapshot.locale; };
  const defaults = selectSvelteStore(source, selector);
  const explicit = selectSvelteStore(source, selector, { onError() { throw reporterFailure; } });
  const first = [], second = [];
  const offFirst = defaults.subscribe(value => first.push(value));
  const offSecond = explicit.subscribe(value => second.push(value));
  t.after(() => { offFirst(); offSecond(); });
  broken = true;
  assert.doesNotThrow(() => store.setLocale('en'));
  assert.deepEqual(logged, [['[saylo:svelte] selector failed', failure], ['[saylo:svelte] selector error reporter failed', reporterFailure]]);
  broken = false;
  store.setLocale('ko');
  store.setLocale('en');
  assert.deepEqual(first, ['ko', 'en']);
  assert.deepEqual(second, first);
});
