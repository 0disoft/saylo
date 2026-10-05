import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CatalogError, createStore, parseCatalog } from '@saylo/core';

const catalog = (title, locale = 'ko', namespace = 'cart') => parseCatalog(JSON.stringify({ title }), { locale, namespace });
const initial = () => [catalog('장바구니'), catalog('Cart', 'en'), catalog('Panier', 'fr')];
const store = () => createStore({ baseLocale: 'ko', locale: 'en', catalogs: initial() });

test('snapshots are stable, immutable and keep their own translator after replacement', () => {
  const i18n = store();
  const before = i18n.getSnapshot();
  assert.equal(before, i18n.getSnapshot());
  assert.equal(before.stateRevision, 0);
  assert.throws(() => { before.locale = 'fr'; }, TypeError);
  assert.throws(() => { before.availableLocales.push('de'); }, TypeError);
  let notifications = 0;
  i18n.subscribe(snapshot => {
    notifications++;
    assert.equal(snapshot, i18n.getSnapshot());
    assert.equal(snapshot.t('cart:title'), i18n.t('cart:title'));
  });
  i18n.replaceCatalogs([catalog('장바구니'), catalog('Basket', 'en'), catalog('Panier', 'fr')]);
  assert.equal(i18n.t('cart:title'), 'Basket');
  assert.equal(before.t('cart:title'), 'Cart');
  assert.equal(i18n.getSnapshot().stateRevision, 1);
  assert.equal(notifications, 1);
});

test('equivalent catalogs and inactive edits do not force a new UI snapshot', () => {
  const i18n = store();
  const before = i18n.getSnapshot();
  let notifications = 0;
  i18n.subscribe(() => notifications++);
  i18n.replaceCatalogs(initial().reverse());
  assert.equal(i18n.getSnapshot(), before);
  i18n.replaceCatalogs([catalog('장바구니'), catalog('Cart', 'en'), catalog('Nouveau', 'fr')]);
  assert.equal(i18n.getSnapshot(), before);
  assert.equal(notifications, 0);
  i18n.setLocale('fr');
  assert.equal(i18n.t('cart:title'), 'Nouveau');
  assert.equal(notifications, 1);
});

test('locale and namespace lists change atomically; removal selects base fallback', () => {
  const i18n = store();
  const seen = [];
  i18n.subscribe(s => seen.push([s.locale, s.availableLocales.join(','), s.loadedNamespaces.join(',')]));
  i18n.replaceCatalogs([...initial(), catalog('Hallo', 'de'), catalog('공통', 'ko', 'common')]);
  assert.deepEqual(seen, [['en', 'de,en,fr,ko', 'cart,common']]);
  i18n.replaceCatalogs([catalog('기준값')]);
  assert.equal(i18n.getSnapshot().locale, 'ko');
  assert.equal(i18n.t('cart:title'), '기준값');
  assert.equal(seen.length, 2);
});

test('invalid candidates leave last good snapshot and subscriber count intact', () => {
  const i18n = store();
  const before = i18n.getSnapshot();
  let notifications = 0;
  i18n.subscribe(() => notifications++);
  assert.throws(() => i18n.replaceCatalogs([catalog('Cart', 'en')]), RangeError);
  assert.throws(() => i18n.replaceCatalogs([catalog('{n}'), catalog('{n, number}', 'en')]), CatalogError);
  assert.throws(() => i18n.replaceCatalogs([...initial(), catalog('Duplicate', 'en')]), CatalogError);
  assert.throws(() => i18n.setLocale('de'), RangeError);
  assert.equal(i18n.getSnapshot(), before);
  assert.equal(notifications, 0);
});

test('reentrant updates wait until all subscribers finish the current snapshot', () => {
  const i18n = store();
  const seen = [];
  i18n.subscribe(s => {
    seen.push(`A:${s.locale}`);
    if (s.locale === 'fr') i18n.setLocale('ko');
    assert.equal(i18n.getSnapshot(), s);
  });
  i18n.subscribe(s => {
    seen.push(`B:${s.locale}`);
    assert.equal(i18n.getSnapshot(), s);
  });
  i18n.setLocale('fr');
  assert.deepEqual(seen, ['A:fr', 'B:fr', 'A:ko', 'B:ko']);
  assert.equal(i18n.getSnapshot().stateRevision, 2);
});

test('subscriber exceptions do not prevent notification or undo the commit', () => {
  const i18n = store();
  const stop = i18n.subscribe(() => { throw new Error('subscriber failed'); });
  let observed;
  i18n.subscribe(s => { observed = s; });
  assert.throws(() => i18n.setLocale('fr'), AggregateError);
  assert.equal(observed, i18n.getSnapshot());
  assert.equal(i18n.t('cart:title'), 'Panier');
  stop();
  i18n.setLocale('ko');
  assert.equal(i18n.t('cart:title'), '장바구니');
});

test('subscriptions have independent idempotent cleanup; dispose freezes current state', () => {
  const i18n = store();
  let calls = 0;
  const callback = () => calls++;
  const stopFirst = i18n.subscribe(callback);
  i18n.subscribe(callback);
  stopFirst();
  stopFirst();
  i18n.setLocale('fr');
  assert.equal(calls, 1);
  const last = i18n.getSnapshot();
  i18n.dispose();
  i18n.dispose();
  assert.throws(() => i18n.setLocale('ko'), /disposed/);
  assert.throws(() => i18n.replaceCatalogs(initial()), /disposed/);
  assert.throws(() => i18n.subscribe(callback), /disposed/);
  assert.equal(i18n.getSnapshot(), last);
  assert.equal(last.t('cart:title'), 'Panier');
});

test('catalog text replacement retains native Intl caches across snapshots', () => {
  const NativeNumberFormat = Intl.NumberFormat;
  let created = 0;
  Intl.NumberFormat = class extends NativeNumberFormat {
    constructor(...args) { super(...args); created++; }
  };
  try {
    const i18n = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [catalog('합계 {n, number}')] });
    assert.equal(i18n.t('cart:title', { n: 3 }), '합계 3');
    i18n.replaceCatalogs([catalog('새 합계 {n, number}')]);
    assert.equal(i18n.t('cart:title', { n: 4 }), '새 합계 4');
    assert.equal(created, 1);
  } finally { Intl.NumberFormat = NativeNumberFormat; }
});
