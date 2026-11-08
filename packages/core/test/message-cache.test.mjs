import assert from 'node:assert/strict';
import test from 'node:test';
import { IntlMessageFormat } from 'intl-messageformat';
import { createTranslator, parseCatalog } from '@0disoft/saylo-core';
import { MessageCache } from '../dist/message-cache.js';

test('message admission retains at most 256 values during long scans', () => {
  const cache = new MessageCache(256);
  for (let key = 0; key < 10000; key++) {
    assert.equal(cache.get(key, () => key), key);
    assert.ok(cache.size <= 256);
  }
  assert.equal(cache.size, 256);
});

test('cold entries make room for a new hot working set and failed creation preserves residents', () => {
  const cache = new MessageCache(4);
  for (let pass = 0; pass < 5; pass++) for (let key = 0; key < 4; key++) cache.get(key, () => key);
  let created;
  for (let pass = 0; pass < 12; pass++) {
    created = 0;
    for (let key = 4; key < 8; key++) assert.equal(cache.get(key, () => { created++; return key; }), key);
    assert.equal(cache.size, 4);
  }
  assert.equal(created, 0, 'A disjoint hot set must eventually be admitted');
  const failure = new Error('construction failed');
  assert.throws(() => cache.get('broken', () => { throw failure; }), error => error === failure);
  for (let key = 4; key < 8; key++) assert.equal(cache.get(key, () => assert.fail('Resident was lost')), key);
});

test('real text and rich formatter caches avoid all-miss cycles at 257 and 512 messages', () => {
  const resolveLocale = IntlMessageFormat.resolveLocale;
  let created = 0;
  IntlMessageFormat.resolveLocale = (...args) => { created++; return resolveLocale(...args); };
  try {
    for (const surface of ['t', 'tParts']) for (const count of [256, 257, 512]) {
      const catalog = parseCatalog(JSON.stringify(Object.fromEntries(Array.from({ length: count }, (_, index) =>
        [`m${index}`, `M${index} {n, number} {name}`]))), { locale: 'en', namespace: 'cycle' });
      const translator = createTranslator({ locale: 'en', baseCatalogs: [catalog] });
      const keys = Object.keys(catalog.messages).map(key => 'cycle:' + key);
      const run = rounds => {
        let result;
        for (let round = 0; round < rounds; round++) for (const key of keys)
          result = translator[surface](key, { n: 1234.5, name: 'Saylo' });
        const expected = `M${count - 1} 1,234.5 Saylo`;
        assert.deepEqual(result, surface === 't' ? expected : [{ type: 'text', value: expected }]);
      };
      run(10); created = 0; run(20);
      const maximum = count === 256 ? 0 : count === 257 ? 20 * count * 0.01 : 20 * count * 0.6;
      assert.ok(created <= maximum, `${surface}/${count}: ${created} constructions exceed ${maximum}`);
    }
  } finally { IntlMessageFormat.resolveLocale = resolveLocale; }
});
