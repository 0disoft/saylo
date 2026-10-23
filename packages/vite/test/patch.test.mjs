import assert from 'node:assert/strict';
import test from 'node:test';
import { createBaseSchema, parseCatalog } from '@0disoft/saylo-core';
import { applyCatalogPatch, createCatalogPatch } from '../dist/catalog-patch.js';
import { CatalogRegistry } from '../dist/catalog-registry.js';
import { isCatalogRequest } from '../dist/types.js';
const parse = source => parseCatalog(source, { locale: 'ko', namespace: 'demo' });
const stamp = outcome => ({ sessionId: outcome.sessionId, catalogVersion: outcome.catalogVersion });

test('patch sealing copies mutable caller data and shares only trusted immutable messages', () => {
  const before = parse('{"keep":"{name}","edit":"old"}');
  const after = parse('{"keep":"{name}","edit":"new"}');
  const baseline = { status: 'present', sessionId: 'owned', catalogVersion: 1,
    key: { locale: 'ko', namespace: 'demo' }, namespaceSchemaFingerprint: 'schema', catalog: before };
  const outcome = { ...baseline, catalogVersion: 2, catalog: after };
  const wire = JSON.parse(JSON.stringify(createCatalogPatch(before, outcome, stamp(baseline))));
  const merged = applyCatalogPatch(baseline, wire);
  assert.equal(merged.catalog.messages.keep, before.messages.keep);
  assert.ok(Object.isFrozen(merged.catalog));
  assert.ok(Object.isFrozen(merged.catalog.messages));
  assert.ok(Object.isFrozen(merged.catalog.messages.edit.ast));
  assert.equal(Object.isFrozen(wire.upsert[0][1]), false);
  const external = JSON.parse(JSON.stringify(baseline));
  const independent = applyCatalogPatch(external, wire);
  assert.equal(Object.isFrozen(external.catalog.messages.keep), false);
  external.catalog.messages.keep.ast[0].value = 'caller changed';
  wire.upsert[0][1].source = 'caller changed';
  assert.equal(independent.catalog.messages.keep.ast[0].value, 'name');
  assert.equal(independent.catalog.messages.edit.source, 'new');
  assert.equal(merged.catalog.messages.edit.source, 'new');
});

test('policy-only changes increment catalog versions and carry their rich contract in a delta', () => {
  const before = parse('{"x":"<link>Terms</link>"}');
  const after = parseCatalog('{"x":"<link>Terms</link>"}', { locale: 'ko', namespace: 'demo', richText: { x: ['link'] } });
  const registry = new CatalogRegistry('rich', 'ko', [before]);
  const old = registry.load('ko', 'demo');
  registry.replace([after]);
  const next = registry.load('ko', 'demo');
  assert.ok(next.catalogVersion > old.catalogVersion);
  const patch = registry.loadDelta('ko', 'demo', stamp(old));
  assert.equal(patch.upsert.length, 1);
  assert.deepEqual(applyCatalogPatch(old, patch), next);
});

test('registry lookup follows a newer base schema even when the translation version stays unchanged', () => {
  const base = parse('{"x":"hello"}');
  const translated = parseCatalog('{"x":"translated"}', { locale: 'en', namespace: 'demo' });
  const registry = new CatalogRegistry('one', 'ko', [base, translated]);
  const before = registry.load('en', 'demo');
  const previousManifest = registry.manifest();
  const nextBase = parse('{"x":"hello {name}"}');
  registry.replace([nextBase, translated]);
  const next = registry.load('en', 'demo');
  assert.equal(next.catalogVersion, before.catalogVersion);
  assert.equal(next.namespaceSchemaFingerprint, createBaseSchema(nextBase).fingerprint);
  assert.notEqual(next.namespaceSchemaFingerprint, before.namespaceSchemaFingerprint);
  assert.equal(previousManifest.catalogs.find(meta => meta.key.locale === 'en').namespaceSchemaFingerprint,
    before.namespaceSchemaFingerprint);
  registry.replace([nextBase]);
  const removed = registry.load('en', 'demo');
  assert.equal(removed.status, 'missing');
  assert.ok(removed.catalogVersion > before.catalogVersion);
  registry.replace([nextBase, translated]);
  const restored = registry.load('en', 'demo');
  assert.equal(restored.status, 'present');
  assert.ok(restored.catalogVersion > removed.catalogVersion);
  assert.equal(restored.namespaceSchemaFingerprint, next.namespaceSchemaFingerprint);
  assert.equal(registry.load('fr', 'unknown').catalogVersion, 0);
});

test('wire deltas carry additions, removals and positions while preserving literal prototype-like IDs', () => {
  const before = parse('{"__proto__":"first","keep":"{name}","remove":"old"}');
  const after = parse('{\n"keep":"{name}","__proto__":"edited","constructor":"new"\n}');
  const registry = new CatalogRegistry('one', 'ko', [before]);
  const baseline = registry.load('ko', 'demo');
  registry.replace([after]);
  const patch = JSON.parse(JSON.stringify(registry.loadDelta('ko', 'demo', stamp(baseline))));
  assert.equal(patch.status, 'patch');
  assert.deepEqual(patch.upsert.map(([id]) => id).sort(), ['__proto__', 'constructor']);
  assert.deepEqual(patch.remove, ['remove']);
  assert.deepEqual(patch.positions.map(([id]) => id), ['keep']);
  const merged = applyCatalogPatch(baseline, patch);
  assert.deepEqual(JSON.parse(JSON.stringify(merged.catalog)), JSON.parse(JSON.stringify(after)));
  assert.equal(Object.getPrototypeOf(merged.catalog.messages), null);
  assert.equal(merged.catalog.messages.keep.ast, before.messages.keep.ast);
  assert.equal(merged.namespaceSchemaFingerprint, createBaseSchema(after).fingerprint);
  assert.equal(before.messages.__proto__.source, 'first');
  assert.ok(Object.hasOwn(before.messages, 'remove'));
  for (const corrupted of [
    { ...patch, base: { ...patch.base, catalogVersion: 99 } },
    { ...patch, positions: [['keep', { offset: -1, line: 1, column: 1 }]] },
    { ...patch, remove: ['keep'], positions: patch.positions },
    { ...patch, upsert: [...patch.upsert, patch.upsert[0]] },
  ]) assert.throws(() => applyCatalogPatch(baseline, corrupted));
});

test('source-only reformatting advances pair versions and produces exact positions without retransmitting AST', () => {
  const before = parse('{"x":"{name}","y":"text"}');
  const after = parse('{\n  "y": "text",\n  "x": "{name}"\n}');
  const registry = new CatalogRegistry('one', 'ko', [before]);
  const baseline = registry.load('ko', 'demo');
  registry.replace([after]);
  const patch = registry.loadDelta('ko', 'demo', stamp(baseline));
  assert.ok(patch.catalogVersion > baseline.catalogVersion);
  assert.equal(patch.upsert.length, 0);
  assert.deepEqual(applyCatalogPatch(baseline, patch).catalog, after);
});

test('uniform source movement is encoded once and reconstructs exact positions for unchanged AST', () => {
  const before = parse('{"probe":"a","x":"{name}","y":"text"}');
  const after = parse('{"probe":"longer","x":"{name}","y":"text"}');
  const registry = new CatalogRegistry('one', 'ko', [before]);
  const baseline = registry.load('ko', 'demo');
  registry.replace([after]);
  const patch = registry.loadDelta('ko', 'demo', stamp(baseline));
  assert.deepEqual(patch.positionShift, { offsetDelta: 5, lineDelta: 0, columnDelta: 5 });
  assert.equal(patch.positions.length, 0);
  const merged = applyCatalogPatch(baseline, JSON.parse(JSON.stringify(patch)));
  assert.deepEqual(JSON.parse(JSON.stringify(merged.catalog)), JSON.parse(JSON.stringify(after)));
  assert.equal(merged.catalog.messages.x.ast, before.messages.x.ast);
  assert.throws(() => applyCatalogPatch(baseline, { ...patch, messageCount: 99 }), /count/);
  assert.throws(() => applyCatalogPatch(baseline, { ...patch, positionShift: { ...patch.positionShift, lineDelta: -99 } }), /outside/);
});

test('older baselines, new sessions, dense edits and deleted/recreated pairs fall back to full outcomes', () => {
  const messages = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`m${i}`, 'initial']));
  const before = parse(JSON.stringify(messages));
  const registry = new CatalogRegistry('one', 'ko', [before]);
  const baseline = registry.load('ko', 'demo');
  registry.replace([parse(JSON.stringify({ ...messages, m0: 'first' }))]);
  registry.replace([parse(JSON.stringify({ ...messages, m0: 'later' }))]);
  assert.equal(registry.loadDelta('ko', 'demo', stamp(baseline)).status, 'present');
  assert.equal(registry.loadDelta('ko', 'demo', { ...stamp(baseline), sessionId: 'old' }).status, 'present');
  const latest = registry.load('ko', 'demo');
  registry.replace([parse(JSON.stringify(Object.fromEntries(Object.keys(messages).map(id => [id, 'edited']))))]);
  assert.equal(registry.loadDelta('ko', 'demo', stamp(latest)).status, 'present');
  registry.replace([]);
  assert.equal(registry.loadDelta('ko', 'demo', stamp(latest)).status, 'missing');
  registry.replace([before]);
  assert.equal(registry.loadDelta('ko', 'demo', stamp(latest)).status, 'present');
});

test('mixed source movement remains individual and inherited messages never enter a patch', () => {
  const before = parse('{"keep":"a","probe":"b","x":"text","y":"text"}');
  const after = parse('{"keep":"a","probe":"longer","x":"text","y":"text"}');
  const registry = new CatalogRegistry('one', 'ko', [before]);
  const baseline = registry.load('ko', 'demo');
  registry.replace([after]);
  const outcome = registry.load('ko', 'demo');
  const inherited = { ghost: before.messages.keep };
  const withInherited = catalog => ({ ...catalog, messages: Object.assign(Object.create(inherited), catalog.messages) });
  const patch = createCatalogPatch(withInherited(before), { ...outcome, catalog: withInherited(after) }, stamp(baseline));
  assert.equal(patch.messageCount, 4);
  assert.equal(patch.positionShift, undefined);
  assert.deepEqual(patch.positions.map(([id]) => id), ['x', 'y']);
  assert.deepEqual(patch.upsert.map(([id]) => id), ['probe']);
  assert.deepEqual(patch.remove, []);
  assert.deepEqual(applyCatalogPatch(baseline, patch).catalog, after);
});

test('catalog request validators reject malformed known stamps but accept legacy full requests', () => {
  const request = { requestId: 'one', generation: 1, locale: 'ko', namespace: 'demo' };
  assert.ok(isCatalogRequest(request));
  assert.ok(isCatalogRequest({ ...request, known: { sessionId: 'one', catalogVersion: 1 } }));
  for (const known of [null, {}, { sessionId: '', catalogVersion: 1 }, { sessionId: 'one', catalogVersion: 0 },
    { sessionId: 'one', catalogVersion: 1.5 }]) assert.equal(isCatalogRequest({ ...request, known }), false);
});
