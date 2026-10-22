import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { CatalogRegistry } from '../dist/catalog-registry.js';
import { encodeCatalogResult, decodeCatalogResult } from '../dist/catalog-wire.js';
import { immutable } from '../dist/catalog-outcome.js';

const json = value => JSON.parse(JSON.stringify(value));
const outcome = messages => {
  const catalog = parseCatalog(JSON.stringify(messages, null, 2), { locale: 'en', namespace: 'demo', sourceName: 'messages.json' });
  return new CatalogRegistry('one', 'en', [catalog]).load('en', 'demo');
};

test('compact payloads preserve rich contracts through JSON and reject malformed tag metadata', () => {
  const catalog = parseCatalog('{"x":"<link>Terms</link>"}', { locale: 'en', namespace: 'demo', richText: { x: ['link'] } });
  const original = new CatalogRegistry('rich', 'en', [catalog]).load('en', 'demo');
  const wire = json(encodeCatalogResult(original));
  const decoded = decodeCatalogResult(wire);
  assert.deepEqual(json(decoded), json(original));
  wire.catalog.messages[0][7] = ['bad tag'];
  assert.throws(() => decodeCatalogResult(wire), /Invalid compact/);
});

test('compact catalogs round-trip exact messages, ICU AST locations, schemas and prototype-like names', () => {
  const messages = Object.assign(Object.create(null), {
    empty: '', unicode: '😀\r\n안녕 {name} \ud800', repeated: '{name} and {name}',
    quoted: "'{name}' '{' # <b>text</b>",
    number: '{n, number, ::currency/USD precision-integer}', date: '{d, date, ::yyyyMMdd}',
    time: '{d, time, short}', style: '{n, number}',
    nested: '{choice, select, constructor {{n, plural, offset:1 =0 {zero} one {# item} other {# items for {name}}}} other {none}}',
    ordinal: '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}',
    constructor: '{__proto__}',
  });
  messages.__proto__ = '{constructor}';
  const before = outcome(messages);
  const wire = json(encodeCatalogResult(before));
  assert.equal(wire.status, 'compact');
  assert.ok(Array.isArray(wire.catalog.messages.find(([id]) => id === 'unicode')[5][0]));
  const after = immutable(decodeCatalogResult(wire));
  assert.deepEqual(json(after), json(before));
  assert.equal(Object.getPrototypeOf(after.catalog.messages), null);
  assert.equal(after.catalog.messages.__proto__.source, '{constructor}');
  assert.ok(Object.isFrozen(after.catalog.messages.nested.ast[0].options.constructor.value));
  assert.ok(Object.isFrozen(after.catalog.messages.constructor.arguments.__proto__.acceptedTypes));
  const first = createStore({ baseLocale: 'en', locale: 'en', catalogs: [before.catalog] });
  const second = createStore({ baseLocale: 'en', locale: 'en', catalogs: [after.catalog] });
  try {
    for (const [id, args] of [
      ['empty', {}], ['unicode', { name: '제로디' }], ['repeated', { name: 'Saylo' }], ['quoted', {}],
      ['number', { n: 12.5 }], ['date', { d: new Date('2026-10-07T10:15:00Z') }],
      ['time', { d: 1791368100000 }], ['style', { n: 12 }],
      ['nested', { choice: 'constructor', n: 3, name: 'Saylo' }], ['ordinal', { n: 22 }],
      ['constructor', { ['__proto__']: 'literal' }], ['__proto__', { constructor: 'literal' }],
    ]) assert.equal(second.t(`demo:${id}`, args), first.t(`demo:${id}`, args));
  } finally { first.dispose(); second.dispose(); }
  const empty = decodeCatalogResult(json(encodeCatalogResult(outcome({}))));
  assert.deepEqual(json(empty.catalog.messages), {});
  const withoutLocations = json(outcome({ text: 'Hello {name}' }));
  for (const node of withoutLocations.catalog.messages.text.ast) delete node.location;
  assert.deepEqual(json(decodeCatalogResult(json(encodeCatalogResult(withoutLocations)))), withoutLocations);
});

test('full payload cache shares schemas while envelope stamps stay current and sparse patches remain unchanged', () => {
  const first = outcome({ a: '{name}', b: 'Hello {name}', c: 'text' });
  const wire = encodeCatalogResult(first);
  assert.equal(wire.catalog.schemas.length, 2);
  assert.equal(wire.catalog.messages[0][6], wire.catalog.messages[1][6]);
  const newer = encodeCatalogResult({ ...first, sessionId: 'two', catalogVersion: 10, namespaceSchemaFingerprint: 'new-schema' });
  assert.equal(newer.catalog, wire.catalog);
  assert.equal(newer.sessionId, 'two');
  assert.equal(newer.catalogVersion, 10);
  assert.equal(newer.namespaceSchemaFingerprint, 'new-schema');
  const registry = new CatalogRegistry('one', 'en', [first.catalog]);
  registry.replace([outcome({ a: 'edited {name}', b: 'Hello {name}', c: 'text' }).catalog]);
  const patch = registry.loadDelta('en', 'demo', { sessionId: 'one', catalogVersion: 1 });
  assert.equal(patch.status, 'patch');
  for (const result of [first, patch, { status: 'failed', code: 'TEST', message: 'failure' }, registry.load('en', 'missing')]) {
    if (result.status !== 'present') assert.equal(encodeCatalogResult(result), result);
    assert.equal(decodeCatalogResult(result), result);
  }
});

test('compact decoder rejects malformed encodings, duplicate IDs, positions, tuples and schema references', () => {
  const valid = json(encodeCatalogResult(outcome({ a: 'Hello {name}' })));
  const corruptions = [
    wire => { wire.encoding = 'unknown'; },
    wire => { wire.catalogVersion = 0; },
    wire => { wire.catalog.messages.push(wire.catalog.messages[0]); },
    wire => { wire.catalog.messages[0][0] = 'bad:id'; },
    wire => { wire.catalog.messages[0][2] = -1; },
    wire => { wire.catalog.messages[0][4] = 0; },
    wire => { wire.catalog.messages[0][6] = 9; },
    wire => { wire.catalog.messages[0][6] = 0.5; },
    wire => { wire.catalog.messages[0][5][0] = [0, 'text', 0]; },
    wire => { wire.catalog.messages[0][5][0][5] = -1; },
    wire => { wire.catalog.schemas[0].name.acceptedTypes = ['invalid']; },
    wire => { wire.catalog.schemas[0].name.required = false; },
  ];
  for (const corrupt of corruptions) {
    const wire = json(valid); corrupt(wire);
    assert.throws(() => decodeCatalogResult(wire), /Invalid compact/);
  }
});

test('simple interpolation catalogs use less than half the expanded JSON bytes without losing locations', () => {
  const before = outcome(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`message${i}`, `en Message ${i} {name}`])));
  const wire = encodeCatalogResult(before);
  assert.ok(Buffer.byteLength(JSON.stringify(wire)) < Buffer.byteLength(JSON.stringify(before)) / 2);
  assert.deepEqual(json(decodeCatalogResult(json(wire))), json(before));
});
