import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { beginReplySample, withCatalogReplyProbe, measureReplySync, finishReplySample,
  transformReplyModule, registerReplyProbe, replyReceiptPlugin } from './reply-profile.mjs';
import { captureReplyReceipt, finishReplyReceipt, validateReplyStages, replyObservedMetrics } from './reply-receipt.mjs';

const request = { locale: 'en-GB', namespace: 'bench', requestId: 'full:1', generation: 1 };
const reply = { request, result: { status: 'compact', key: { locale: 'en-GB', namespace: 'bench' } } };
const browserSample = () => ({ phase: 'translation', locale: 'en-GB', selectedAt: 100 });
const receipt = () => {
  const sample = browserSample(); captureReplyReceipt(sample, reply, 125); return finishReplyReceipt(sample, 150);
};

test('full handler transform preserves lookup/encoding/send, request validation and cleanup identity', async () => {
  const code = await readFile(new URL('../../packages/vite/dist/index.js', import.meta.url), 'utf8');
  const next = transformReplyModule(code);
  const body = next.slice(next.indexOf('const requestCatalog ='), next.indexOf('    const onFile ='));
  let lookups = 0, encodes = 0, sends = 0;
  const outcome = { status: 'present' };
  const handler = new Function('withCatalogReplyProbe', 'measureReplySync', 'isCatalogRequest', 'registry', 'encodeCatalogResult', 'CATALOG_EVENT',
    `${body}; return requestCatalog;`)(withCatalogReplyProbe, measureReplySync, value => value === request,
    { loadDelta(...args) { assert.deepEqual(args, ['en-GB', 'bench', undefined]); lookups++; return outcome; } },
    value => { assert.equal(value, outcome); encodes++; return reply.result; }, 'saylo:catalog');
  const client = { send(frame) {
    sends++;
    if (frame.data.result.status === 'failed') return;
    assert.equal(frame.data.request, request);
    return measureReplySync('sendMs', () => assert.equal(frame.data.result, reply.result));
  } };
  handler({}, client);
  assert.equal(sends, 1); assert.equal(lookups, 0); assert.equal(encodes, 0);
  beginReplySample(performance.now() - 10);
  handler(request, client);
  const server = finishReplySample();
  assert.equal(lookups, 1); assert.equal(encodes, 1); assert.equal(sends, 2);
  assert.deepEqual(server.calls, Object.fromEntries(replyObservedMetrics.map(m => [m, 1])));
  validateReplyStages(server, receipt(), 50, server.timings.selectionToRequestMs + server.timings.handlerMs + 100);
  assert.ok(next.includes('server?.ws.off(CATALOG_REQUEST_EVENT, requestCatalog)'));
  assert.throws(() => transformReplyModule(code.replace('registry.loadDelta(data.locale, data.namespace, data.known)', 'registry.load(data.locale, data.namespace)')), /probe boundary/);
});

test('server sampling excludes other pairs, boot/reset work and rejects incomplete/duplicate requests', () => {
  assert.equal(measureReplySync('lookupMs', () => 'boot'), 'boot');
  beginReplySample(performance.now());
  assert.throws(() => beginReplySample(performance.now()), /overlapping/);
  withCatalogReplyProbe({ ...request, locale: 'en' }, () => measureReplySync('lookupMs', () => {}));
  assert.throws(() => finishReplySample(), /Incomplete/);
  beginReplySample(performance.now());
  withCatalogReplyProbe(request, () => {
    for (const metric of ['lookupMs', 'encodeMs', 'sendMs']) measureReplySync(metric, () => {});
    assert.throws(() => measureReplySync('unknown', () => {}), /Unknown/);
  });
  assert.throws(() => withCatalogReplyProbe(request, () => {}), /one fresh/);
  assert.equal(finishReplySample().calls.handlerMs, 1);
  assert.equal(measureReplySync('sendMs', () => 'reset'), 'reset');
});

test('receipt precedes processing and partitions selection using browser clock alone', () => {
  const sample = browserSample();
  captureReplyReceipt({ ...sample, phase: 'listing' }, reply, 125);
  captureReplyReceipt(sample, { ...reply, request: { ...request, locale: 'en' } }, 125);
  assert.equal(sample.replyReceipt, undefined);
  captureReplyReceipt(sample, reply, 125);
  assert.deepEqual(finishReplyReceipt(sample, 150), { receipts: 1, requestId: 'full:1', generation: 1,
    timings: { selectToReceiveMs: 25, receiveToCommitMs: 25 } });
  captureReplyReceipt(sample, reply, 126);
  assert.throws(() => finishReplyReceipt(sample, 150), /duplicate/);
  assert.throws(() => finishReplyReceipt(browserSample(), 150), /Missing/);
  assert.throws(() => captureReplyReceipt(browserSample(), reply, 99), /Invalid/);
});

test('ack validation rejects cross-request identities, missing calls and invalid independent windows', () => {
  const server = { requestId: 'full:1', generation: 1, calls: Object.fromEntries(replyObservedMetrics.map(m => [m, 1])),
    timings: { selectionToRequestMs: 10, lookupMs: 2, encodeMs: 4, requestToSendMs: 7, sendMs: 3, handlerMs: 12, handlerOtherMs: 3 } };
  validateReplyStages(server, receipt(), 50, 100);
  assert.throws(() => validateReplyStages(server, { ...receipt(), requestId: 'other' }, 50, 100));
  for (const mutate of [
    copy => { copy.calls.encodeMs = 0; }, copy => { copy.timings.handlerMs = 8; },
    copy => { copy.timings.encodeMs = Infinity; }, copy => { copy.timings.handlerOtherMs = 5; },
    copy => { copy.timings.requestToSendMs = 1; }, copy => { copy.timings.selectionToRequestMs = 200; },
  ]) { const copy = structuredClone(server); mutate(copy); assert.throws(() => validateReplyStages(copy, receipt(), 50, 100)); }
  assert.throws(() => validateReplyStages(server, receipt(), 40, 100));
});

test('receipt plugin does not transform product modules or change optimizer configuration', async () => {
  const plugin = replyReceiptPlugin(true);
  assert.equal(plugin.transform, undefined); assert.equal(plugin.config, undefined);
  const id = plugin.resolveId('virtual:saylo-benchmark/reply-profile');
  assert.ok((await plugin.load(id)).includes('replyStagesEnabled = true'));
  const disabled = replyReceiptPlugin(false);
  const source = await disabled.load(id);
  assert.ok(source.includes('replyStagesEnabled = false') && !source.includes('validateReplyStages'));
  const inactive = registerReplyProbe(false); inactive.assertTransformed(); inactive.dispose();
});
