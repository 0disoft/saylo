import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CatalogError, createBaseSchema, parseCatalog, validateTranslation } from '@saylo/core';
import { freeze } from '../dist/diagnostics.js';

const options = { locale: 'ko', namespace: 'cart', sourceName: 'locales/ko/cart.json' };
const catalog = (messages, locale = 'ko') => parseCatalog(JSON.stringify(messages), { ...options, locale });
function rejectsCode(fn, code) {
  assert.throws(fn, error => error instanceof CatalogError && error.diagnostics.some(d => d.code === code));
}

test('JS package entry parses flat literal IDs, empty text, apostrophes and tags', () => {
  const parsed = catalog({ 'cart.items': '', tags: '<b>{name}</b>', quote: "'{notAnArgument}'", text: 'Saylo' }, 'ko-kr');
  assert.equal(parsed.locale, 'ko-KR');
  assert.equal(parsed.messages['cart.items'].source, '');
  assert.deepEqual(Object.keys(parsed.messages.tags.arguments), ['name']);
  assert.deepEqual(Object.keys(parsed.messages.quote.arguments), []);
  assert.equal(parsed.messages.tags.ast[0].value, '<b>');
});

test('strict JSON rejects malformed, comments, trailing commas and non-string values', () => {
  for (const source of ['{', '{"x":"ok",}', '{/* comment */"x":"ok"}']) {
    rejectsCode(() => parseCatalog(source, options), 'INVALID_JSON');
  }
  for (const source of ['null', '[]', '"text"', '{"x":{}}', '{"x":3}', '{"x":true}', '{"x":null}', '{"x":[]}']) {
    rejectsCode(() => parseCatalog(source, options), 'INVALID_CATALOG');
  }
  rejectsCode(() => parseCatalog({ x: 'ok' }, options), 'INVALID_JSON');
});

test('duplicate decoded JSON IDs are rejected before overwritten values disappear', () => {
  rejectsCode(() => parseCatalog('{"title":"A","title":"B"}', options), 'DUPLICATE_ID');
  const source = '{\n  "title": "A",\n  "ti\\u0074le": "B"\n}';
  assert.throws(() => parseCatalog(source, options), error => {
    assert.equal(error.diagnostics[0].code, 'DUPLICATE_ID');
    assert.equal(error.diagnostics[0].id, 'title');
    assert.deepEqual(error.diagnostics[0].position, { offset: source.indexOf('"ti\\u'), line: 3, column: 3 });
    return true;
  });
  rejectsCode(() => parseCatalog('{"x":{},"x":"ok"}', options), 'INVALID_CATALOG');
});

test('prototype-like IDs and argument names are literal own keys', () => {
  const parsed = parseCatalog('{"__proto__":"{__proto__}","constructor":"ok"}', options);
  const base = createBaseSchema(parsed);
  assert.equal(Object.getPrototypeOf(parsed.messages), null);
  assert.deepEqual(base.keys.__proto__.__proto__.acceptedTypes, ['string', 'number']);
  validateTranslation(base, parseCatalog('{"__proto__":"{__proto__}"}', { ...options, locale: 'en' }));
  rejectsCode(() => validateTranslation(createBaseSchema(catalog({ x: 'ok' })), catalog({ constructor: 'new' }, 'en')), 'UNKNOWN_MESSAGE');
});

test('invalid locale, namespace and IDs produce structured errors', () => {
  rejectsCode(() => parseCatalog('{}', { ...options, locale: 'ko_KR' }), 'INVALID_LOCALE');
  rejectsCode(() => parseCatalog('{}', { ...options, locale: '' }), 'INVALID_LOCALE');
  for (const namespace of ['', '..', '.', 'a:b', '../cart', 'a\\b']) {
    rejectsCode(() => parseCatalog('{}', { ...options, namespace }), 'INVALID_NAMESPACE');
  }
  for (const id of ['', 'a:b']) rejectsCode(() => catalog({ [id]: 'value' }), 'INVALID_ID');
});

test('ICU syntax errors are attributed to message and JSON source position', () => {
  const source = '{\n  "broken": "\\u0041\\n{count"\n}';
  assert.throws(() => parseCatalog(source, options), error => {
    const d = error.diagnostics[0];
    assert.equal(d.code, 'INVALID_ICU');
    assert.equal(d.sourceName, options.sourceName);
    assert.equal(d.id, 'broken');
    assert.equal(d.position.line, 2);
    assert.equal(d.position.offset, source.indexOf('{count')); // Escapes map back to the unclosed argument.
    return true;
  });
  rejectsCode(() => catalog({ x: '{count, plural, one {one}}' }), 'INVALID_ICU');
  rejectsCode(() => catalog({ x: '{who, select, a {A}}' }), 'INVALID_ICU');
});

test('base argument types use intersection; names from all branches are required', () => {
  const parsed = catalog({
    plain: '{name}',
    numeric: '{count} {count, number} {count, plural, other {#}}',
    dates: '{at, date, medium} {at, time, short}',
    mixed: '{at} {at, date}',
    branches: '{gender, select, a {{first}} other {{second}}}',
  });
  const base = createBaseSchema(parsed);
  assert.deepEqual(base.keys.plain.name.acceptedTypes, ['string', 'number']);
  assert.deepEqual(base.keys.numeric.count.acceptedTypes, ['number']);
  assert.deepEqual(base.keys.dates.at.acceptedTypes, ['number', 'date']);
  assert.deepEqual(base.keys.mixed.at.acceptedTypes, ['number']);
  assert.deepEqual(Object.keys(base.keys.branches), ['gender', 'first', 'second']);
  for (const arg of Object.values(base.keys.branches)) assert.equal(arg.required, true);
});

test('conflicting uses fail atomically, including across nested branches', () => {
  rejectsCode(() => catalog({ x: '{v, number} {v, select, other {text}}' }), 'ARGUMENT_CONFLICT');
  rejectsCode(() => catalog({ x: '{g, select, a {{v, date}} other {{v, select, other {text}}}}' }), 'ARGUMENT_CONFLICT');
  assert.throws(() => catalog({ good: 'ok', bad: '{', conflict: '{v, number} {v, select, other {text}}' }), error => {
    assert.deepEqual(error.diagnostics.map(d => d.code), ['INVALID_ICU', 'ARGUMENT_CONFLICT']);
    return true;
  });
});

test('offset, exact branches, selectordinal, nested forms and locale categories are supported', () => {
  const base = createBaseSchema(catalog({ x: '{n, plural, offset:1 =0 {None} other {{who} #}}', rank: '{n, selectordinal, one {#st} other {#th}}' }));
  const translated = catalog({ x: '{n, plural, one {{who}} few {{who}} many {{who}} other {{who}}}' }, 'ru');
  validateTranslation(base, translated);
  assert.deepEqual(Object.keys(base.keys.x), ['n', 'who']);
  assert.deepEqual(base.keys.rank.n.acceptedTypes, ['number']);
});

test('translation can omit keys or arguments without weakening the base contract', () => {
  const base = createBaseSchema(catalog({ x: '{n, number}', title: 'Cart' }));
  validateTranslation(base, catalog({}, 'en'));
  validateTranslation(base, catalog({ x: 'Items' }, 'en'));
  validateTranslation(base, catalog({ x: '{n}' }, 'en'));
  assert.deepEqual(base.keys.x.n, { required: true, acceptedTypes: ['number'] });
});

test('translation rejects new keys, new arguments and narrower argument types', () => {
  const base = createBaseSchema(catalog({ x: '{n}', date: '{at, date}' }));
  rejectsCode(() => validateTranslation(base, catalog({ unknown: 'value' }, 'en')), 'UNKNOWN_MESSAGE');
  rejectsCode(() => validateTranslation(base, catalog({ x: '{gender}' }, 'en')), 'UNKNOWN_ARGUMENT');
  rejectsCode(() => validateTranslation(base, catalog({ x: '{n, plural, other {#}}' }, 'en')), 'ARGUMENT_TYPE_NARROWING');
  rejectsCode(() => validateTranslation(base, catalog({ date: '{at}' }, 'en')), 'ARGUMENT_TYPE_NARROWING');
  rejectsCode(() => validateTranslation(base, parseCatalog('{}', { locale: 'en', namespace: 'other' })), 'NAMESPACE_MISMATCH');
});

test('fingerprint depends on namespace and argument contract, not text or key order', () => {
  const first = createBaseSchema(catalog({ title: 'Cart', x: '{n, number}' }));
  const edited = createBaseSchema(catalog({ x: 'Total {n, number}', title: 'Edited' }));
  assert.equal(first.fingerprint, edited.fingerprint);
  assert.notEqual(first.fingerprint, createBaseSchema(catalog({ title: 'Cart', x: '{n}' })).fingerprint);
  assert.notEqual(first.fingerprint, createBaseSchema(parseCatalog('{"title":"Cart","x":"{n, number}"}', { locale: 'ko', namespace: 'other' })).fingerprint);
});

test('parsed AST, schemas and diagnostics are deeply immutable', () => {
  const parsed = catalog({ x: '{n, plural, other {#}}' });
  const base = createBaseSchema(parsed);
  assert.throws(() => { parsed.messages.x.ast[0].offset = 5; }, TypeError);
  assert.throws(() => { parsed.messages.x.ast[0].options.other.value.push({ type: 0, value: 'new' }); }, TypeError);
  assert.throws(() => { base.keys.x.n.acceptedTypes.push('string'); }, TypeError);
  assert.throws(() => { base.keys.x = {}; }, TypeError);
  assert.throws(() => catalog({ x: '{' }), error => {
    assert.ok(Object.isFrozen(error.diagnostics));
    assert.ok(Object.isFrozen(error.diagnostics[0]));
    return true;
  });
});

test('schema reuse follows deep immutability and mutable inputs never keep a stale schema', () => {
  const parsed = catalog({ x: '{n, number}' });
  assert.equal(createBaseSchema(parsed), createBaseSchema(parsed));
  const mutable = { ...parsed, messages: { ...parsed.messages } };
  const first = createBaseSchema(mutable);
  mutable.messages.extra = catalog({ extra: '{name}' }).messages.extra;
  assert.notEqual(createBaseSchema(mutable).fingerprint, first.fingerprint);
  freeze(mutable);
  assert.equal(createBaseSchema(mutable), createBaseSchema(mutable));
});

test('deep freeze visits children of an externally shallow-frozen object', () => {
  const value = Object.freeze({ nested: { values: ['before'] } });
  freeze(value);
  assert.throws(() => { value.nested.values.push('after'); }, TypeError);
  assert.equal(freeze(value), value);
});
