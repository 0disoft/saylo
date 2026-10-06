import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { CatalogError, createBaseSchema, parseCatalog, validateTranslation } from '@0disoft/saylo-core';
import { freeze, createPositionLocator } from '../dist/diagnostics.js';

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
  rejectsCode(() => parseCatalog('{"x":"ok","x":{}}', options), 'INVALID_CATALOG');
});

test('prototype-like IDs and argument names are literal own keys', () => {
  const parsed = parseCatalog('{"__proto__":"{__proto__}","constructor":"ok"}', options);
  const base = createBaseSchema(parsed);
  assert.equal(Object.getPrototypeOf(parsed.messages), null);
  assert.deepEqual(base.keys.__proto__.__proto__.acceptedTypes, ['string', 'number']);
  validateTranslation(base, parseCatalog('{"__proto__":"{__proto__}"}', { ...options, locale: 'en' }));
  rejectsCode(() => validateTranslation(createBaseSchema(catalog({ x: 'ok' })), catalog({ constructor: 'new' }, 'en')), 'UNKNOWN_MESSAGE');
});

test('plain and escaped key tokens preserve decoded IDs and exact source positions', () => {
  const source = String.raw`{
    "한글😀": "plain",
    "ti\u0074le": "escaped",
    "quote\"key": "quoted",
    "back\\slash": "slash",
    "__proto__": "literal"
  }`;
  const decoded = JSON.parse(source);
  const parsed = parseCatalog(source, options);
  assert.deepEqual(Object.keys(parsed.messages), Object.keys(decoded));
  for (const id of Object.keys(decoded)) assert.equal(parsed.messages[id].source, decoded[id]);
  assert.deepEqual(parsed.messages.title.position, { offset: source.indexOf('"escaped"'), line: 3, column: 19 });
  for (const duplicate of [String.raw`{"ti\u0074le":"A","title":"B"}`, String.raw`{"title":"A","ti\u0074le":"B"}`])
    rejectsCode(() => parseCatalog(duplicate, options, parsed), 'DUPLICATE_ID');
  rejectsCode(() => parseCatalog('{"bad\nkey":"value"}', options), 'INVALID_JSON');
});

test('position indexing preserves UTF-16 columns at LF, CRLF, trailing LF and escaped newline boundaries', () => {
  for (const source of ['', 'single line 😀', '\n\n', '😀\r\n한글\nlast\n', String.raw`{"x":"a\nb"}`]) {
    const locate = createPositionLocator(source);
    for (let offset = 0; offset <= source.length; offset++) {
      const prefix = source.slice(0, offset);
      const lastLf = prefix.lastIndexOf('\n');
      assert.deepEqual(locate(offset), { offset, line: prefix.split('\n').length, column: offset - lastLf });
    }
  }
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

test('validation reuse follows immutable argument contracts, never stale keys or mutable schemas', () => {
  const base = createBaseSchema(catalog({ x: '{n, number}' }));
  const translation = catalog({ x: '{n}' }, 'en');
  validateTranslation(base, translation);
  validateTranslation(base, translation);
  rejectsCode(() => validateTranslation(createBaseSchema(catalog({ x: '{other}' })), translation), 'UNKNOWN_ARGUMENT');
  rejectsCode(() => validateTranslation(createBaseSchema(catalog({ y: '{n, number}' })), translation), 'UNKNOWN_MESSAGE');
  const mutableBase = { ...base, keys: { x: { n: { required: true, acceptedTypes: ['number'] } } } };
  validateTranslation(mutableBase, translation);
  mutableBase.keys.x.n.acceptedTypes = ['date'];
  rejectsCode(() => validateTranslation(mutableBase, translation), 'ARGUMENT_TYPE_NARROWING');
  const mutableTranslation = { ...translation, messages: { x: { ...translation.messages.x,
    arguments: { n: { required: true, acceptedTypes: ['number', 'string'] } } } } };
  validateTranslation(base, mutableTranslation);
  mutableTranslation.messages.x.arguments.n.acceptedTypes = ['string'];
  rejectsCode(() => validateTranslation(base, mutableTranslation), 'ARGUMENT_TYPE_NARROWING');
});

test('fingerprint depends on namespace and argument contract, not text or key order', () => {
  const first = createBaseSchema(catalog({ title: 'Cart', x: '{n, number}' }));
  const edited = createBaseSchema(catalog({ x: 'Total {n, number}', title: 'Edited' }));
  assert.equal(first.fingerprint, edited.fingerprint);
  assert.notEqual(first.fingerprint, createBaseSchema(catalog({ title: 'Cart', x: '{n}' })).fingerprint);
  assert.notEqual(first.fingerprint, createBaseSchema(parseCatalog('{"title":"Cart","x":"{n, number}"}', { locale: 'ko', namespace: 'other' })).fingerprint);
});

test('compact schema fingerprints match native SHA-256 for Unicode and scale independently of catalog size', () => {
  const schema = createBaseSchema(catalog({ '항목😀': '{name}', '\ud800': 'text' }));
  const canonical = ['cart', [['항목😀', [['name', ['number', 'string']]]], ['\ud800', []]]];
  const digest = createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
  assert.equal(schema.fingerprint, `saylo-schema-v2:sha256:${digest}`);
  const large = createBaseSchema(catalog(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`m${i}`, '{name}']))));
  assert.equal(large.fingerprint.length, schema.fingerprint.length);
  assert.equal(large.fingerprint.length, 87);
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

test('incremental parsing reuses unchanged ICU but refreshes source positions and validates changed entries', () => {
  const first = parseCatalog('{"x":"{n, number}","keep":"{name}"}', options);
  const source = '{\n  "x":"Changed {n, number}",\n  "keep":"{name}"\n}';
  const next = parseCatalog(source, options, first);
  assert.notEqual(next.messages.x.ast, first.messages.x.ast);
  assert.equal(next.messages.keep.ast, first.messages.keep.ast);
  assert.equal(next.messages.keep.arguments, first.messages.keep.arguments);
  assert.deepEqual(next.messages.keep.position, { offset: source.indexOf('"{name}"'), line: 3, column: 10 });
  assert.deepEqual(next, parseCatalog(source, options));
  rejectsCode(() => parseCatalog('{"keep":"{name}","keep":"bad"}', options, first), 'DUPLICATE_ID');
  rejectsCode(() => parseCatalog('{"keep":"{name"}', options, first), 'INVALID_ICU');
  rejectsCode(() => parseCatalog('{"keep":"{n, number} {n, select, other {x}}"}', options, first), 'ARGUMENT_CONFLICT');
  const removed = parseCatalog('{"keep":"{name}"}', options, next);
  assert.deepEqual(Object.keys(removed.messages), ['keep']);
  const translated = parseCatalog('{"keep":"{name}"}', { ...options, locale: 'en' }, first);
  assert.notEqual(translated.messages.keep.ast, first.messages.keep.ast);
});
