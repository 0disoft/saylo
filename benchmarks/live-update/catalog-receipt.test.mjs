import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogReceipt } from './catalog-receipt.mjs';

const key = { locale: 'en', namespace: 'bench' };
const present = { key, status: 'present', catalog: { messages: { probe: { source: 'updated' } } } };
const compact = { key, status: 'compact', catalog: { messages: [['other', 'unchanged'], ['probe', 'updated']] } };
const patch = { key, status: 'patch', upsert: [['probe', { source: 'updated' }]] };

test('edit receipts recognize full, compact and delta results from both wire transports', () => {
  for (const result of [present, compact, patch]) {
    assert.deepEqual(catalogReceipt('saylo:catalog', { result }), { result, source: 'updated', transport: 'request' });
    const unrelated = { ...result, key: { ...key, locale: 'ko' } };
    assert.deepEqual(catalogReceipt('saylo:catalog-push', { kind: 'patch', outcomes: [unrelated, result] }),
      { result, source: 'updated', transport: 'push' });
  }
});

test('unrelated events, pairs and patches without the rendered key are not receipts', () => {
  for (const [event, data] of [
    ['saylo:manifest', { result: present }],
    ['saylo:catalog', { result: { ...present, key: { ...key, namespace: 'other' } } }],
    ['saylo:catalog', { result: { key, status: 'missing' } }],
    ['saylo:catalog', { result: { ...patch, upsert: [['other', { source: 'updated' }]] } }],
    ['saylo:catalog-push', { kind: 'patch', outcomes: [] }],
    ['saylo:catalog-push', { kind: 'snapshot', outcomes: [present] }],
    ['saylo:catalog-push', { kind: 'patch' }],
  ]) assert.equal(catalogReceipt(event, data), undefined);
});

test('locale additions count pushed catalogs as pre-selection transfers', () => {
  const result = { ...compact, key: { locale: 'en-GB', namespace: 'bench' } };
  const data = { kind: 'patch', outcomes: [result] };
  assert.equal(catalogReceipt('saylo:catalog-push', data), undefined);
  assert.equal(catalogReceipt('saylo:catalog-push', data, 'en-GB').source, 'updated');
  assert.equal(catalogReceipt('saylo:catalog', { result }, 'en-GB').transport, 'request');
});
