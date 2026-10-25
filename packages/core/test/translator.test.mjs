import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CatalogError, InvalidArgumentError, NamespaceNotLoadedError, UnknownMessageError,
  createTranslator, parseCatalog,
} from '@0disoft/saylo-core';

const catalog = (messages, locale = 'ko', namespace = 'cart') =>
  parseCatalog(JSON.stringify(messages), { locale, namespace, sourceName: `${locale}/${namespace}.json` });
const translator = (base, translated, options = {}) => createTranslator({
  locale: 'en', baseCatalogs: [catalog(base)],
  translations: translated === undefined ? [] : [catalog(translated, 'en')], ...options,
});

test('a translator isolates mutable catalogs and ASTs without freezing caller data', () => {
  const base = structuredClone(catalog({ title: 'Before', fallback: 'Base' }));
  const translated = structuredClone(catalog({ title: 'Original' }, 'en'));
  const bases = [base];
  const translations = [translated];
  const bound = createTranslator({ locale: 'en', baseCatalogs: bases, translations });
  // Mutate before first formatting so an existing formatter cache cannot hide aliasing.
  translated.messages.title.ast[0].value = 'Changed AST';
  delete base.messages.fallback;
  bases.length = 0;
  translations.length = 0;
  assert.equal(bound.t('cart:title'), 'Original');
  assert.equal(bound.t('cart:fallback'), 'Base');
  assert.equal(Object.isFrozen(base), false);
  assert.equal(Object.isFrozen(translated.messages.title.ast), false);
});

test('t returns text, interpolated zero and literal tags; empty translation is not fallback', () => {
  const { t } = translator({ title: '장바구니', empty: 'Base', name: '{name}', tags: '<b>{name}</b>', dotted: 'Value' },
    { title: 'Cart', empty: '', name: '{name}', tags: '<b>{name}</b>' });
  assert.equal(t('cart:title'), 'Cart');
  assert.equal(t('cart:empty'), '');
  assert.equal(t('cart:name', { name: 0 }), '0');
  assert.equal(t('cart:name', { name: '' }), '');
  assert.equal(t('cart:tags', { name: '<script>' }), '<b><script></b>');
  assert.equal(t('cart:dotted'), 'Value');
  const literal = translator({ 'cart.items': "'{value}'" });
  assert.equal(literal.t('cart:cart.items'), '{value}');
});

test('plural, exact branch, offset, ordinal, select and nested text use ICU semantics', () => {
  const messages = {
    items: '{n, plural, one {# item} other {# items}}',
    offset: '{n, plural, offset:1 =0 {None} one {You and one} other {You and #}}',
    ordinal: '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}',
    select: '{g, select, male {He has {n, plural, one {# item} other {# items}}} other {They have {n, plural, other {# items}}}}',
  };
  const { t } = translator(messages, messages);
  assert.equal(t('cart:items', { n: 1 }), '1 item');
  assert.equal(t('cart:items', { n: 3 }), '3 items');
  assert.equal(t('cart:offset', { n: 0 }), 'None');
  assert.equal(t('cart:offset', { n: 3 }), 'You and 2');
  assert.equal(t('cart:ordinal', { n: 22 }), '22nd');
  assert.equal(t('cart:select', { g: 'male', n: 2 }), 'He has 2 items');
  assert.equal(t('cart:select', { g: 'constructor', n: 2 }), 'They have 2 items');
});

test('fallback formats with base locale; missing target namespace also falls back', () => {
  const t = createTranslator({ locale: 'en-US', baseCatalogs: [catalog({ amount: '{n, number}' }, 'de-DE')], translations: [] }).t;
  assert.equal(t('cart:amount', { n: 1234.5 }), new Intl.NumberFormat('de-DE').format(1234.5));
  const partial = createTranslator({ locale: 'en-US', baseCatalogs: [catalog({ amount: '{n, number}', title: 'Basis' }, 'de-DE')],
    translations: [catalog({ title: 'Title' }, 'en-US')] });
  assert.equal(partial.t('cart:title'), 'Title');
  assert.equal(partial.t('cart:amount', { n: 1234.5 }), '1.234,5');
});

test('base required arguments remain required when translation omits them', () => {
  const { t } = translator({ items: '{n, number}' }, { items: 'Items' });
  assert.equal(t('cart:items', { n: 3 }), 'Items');
  assert.throws(() => t('cart:items'), error => error instanceof InvalidArgumentError && error.argument === 'n');
  assert.throws(() => t('cart:items', { n: '3' }), InvalidArgumentError);
  assert.throws(() => t('cart:items', Object.create({ n: 3 })), InvalidArgumentError);
});

test('JS rejects wrong types, invalid Date, nonfinite numbers and non-object args', () => {
  const { t } = translator({ n: '{n, number}', at: '{at, date}', plain: '{v}', select: '{g, select, other {Other}}' });
  for (const n of [NaN, Infinity, -Infinity, '3', null, undefined, true, 3n, () => 3, new Date(0)]) {
    assert.throws(() => t('cart:n', { n }), InvalidArgumentError);
  }
  for (const at of [new Date(NaN), '2026-01-01', {}, null]) assert.throws(() => t('cart:at', { at }), InvalidArgumentError);
  for (const args of [null, [], 3, 'x', () => ({ n: 3 })]) assert.throws(() => t('cart:n', args), InvalidArgumentError);
  assert.throws(() => t('cart:plain', { v: {} }), InvalidArgumentError);
  assert.throws(() => t('cart:select', { g: 1 }), InvalidArgumentError);
});

test('date/time defaults, named styles and skeletons all receive the resolved timezone', () => {
  const at = new Date('2026-01-01T23:45:00Z');
  const messages = { date: '{at, date}', time: '{at, time}', short: '{at, time, short}', skeleton: '{at, date, ::yyyyMMdd}', clock: '{at, time, ::HHmm}' };
  const i18n = createTranslator({ locale: 'en-US', baseCatalogs: [catalog(messages, 'en-US')], timeZone: 'Asia/Seoul' });
  assert.equal(i18n.timeZone, 'Asia/Seoul');
  assert.equal(i18n.t('cart:date', { at }), new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul' }).format(at));
  assert.equal(i18n.t('cart:time', { at }), new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', second: 'numeric', timeZone: 'Asia/Seoul' }).format(at));
  assert.equal(i18n.t('cart:short', { at }), new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', timeZone: 'Asia/Seoul' }).format(at));
  assert.equal(i18n.t('cart:skeleton', { at }), new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul' }).format(at));
  assert.equal(i18n.t('cart:clock', { at }), new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(at));
  assert.equal(i18n.t('cart:date', { at: at.getTime() }), i18n.t('cart:date', { at }));
  const utc = createTranslator({ locale: 'en-US', baseCatalogs: [catalog(messages, 'en-US')] });
  assert.equal(utc.timeZone, 'UTC');
  assert.notEqual(utc.t('cart:date', { at }), i18n.t('cart:date', { at }));
});

test('unknown keys, malformed addresses and unloaded namespaces have distinct errors', () => {
  const { t } = translator({ title: 'Title' });
  for (const key of ['cart:missing', 'cart:__proto__', 'title', ':title', 'cart:', 'cart:x:y', null]) {
    assert.throws(() => t(key), UnknownMessageError);
  }
  assert.throws(() => t('common:title'), error => error instanceof NamespaceNotLoadedError && error.namespace === 'common');
});

test('prototype-like message and argument names remain literal and own properties', () => {
  const base = parseCatalog('{"__proto__":"{__proto__}","constructor":"Literal"}', { locale: 'ko', namespace: 'cart' });
  const i18n = createTranslator({ locale: 'ko', baseCatalogs: [base] });
  const args = JSON.parse('{"__proto__":"Value"}');
  assert.equal(i18n.t('cart:__proto__', args), 'Value');
  assert.equal(i18n.t('cart:constructor'), 'Literal');
  assert.throws(() => i18n.t('cart:__proto__', {}), InvalidArgumentError);
});

test('factory validates translations, duplicate namespaces and locale consistency', () => {
  assert.throws(() => translator({ n: '{n}' }, { n: '{n, number}' }), CatalogError);
  const base = catalog({ title: 'Title' });
  assert.throws(() => createTranslator({ locale: 'en', baseCatalogs: [] }), RangeError);
  assert.throws(() => createTranslator({ locale: '', baseCatalogs: [base] }), RangeError);
  assert.throws(() => createTranslator({ locale: 'en', baseCatalogs: [base], timeZone: 'Not/AZone' }), RangeError);
  assert.throws(() => createTranslator({ locale: 'en', baseCatalogs: [base, base] }), CatalogError);
  assert.throws(() => createTranslator({ locale: 'en', baseCatalogs: [base, catalog({}, 'fr', 'common')] }), CatalogError);
  assert.throws(() => createTranslator({ locale: 'en', baseCatalogs: [base], translations: [catalog({}, 'fr')] }), CatalogError);
  assert.throws(() => createTranslator({ locale: 'en', baseCatalogs: [base], translations: [catalog({}, 'en', 'common')] }), CatalogError);
  assert.throws(() => createTranslator({ locale: 'en', baseCatalogs: [base], translations: [catalog({}, 'en'), catalog({}, 'en')] }), CatalogError);
});

test('translator is snapshot-bound; caller arrays and another translator cannot change it', () => {
  const baseCatalogs = [catalog({ title: 'Base' })];
  const translations = [catalog({ title: 'First' }, 'en')];
  const first = createTranslator({ locale: 'en', baseCatalogs, translations });
  translations[0] = catalog({ title: 'Second' }, 'en');
  baseCatalogs.length = 0;
  assert.equal(first.t('cart:title'), 'First');
  assert.throws(() => { first.locale = 'fr'; }, TypeError);
  const second = translator({ title: 'Base' }, { title: 'Second' });
  assert.equal(second.t('cart:title'), 'Second');
  assert.equal(first.t('cart:title'), 'First');
});

test('repeated messages and different text reuse native Intl formatters', () => {
  const NativeNumberFormat = Intl.NumberFormat;
  let created = 0;
  Intl.NumberFormat = class extends NativeNumberFormat {
    constructor(...args) { super(...args); created++; }
  };
  try {
    const { t } = translator({ first: 'First {n, number}', second: 'Second {n, number}' });
    assert.equal(t('cart:first', { n: 3 }), 'First 3');
    assert.equal(t('cart:first', { n: 4 }), 'First 4');
    assert.equal(t('cart:second', { n: 5 }), 'Second 5');
    assert.equal(created, 1);
  } finally { Intl.NumberFormat = NativeNumberFormat; }
});
