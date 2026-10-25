import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { createBaseSchema, createServerI18n, createTranslator, decodeCatalog, encodeCatalog, serializeBootSnapshot } from '@0disoft/saylo-core/runtime';
import { parseCatalog as parse } from '@0disoft/saylo-core';

const options = { locale: 'en', namespace: 'demo', sourceName: 'en/demo.json' };
const roundtrip = input => decodeCatalog(JSON.parse(JSON.stringify(encodeCatalog(input))));
const json = input => JSON.parse(JSON.stringify(input));

test('catalog codec round-trips literal, ICU, skeleton, rich and prototype-like keys with exact locations', () => {
  const messages = Object.assign(Object.create(null), { plain: 'Hello {name}', literal: '<script> & \\ \u2028',
    plural: '{n, plural, one {# item} other {# items}}', select: '{kind, select, a {A} other {B}}',
    ordinal: '{n, selectordinal, one {#st} other {#th}}', number: '{n, number, ::currency/USD}',
    date: '{at, date, ::yyyyMMdd}', rich: '<link>Hello {name}</link>' });
  messages.__proto__ = 'Own property';
  const original = parse(JSON.stringify(messages, null, 2), { ...options, richText: { rich: ['link'] } });
  const restored = roundtrip(original);
  assert.deepEqual(json(restored), json(original));
  assert.equal(createBaseSchema(restored).fingerprint, createBaseSchema(original).fingerprint);
  assert.ok(Object.isFrozen(restored.messages.rich.ast));
  const before = createTranslator({ locale: 'en', baseCatalogs: [original], timeZone: 'UTC' });
  const after = createTranslator({ locale: 'en', baseCatalogs: [restored], timeZone: 'UTC' });
  for (const [key, values] of [['plain', { name: 'N' }], ['plural', { n: 2 }], ['number', { n: 123.4 }], ['date', { at: new Date('2026-01-01') }]])
    assert.equal(after.t(`demo:${key}`, values), before.t(`demo:${key}`, values));
  assert.deepEqual(after.tParts('demo:rich', { name: 'N' }), before.tParts('demo:rich', { name: 'N' }));
});

test('codec snapshots mutable inputs, shares immutable data, and does not freeze callers', () => {
  const catalog = parse('{"x":"Before {name}"}', options);
  assert.equal(encodeCatalog(catalog), encodeCatalog(catalog));
  const mutable = json(catalog), first = encodeCatalog(mutable);
  mutable.messages.x.source = 'After {name}';
  assert.equal(decodeCatalog(first).messages.x.source, 'Before {name}');
  assert.equal(decodeCatalog(encodeCatalog(mutable)).messages.x.source, 'After {name}');
  assert.ok(!Object.isFrozen(mutable.messages.x));
  const wire = json(first), restored = decodeCatalog(wire);
  wire.schemas[0].name.acceptedTypes.length = 0;
  wire.messages[0][1] = 'Changed';
  assert.equal(restored.messages.x.source, 'Before {name}');
  assert.deepEqual(restored.messages.x.arguments.name.acceptedTypes, ['string', 'number']);
  assert.ok(!Object.isFrozen(wire));
});

test('codec rejects duplicate IDs, bad schemas, positions, tuple encodings and tags', () => {
  const catalog = parse('{"x":"Hello {name}"}', options);
  for (const edit of [
    wire => wire.messages.push(wire.messages[0]), wire => { wire.format = 'future'; },
    wire => { wire.messages[0][6] = 99; }, wire => { wire.messages[0][2] = -1; },
    wire => { wire.messages[0][5][0][0] = 99; }, wire => { wire.messages[0][5][0][1] = 7; },
    wire => { wire.schemas[0].name.acceptedTypes = ['invalid']; }, wire => { wire.messages[0][7] = ['link', 'link']; },
  ]) { const wire = json(encodeCatalog(catalog)); edit(wire); assert.throws(() => decodeCatalog(wire), /compact catalog/); }
});

test('large catalog compaction reduces raw and gzip bytes without dropping formatter identity', async t => {
  const messages = Object.fromEntries(Array.from({ length: 3000 }, (_, index) => [`item${index}`, `Item ${index}: {name}`]));
  const catalog = parse(JSON.stringify(messages), options);
  const raw = JSON.stringify(catalog), packed = JSON.stringify(encodeCatalog(catalog));
  const sizes = { rawBytes: Buffer.byteLength(raw), compactBytes: Buffer.byteLength(packed), rawGzip: gzipSync(raw).length, compactGzip: gzipSync(packed).length };
  t.diagnostic(JSON.stringify(sizes));
  assert.ok(sizes.compactBytes < sizes.rawBytes * 0.6);
  assert.ok(sizes.compactGzip < sizes.rawGzip);
  assert.deepEqual(json(decodeCatalog(JSON.parse(packed))), json(catalog));
  const metadata = { status: 'present', key: { locale: 'en', namespace: 'demo' }, catalogVersion: 1,
    namespaceSchemaFingerprint: createBaseSchema(catalog).fingerprint };
  const source = { readManifest: () => ({ sessionId: 'measure', registryRevision: 0, baseLocale: 'en',
    availableLocales: ['en'], availableNamespaces: ['demo'], catalogs: [metadata] }),
    loadCatalog: async () => ({ ...metadata, sessionId: 'measure', catalog }) };
  const instance = await createServerI18n({ catalogSource: source, locale: 'en', initialNamespaces: ['demo'] });
  try {
    const expandedBoot = serializeBootSnapshot(instance.getBootSnapshot());
    const compactBoot = serializeBootSnapshot(instance.getBootSnapshot(), { compact: true });
    t.diagnostic(JSON.stringify({ bootBytes: Buffer.byteLength(expandedBoot), compactBootBytes: Buffer.byteLength(compactBoot),
      bootGzip: gzipSync(expandedBoot).length, compactBootGzip: gzipSync(compactBoot).length }));
    assert.ok(compactBoot.length < expandedBoot.length * 0.6);
  } finally { instance.dispose(); }
});
