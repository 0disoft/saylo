import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CatalogError, createStore, parseCatalog } from '@0disoft/saylo-core';

const catalog = (title, locale = 'ko', namespace = 'cart') => parseCatalog(JSON.stringify({ title }), { locale, namespace });
const initial = () => [catalog('장바구니'), catalog('Cart', 'en'), catalog('Panier', 'fr')];
const store = () => createStore({ baseLocale: 'ko', locale: 'en', catalogs: initial() });

test('disposal releases all adapter resources once, including after a cleanup failure', () => {
  const i18n = store();
  const calls = [];
  const remove = i18n.onDispose(() => calls.push('removed'));
  remove(); remove();
  i18n.onDispose(() => { calls.push('first'); i18n.dispose(); throw new Error('cleanup failed'); });
  i18n.onDispose(() => calls.push('second'));
  assert.throws(() => i18n.dispose(), AggregateError);
  assert.deepEqual(calls, ['first', 'second']);
  i18n.dispose();
  assert.throws(() => i18n.onDispose(() => {}), /disposed/);
});

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

test('error policy callbacks stay bound to eager snapshots across locale changes and replacement', () => {
  const seen = [];
  const options = {
    baseLocale: 'ko', locale: 'en', catalogs: initial(),
    onMissingKey: context => { seen.push(context); return `missing:${context.locale}:${context.surface}`; },
    onFormatError: context => `format:${context.locale}`,
  };
  const i18n = createStore(options);
  const before = i18n.getSnapshot();
  options.onMissingKey = () => 'mutated after creation';
  assert.equal(before.t('cart:missing'), 'missing:en:text');
  assert.deepEqual(before.tParts('cart:missing'), [{ type: 'text', value: 'missing:en:parts' }]);
  i18n.setLocale('ko');
  assert.equal(i18n.t('cart:missing'), 'missing:ko:text');
  i18n.replaceCatalogs([catalog('새 기준'), catalog('New', 'en'), catalog('Nouveau', 'fr')]);
  assert.equal(i18n.t('cart:missing'), 'missing:ko:text');
  assert.equal(seen[0].baseLocale, 'ko');
  assert.equal(seen[0].error instanceof Error, true);
  assert.equal(seen[1].surface, 'parts');
  assert.equal(seen[2].locale, 'ko');
  i18n.replaceCatalogs([
    parseCatalog('{"items":"{n, number}"}', { locale: 'ko', namespace: 'cart' }),
    parseCatalog('{"items":"{n, number}"}', { locale: 'en', namespace: 'cart' }),
  ]);
  assert.equal(i18n.t('cart:items'), 'format:ko');
  i18n.setLocale('en');
  assert.equal(i18n.t('cart:items'), 'format:en');
  i18n.dispose();
});

test('mutable inputs cannot change published snapshots before or after explicit publication', () => {
  const base = structuredClone(catalog('Before'));
  const translation = structuredClone(catalog('Original', 'en'));
  const i18n = createStore({ baseLocale: 'ko', locale: 'en', catalogs: [base, translation] });
  const before = i18n.getSnapshot();
  let notifications = 0;
  i18n.subscribe(() => notifications++);
  try {
    translation.messages.title = structuredClone(catalog('Edited', 'en').messages.title);
    assert.equal(before.t('cart:title'), 'Original');
    assert.equal(i18n.t('cart:title'), 'Original');
    assert.equal(i18n.getSnapshot(), before);
    assert.equal(notifications, 0);
    i18n.setLocale('en');
    assert.equal(i18n.t('cart:title'), 'Edited');
    assert.equal(before.t('cart:title'), 'Original');
    assert.equal(i18n.getSnapshot().stateRevision, 1);
    assert.equal(notifications, 1);
    const published = i18n.getSnapshot();
    delete translation.messages.title;
    base.messages.title = structuredClone(catalog('New fallback').messages.title);
    assert.equal(published.t('cart:title'), 'Edited');
    i18n.replaceCatalogs([base, translation]);
    assert.equal(i18n.t('cart:title'), 'New fallback');
    assert.equal(published.t('cart:title'), 'Edited');
    assert.equal(before.t('cart:title'), 'Original');
    assert.equal(i18n.getSnapshot().stateRevision, 2);
    assert.equal(notifications, 2);
    assert.equal(Object.isFrozen(base), false);
    assert.equal(Object.isFrozen(translation), false);
  } finally { i18n.dispose(); }
  base.messages.title = structuredClone(catalog('After disposal').messages.title);
  assert.equal(i18n.t('cart:title'), 'New fallback');
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

test('reselecting an immutable registry locale never enumerates message keys', () => {
  const catalogs = initial();
  const i18n = createStore({ baseLocale: 'ko', locale: 'en', catalogs });
  const before = i18n.getSnapshot();
  const messageMaps = new Set(catalogs.map(c => c.messages));
  const nativeKeys = Object.keys;
  let enumerations = 0, notifications = 0;
  i18n.subscribe(() => notifications++);
  try {
    Object.keys = value => {
      if (messageMaps.has(value)) enumerations++;
      return nativeKeys(value);
    };
    for (let i = 0; i < 25; i++) i18n.setLocale('EN');
  } finally { Object.keys = nativeKeys; i18n.dispose(); }
  assert.equal(enumerations, 0);
  assert.equal(notifications, 0);
  assert.equal(i18n.getSnapshot(), before);
});

test('warm locale switches reuse immutable signatures without enumerating message maps', () => {
  const catalogs = initial();
  const i18n = createStore({ baseLocale: 'ko', locale: 'en', catalogs });
  for (const locale of ['fr', 'ko', 'en']) i18n.setLocale(locale);
  const before = i18n.getSnapshot();
  const messageMaps = new Set(catalogs.map(catalog => catalog.messages));
  const nativeKeys = Object.keys;
  let enumerations = 0, notifications = 0;
  i18n.subscribe(() => notifications++);
  try {
    Object.keys = value => {
      if (messageMaps.has(value)) enumerations++;
      return nativeKeys(value);
    };
    for (const [locale, expected] of [['fr', 'Panier'], ['ko', '장바구니'], ['en', 'Cart']]) {
      i18n.setLocale(locale);
      assert.equal(i18n.t('cart:title'), expected);
    }
  } finally { Object.keys = nativeKeys; i18n.dispose(); }
  assert.equal(enumerations, 0);
  assert.equal(notifications, 3);
  assert.equal(before.t('cart:title'), 'Cart');
  assert.equal(i18n.getSnapshot().stateRevision, before.stateRevision + 3);
});

test('same-locale selections still detect changes in mutable catalog inputs', () => {
  const mutable = structuredClone(catalog('Before'));
  const i18n = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [mutable] });
  let notifications = 0;
  i18n.subscribe(() => notifications++);
  const selectAfterEdit = title => {
    mutable.messages.title = structuredClone(catalog(title).messages.title);
    i18n.setLocale('ko');
    assert.equal(i18n.t('cart:title'), title);
  };
  selectAfterEdit('After');
  // A shallow freeze is not proof that child messages are immutable.
  Object.freeze(mutable);
  i18n.replaceCatalogs([mutable]);
  selectAfterEdit('Still mutable');
  // Registry replacement must refresh the eligibility of the fast path.
  i18n.replaceCatalogs([catalog('Immutable')]);
  i18n.replaceCatalogs([mutable]);
  selectAfterEdit('Mutable again');
  assert.equal(notifications, 5);
  i18n.dispose();
});

test('same-locale optimization compares the planned locale during reentrant selections', () => {
  const i18n = store();
  const seen = [];
  i18n.subscribe(snapshot => {
    seen.push(snapshot.locale);
    if (snapshot.stateRevision === 1) {
      i18n.setLocale('ko');
      i18n.setLocale('fr');
      i18n.setLocale('fr');
    }
  });
  i18n.setLocale('fr');
  assert.deepEqual(seen, ['fr', 'ko', 'fr']);
  assert.equal(i18n.getSnapshot().stateRevision, 3);
  i18n.dispose();
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

test('explicit eager fallback locales follow selected locale changes and replacement atomically', () => {
  const record = (messages, locale) => parseCatalog(JSON.stringify(messages), { locale, namespace: 'cart' });
  const catalogs = () => [
    record({ title: 'Base', parent: 'Base parent', baseOnly: 'Base only' }, 'ko'),
    record({ title: 'English', parent: 'English parent' }, 'en'),
    record({ title: 'Français' }, 'fr'),
    record({ title: 'British' }, 'en-GB'),
  ];
  const i18n = createStore({ baseLocale: 'ko', locale: 'fr', catalogs: catalogs(), fallbackLocales: ['en'] });
  const first = i18n.getSnapshot();
  assert.equal(first.t('cart:title'), 'Français');
  assert.equal(first.t('cart:parent'), 'English parent');
  assert.equal(first.t('cart:baseOnly'), 'Base only');
  i18n.setLocale('en-GB');
  assert.equal(i18n.t('cart:title'), 'British');
  assert.equal(i18n.t('cart:parent'), 'English parent');
  assert.equal(first.t('cart:title'), 'Français');
  i18n.replaceCatalogs([
    record({ title: 'Base', parent: 'Base parent', baseOnly: 'Base only' }, 'ko'),
    record({ title: 'English', parent: 'Updated parent' }, 'en'),
    record({ title: 'Français' }, 'fr'),
    record({ title: 'British' }, 'en-GB'),
  ]);
  assert.equal(i18n.t('cart:parent'), 'Updated parent');

  const strict = createStore({ baseLocale: 'ko', locale: 'fr', catalogs: catalogs() });
  assert.equal(strict.t('cart:parent'), 'Base parent');
  assert.throws(() => createStore({ baseLocale: 'ko', locale: 'fr', catalogs: catalogs(), fallbackLocales: ['de'] }), RangeError);
  assert.throws(() => createStore({ baseLocale: 'ko', locale: 'fr', catalogs: catalogs(), fallbackLocales: ['en', 'EN'] }), RangeError);
  const committed = i18n.getSnapshot();
  assert.throws(() => i18n.replaceCatalogs(catalogs().filter(catalog => catalog.locale !== 'en')), RangeError);
  assert.equal(i18n.getSnapshot(), committed);
});
