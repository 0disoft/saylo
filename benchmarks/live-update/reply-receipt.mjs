export const replyServerMetrics = ['selectionToRequestMs', 'lookupMs', 'encodeMs', 'requestToSendMs', 'sendMs', 'handlerMs', 'handlerOtherMs'];
export const replyObservedMetrics = ['lookupMs', 'encodeMs', 'sendMs', 'handlerMs'];
export const replyBrowserMetrics = ['selectToReceiveMs', 'receiveToCommitMs'];
const epsilon = 0.00001;

export function captureReplyReceipt(sample, reply, receivedAt) {
  if (!sample || sample.phase !== 'translation' || reply?.request?.locale !== sample.locale ||
      reply.request.namespace !== 'bench' || reply.result?.key?.locale !== sample.locale ||
      reply.result.key.namespace !== 'bench') return;
  if (!Number.isFinite(sample.selectedAt) || !Number.isFinite(receivedAt) || receivedAt < sample.selectedAt || reply.request.known ||
      !['present', 'compact'].includes(reply.result.status)) throw new Error('Invalid full reply receipt.');
  const count = (sample.replyReceipt?.receipts ?? 0) + 1;
  sample.replyReceipt = { receivedAt, receipts: count, requestId: reply.request.requestId, generation: reply.request.generation };
}

export function finishReplyReceipt(sample, committedAt) {
  const receipt = sample.replyReceipt;
  if (!receipt || receipt.receipts !== 1 || !Number.isFinite(sample.selectedAt) ||
      !Number.isFinite(committedAt) || committedAt < receipt.receivedAt) throw new Error('Missing or duplicate full reply receipt.');
  return { receipts: receipt.receipts, requestId: receipt.requestId, generation: receipt.generation,
    timings: { selectToReceiveMs: receipt.receivedAt - sample.selectedAt, receiveToCommitMs: committedAt - receipt.receivedAt } };
}

export function validateReplyStages(server, browser, selectToCommitMs, selectToAckMs) {
  const finite = value => Number.isFinite(value) && value >= 0;
  if (!finite(selectToCommitMs) || !finite(selectToAckMs) ||
      replyServerMetrics.some(m => !finite(server?.timings?.[m])) ||
      replyBrowserMetrics.some(m => !finite(browser?.timings?.[m])) ||
      replyObservedMetrics.some(m => server?.calls?.[m] !== 1) || browser?.receipts !== 1 ||
      typeof server.requestId !== 'string' || !server.requestId || !Number.isSafeInteger(server.generation) || server.generation < 1 ||
      browser.requestId !== server.requestId || browser.generation !== server.generation)
    throw new Error('Invalid full reply stage observations.');
  const t = server.timings;
  if (Math.abs(t.handlerMs - t.lookupMs - t.encodeMs - t.sendMs - t.handlerOtherMs) > epsilon ||
      t.lookupMs + t.encodeMs > t.requestToSendMs + epsilon || t.requestToSendMs > t.handlerMs + epsilon ||
      t.selectionToRequestMs + t.handlerMs > selectToAckMs + epsilon ||
      Math.abs(browser.timings.selectToReceiveMs + browser.timings.receiveToCommitMs - selectToCommitMs) > epsilon)
    throw new Error('Invalid full reply stage windows.');
}
