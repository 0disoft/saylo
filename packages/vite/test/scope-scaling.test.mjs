import assert from 'node:assert/strict';
import test from 'node:test';
import { measureLazyScope } from '../../../benchmarks/lazy-scope.mjs';

test('sequential lazy catalog growth sends linear subscription metadata and JSON bytes', async t => {
  const samples = [];
  for (const count of [100, 500, 1000]) {
    const sample = await measureLazyScope(count);
    assert.equal(sample.initial.messages, 1);
    assert.equal(sample.initial.metadataEntries, count);
    assert.equal(sample.growth.messages, count);
    assert.equal(sample.growth.metadataEntries, count);
    assert.equal(sample.growth.fullReplacements, 0);
    assert.equal(sample.growth.largestUpdateEntries, 1);
    samples.push(sample);
  }
  const bytesPerCatalog = samples[0].growth.jsonBytes / samples[0].catalogsPerLocale;
  for (const sample of samples) {
    assert.equal(sample.growth.jsonBytes, bytesPerCatalog * sample.catalogsPerLocale);
    t.diagnostic(JSON.stringify(sample));
  }
});

test('reverse concurrent replies and an empty initial scope also use single-pair updates', async () => {
  for (const initialBase of [true, false]) {
    const sample = await measureLazyScope(16, { reverseReplies: true, initialBase });
    assert.equal(sample.initial.metadataEntries, initialBase ? 16 : 0);
    assert.equal(sample.growth.metadataEntries, 16);
    assert.equal(sample.growth.fullReplacements, 0);
    assert.equal(sample.growth.largestUpdateEntries, 1);
  }
});
