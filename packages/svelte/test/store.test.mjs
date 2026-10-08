import assert from 'node:assert/strict';
import test from 'node:test';
import { get } from 'svelte/store';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSvelteStore } from '@0disoft/saylo-svelte';

const catalog = (title, locale = 'ko') => parseCatalog(JSON.stringify({ title }), { locale, namespace: 'demo' });
const catalogs = (title = '한국어', english = 'English') => [catalog(title), catalog(english, 'en')];
function fixture(t) {
  const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: catalogs() });
  const subscriptions = new Set(), disposers = new Set();
  const track = (collection, subscribe) => listener => {
    const token = {};
    collection.add(token);
    const off = subscribe(listener);
    return () => { collection.delete(token); off(); };
  };
  const instance = { ...store, subscribe: track(subscriptions, store.subscribe), onDispose: track(disposers, store.onDispose) };
  t.after(() => store.dispose());
  return { store, instance, subscriptions, disposers };
}

test('synchronous initial value, shared subscription, immutable snapshots and bound t', t => {
  const { store, instance, subscriptions, disposers } = fixture(t);
  const i18n = createSvelteStore(instance);
  assert.equal(subscriptions.size, 0);
  const values = [];
  const off = i18n.subscribe(value => values.push(value));
  const other = i18n.subscribe(() => {});
  assert.equal(subscriptions.size, 1);
  assert.equal(disposers.size, 1);
  assert.equal(values[0].t('demo:title'), '한국어');
  store.replaceCatalogs(catalogs('새 한국어'));
  assert.equal(values.at(-1).t('demo:title'), '새 한국어');
  assert.equal(values[0].t('demo:title'), '한국어');
  assert.ok(Object.isFrozen(values.at(-1)));
  assert.equal(values.at(-1).setLocale, values[0].setLocale);
  const count = values.length;
  store.replaceCatalogs(catalogs('새 한국어', 'Updated English'));
  assert.equal(values.length, count);
  values.at(-1).setLocale('en');
  assert.equal(values.at(-1).t('demo:title'), 'Updated English');
  off(); off();
  assert.equal(subscriptions.size, 1);
  other();
  assert.equal(subscriptions.size, 0);
  assert.equal(disposers.size, 0);
  store.setLocale('ko');
  store.replaceCatalogs(catalogs('구독 없이 수정'));
  assert.equal(get(i18n).t('demo:title'), '구독 없이 수정');
  assert.equal(subscriptions.size, 0);
});

test('caller disposal releases adapter resources and consumer cleanup remains idempotent', t => {
  const { store, instance, subscriptions, disposers } = fixture(t);
  const off = createSvelteStore(instance).subscribe(() => {});
  store.dispose();
  assert.equal(subscriptions.size, 0);
  assert.equal(disposers.size, 0);
  off(); off();
});

test('lazy instance methods return the original async result and publish only committed state', async t => {
  const { store } = fixture(t);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const instance = { ...store, setLocale: async locale => { await pending; store.setLocale(locale); },
    loadNamespace: async namespace => { assert.equal(namespace, 'help'); } };
  const values = [];
  const off = createSvelteStore(instance).subscribe(value => values.push(value));
  t.after(off);
  const change = values[0].setLocale('en');
  assert.equal(values.length, 1);
  await values[0].loadNamespace('help');
  release(); await change;
  assert.equal(values.at(-1).locale, 'en');
  assert.equal(values[0].locale, 'ko');
});
