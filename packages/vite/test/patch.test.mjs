import assert from 'node:assert/strict';
import test from 'node:test';
import { createBaseSchema, parseCatalog } from '@saylo/core';
import { applyCatalogPatch } from '../dist/catalog-patch.js';
import { CatalogRegistry } from '../dist/catalog-registry.js';
import { isCatalogRequest } from '../dist/types.js';
const parse = source => parseCatalog(source, { locale: 'ko', namespace: 'demo' });
const stamp = outcome => ({ sessionId: outcome.sessionId, catalogVersion: outcome.catalogVersion });

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

test('catalog request validators reject malformed known stamps but accept legacy full requests', () => {
  const request = { requestId: 'one', generation: 1, locale: 'ko', namespace: 'demo' };
  assert.ok(isCatalogRequest(request));
  assert.ok(isCatalogRequest({ ...request, known: { sessionId: 'one', catalogVersion: 1 } }));
  for (const known of [null, {}, { sessionId: '', catalogVersion: 1 }, { sessionId: 'one', catalogVersion: 0 },
    { sessionId: 'one', catalogVersion: 1.5 }]) assert.equal(isCatalogRequest({ ...request, known }), false);
});
