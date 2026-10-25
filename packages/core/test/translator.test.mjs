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

test('explicit fallback locales resolve in order after the selection and format with their source locale', () => {
  const base = catalog({ title: 'Base', parent: 'Base parent', amount: '{n, number}', baseOnly: 'Base only' }, 'ko');
  const german = catalog({ title: 'Deutsch', parent: 'German parent' }, 'de');
  const english = catalog({ title: 'English', parent: 'English parent', amount: '{n, number}' }, 'en');
  const british = catalog({ title: 'British' }, 'en-GB');
  const tr = createTranslator({ locale: 'en-GB', fallbackLocales: ['de', 'en'], baseCatalogs: [base],
    translations: [british, german, english] });
  assert.equal(tr.t('cart:title'), 'British');
  assert.equal(tr.t('cart:parent'), 'German parent');
  assert.equal(tr.t('cart:amount', { n: 1234.5 }), new Intl.NumberFormat('en').format(1234.5));
  assert.equal(tr.t('cart:baseOnly'), 'Base only');
});

test('parent fallback remains opt-in and duplicate, self and base entries are bounded', () => {
  const base = catalog({ title: 'Base', parent: 'Base parent' }, 'ko');
  const english = catalog({ title: 'English', parent: 'English parent' }, 'en');
  const british = catalog({ title: 'British' }, 'en-GB');
  assert.throws(() => createTranslator({ locale: 'en-GB', baseCatalogs: [base], translations: [british, english] }), CatalogError);
  const strict = createTranslator({ locale: 'en-GB', baseCatalogs: [base], translations: [british] });
  assert.equal(strict.t('cart:title'), 'British');
  assert.equal(strict.t('cart:parent'), 'Base parent');

  const tr = createTranslator({ locale: 'en-GB', fallbackLocales: ['en-GB', 'ko', 'en'],
    baseCatalogs: [base], translations: [british, english] });
  assert.equal(tr.t('cart:parent'), 'English parent');
  assert.throws(() => createTranslator({ locale: 'en-GB', fallbackLocales: ['en', 'EN'], baseCatalogs: [base] }), RangeError);
  assert.throws(() => createTranslator({ locale: 'en-GB', fallbackLocales: 'en', baseCatalogs: [base] }), TypeError);
  assert.throws(() => createTranslator({ locale: 'en-GB', fallbackLocales: ['en'], baseCatalogs: [base],
    translations: [british, catalog({ title: 'Français' }, 'fr')] }), CatalogError);
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

test('strict translation remains the default and an undefined policy fallback rethrows the original error', () => {
  const strict = translator({ title: 'Title' });
  assert.throws(() => strict.t('cart:missing'), UnknownMessageError);
  assert.throws(() => strict.tParts('cart:missing'), UnknownMessageError);

  let context;
  const recover = translator({ title: 'Title' }, undefined, {
    onMissingKey: value => { context = value; return undefined; },
  });
  let thrown;
  try { recover.t('cart:missing'); } catch (error) { thrown = error; }
  assert.ok(thrown instanceof UnknownMessageError);
  assert.equal(thrown, context.error);
  assert.equal(context.key, 'cart:missing');
  assert.equal(context.locale, 'en');
  assert.equal(context.baseLocale, 'ko');
  assert.equal(context.namespace, 'cart');
  assert.equal(context.messageId, 'missing');
  assert.equal(context.surface, 'text');
});

test('missing-key policy coerces foreign keys once and preserves coercion errors', () => {
  let calls = 0;
  const translator = createTranslator({ locale: 'ko', baseCatalogs: [catalog({ title: 'Title' })],
    onMissingKey: context => context.key });
  const key = { toString() { calls++; if (calls > 1) throw new Error('Unexpected second coercion'); return 'cart:missing'; } };
  assert.equal(translator.t(key), 'cart:missing');
  assert.equal(calls, 1);
  const original = new Error('coercion failed');
  assert.throws(() => translator.t({ toString() { throw original; } }), error => error === original);
});

test('empty missing-key fallbacks are retained and covers unknown and unloaded namespaces', () => {
  const seen = [];
  const tr = translator({ title: 'Title' }, undefined, {
    onMissingKey: context => { seen.push(context); return ''; },
  });
  assert.equal(tr.t('cart:missing'), '');
  assert.deepEqual(tr.tParts('common:title'), [{ type: 'text', value: '' }]);
  assert.equal(seen[0].error instanceof UnknownMessageError, true);
  assert.equal(seen[1].error instanceof NamespaceNotLoadedError, true);
  assert.equal(seen[1].surface, 'parts');
});

test('format fallbacks cover invalid arguments and native Intl failures only during render', () => {
  const seen = [];
  const tr = translator({ items: '{n, number}' }, undefined, {
    onFormatError: context => { seen.push(context); return context.argument ? `missing:${context.argument}` : 'formatter'; },
  });
  assert.equal(tr.t('cart:items'), 'missing:n');
  assert.equal(seen[0].error instanceof InvalidArgumentError, true);
  assert.equal(seen[0].argument, 'n');
  assert.equal(seen[0].surface, 'text');

  const NativeNumberFormat = Intl.NumberFormat;
  Intl.NumberFormat = class extends NativeNumberFormat {
    constructor() { super('en'); throw new RangeError('native formatter failed'); }
  };
  try { assert.equal(tr.t('cart:items', { n: 1 }), 'formatter'); }
  finally { Intl.NumberFormat = NativeNumberFormat; }
  assert.equal(seen[1].error.message, 'native formatter failed');

  const base = catalog({ title: 'Title' });
  assert.throws(() => createTranslator({ locale: 'en', baseCatalogs: [base],
    translations: [catalog({ title: '{n}' }, 'en')], onFormatError: () => '' }), CatalogError);
  assert.equal(seen.length, 2);
});

test('handler failures propagate without invoking the other handler', () => {
  const handlerFailure = new Error('handler failed');
  let formatCalls = 0;
  const missing = translator({ items: '{n, number}' }, undefined, {
    onMissingKey: () => { throw handlerFailure; },
    onFormatError: () => { formatCalls++; return 'format'; },
  });
  assert.throws(() => missing.t('cart:missing'), error => error === handlerFailure);
  assert.equal(formatCalls, 0);

  let missingCalls = 0;
  const format = translator({ items: '{n, number}' }, undefined, {
    onMissingKey: () => { missingCalls++; return 'missing'; },
    onFormatError: () => { throw handlerFailure; },
  });
  assert.throws(() => format.t('cart:items'), error => error === handlerFailure);
  assert.equal(missingCalls, 0);
  assert.throws(() => translator({ title: 'Title' }, undefined, { onMissingKey: () => 3 }).t('cart:missing'), TypeError);
});

test('a consumed formatter failure marker cannot misclassify the same error from an argument getter', () => {
  const shared = new RangeError('shared failure');
  const NativeNumberFormat = Intl.NumberFormat;
  let formatCalls = 0;
  const tr = translator({ items: '{n, number}' }, undefined, {
    onFormatError: () => { formatCalls++; return 'formatted'; },
  });
  Intl.NumberFormat = class { constructor() { throw shared; } };
  try { assert.equal(tr.t('cart:items', { n: 1 }), 'formatted'); }
  finally { Intl.NumberFormat = NativeNumberFormat; }
  const args = {};
  Object.defineProperty(args, 'n', { enumerable: true, get() { throw shared; } });
  assert.throws(() => tr.t('cart:items', args), error => error === shared);
  assert.equal(formatCalls, 1);
});

test('tParts fallbacks are frozen literal text and never parse markup', () => {
  const fallback = '<strong data-action="submit">{name}</strong>';
  const tr = translator({ items: '{n, number}' }, undefined, {
    onMissingKey: () => fallback,
    onFormatError: () => fallback,
  });
  for (const parts of [tr.tParts('cart:missing'), tr.tParts('cart:items')]) {
    assert.deepEqual(parts, [{ type: 'text', value: fallback }]);
    assert.equal(Object.isFrozen(parts), true);
    assert.equal(Object.isFrozen(parts[0]), true);
  }
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
  assert.throws(() => createTranslator({ locale: 'en', baseCatalogs: [base], translations: [catalog({ title: 'Base override' })] }), CatalogError);
  assert.throws(() => createTranslator({ locale: 'en', fallbackLocales: ['ko'], baseCatalogs: [base],
    translations: [catalog({ title: 'Base override' })] }), CatalogError);
  const baseSelected = createTranslator({ locale: 'ko', baseCatalogs: [base],
    translations: [catalog({ title: 'Selected base override' })] });
  assert.equal(baseSelected.t('cart:title'), 'Selected base override');
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
