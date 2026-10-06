import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCatalog } from '@0disoft/saylo-core';
import { freeze } from '../dist/diagnostics.js';
import { createLoadedSignature } from '../dist/snapshot-signature.js';

const manifest = { availableLocales: ['en', 'ko'], availableNamespaces: ['common'] };
const catalog = text => parseCatalog(text, { locale: 'ko', namespace: 'common' });
const legacy = (locale, namespaces, catalogs) => JSON.stringify([locale, manifest.availableLocales,
  manifest.availableNamespaces, namespaces, catalogs.map(c => [c.locale, c.namespace,
    Object.keys(c.messages).sort().map(id => [id, c.messages[id].source])])]);

test('fragment composition preserves exact signatures for empty scopes and escaped literal IDs/text', () => {
  const catalogs = [catalog('{"z":"quote \\" and newline \\n","__proto__":"한글 👋","a":"{name}"}')];
  for (const scope of [[], ['common']]) for (const records of [[], catalogs]) {
    assert.equal(createLoadedSignature(manifest, 'en', scope, records), legacy('en', scope, records));
  }
  assert.equal(createLoadedSignature(manifest, 'ko', ['common'], catalogs), legacy('ko', ['common'], catalogs));
});

test('trusted immutable catalogs reuse key enumeration, mutable and shallow-frozen catalogs do not', () => {
  let enumerations = 0;
  const messages = new Proxy({ title: { source: 'old' } }, { ownKeys(target) { enumerations++; return Reflect.ownKeys(target); } });
  const trusted = freeze({ locale: 'ko', namespace: 'common', messages });
  enumerations = 0;
  const first = createLoadedSignature(manifest, 'ko', ['common'], [trusted]);
  assert.equal(enumerations, 1);
  assert.equal(createLoadedSignature(manifest, 'ko', ['common'], [trusted]), first);
  assert.equal(enumerations, 1);

  const shallow = Object.freeze({ locale: 'ko', namespace: 'common', messages: { title: { source: 'old' } } });
  const before = createLoadedSignature(manifest, 'ko', ['common'], [shallow]);
  shallow.messages.title.source = 'new';
  assert.notEqual(createLoadedSignature(manifest, 'ko', ['common'], [shallow]), before);
});

test('equivalent replacement and positions stay no-op while text, keys and scope still change identity', () => {
  const original = catalog('{"a":"A","b":"B"}');
  const reordered = catalog('{\n "b":"B", "a":"A"\n}');
  const first = createLoadedSignature(manifest, 'ko', ['common'], [original]);
  assert.equal(createLoadedSignature(manifest, 'ko', ['common'], [reordered]), first);
  for (const changed of [catalog('{"a":"changed","b":"B"}'), catalog('{"a":"A"}')])
    assert.notEqual(createLoadedSignature(manifest, 'ko', ['common'], [changed]), first);
  assert.notEqual(createLoadedSignature(manifest, 'en', ['common'], [original]), first);
  assert.notEqual(createLoadedSignature(manifest, 'ko', [], [original]), first);
  assert.notEqual(createLoadedSignature({ ...manifest, availableLocales: ['en', 'ja', 'ko'] }, 'ko', ['common'], [original]), first);
});
