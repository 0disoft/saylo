import assert from 'node:assert/strict';
import test from 'node:test';
import { summarize } from './statistics.mjs';

test('timing summaries use nearest ranks on actual samples and reject invalid observations', () => {
  const values = Array.from({ length: 20 }, (_, index) => 20 - index);
  assert.deepEqual(summarize(values), { count: 20, p50Ms: 10, p95Ms: 19, minMs: 1, maxMs: 20 });
  assert.equal(values[0], 20);
  for (const invalid of [[], [NaN], [Infinity], [-1]]) assert.throws(() => summarize(invalid));
});
