// The optimizer may inline this benchmark helper into a chunk. The app's copy
// uses the same state without joining or changing any product module identities.
const key = Symbol.for('saylo.benchmark.client-stages');
const state = globalThis[key] ??= { current: undefined };
export const clientStagesEnabled = true;
const metrics = ['decodeMs', 'freezeMs', 'acceptMs', 'acceptCheckMs', 'acceptFreezeMs', 'snapshotMs', 'translatorMs', 'signatureMs'];
const residual = value => {
  if (!Number.isFinite(value) || value < -0.00001) throw new Error('Client stages exceed their window.');
  return Math.max(0, value);
};

export function beginClientSample(receivedAt) {
  if (state.current || !Number.isFinite(receivedAt) || receivedAt < 0) throw new Error('Invalid or overlapping client sample.');
  state.current = { receivedAt, timings: Object.fromEntries(metrics.map(m => [m, 0])),
    calls: Object.fromEntries(metrics.map(m => [m, 0])), frozenCatalogs: [], trust: [] };
}
export function measureBrowserStage(metric, work) {
  const sample = state.current;
  if (!sample) return work();
  if (!Object.hasOwn(sample.timings, metric)) throw new Error('Unexpected client stage.');
  if (sample.publishedAt !== undefined) throw new Error('Client stage after publication.');
  const startedAt = performance.now();
  try { return work(); }
  finally { sample.timings[metric] += performance.now() - startedAt; sample.calls[metric]++; }
}
export function observeViteFrozen(catalogs) {
  if (state.current) state.current.frozenCatalogs.push(...catalogs);
}
export function observeCoreTrust(outcome, isDeepFrozen) {
  if (state.current && outcome?.status === 'present' && outcome.key && outcome.catalog) state.current.trust.push({
    locale: outcome.key.locale, namespace: outcome.key.namespace,
    sameCatalog: state.current.frozenCatalogs.includes(outcome.catalog), trusted: isDeepFrozen(outcome.catalog),
  });
}
export function captureClientPublication(publishedAt) {
  const sample = state.current;
  if (!sample || sample.publishedAt !== undefined || !Number.isFinite(publishedAt) || publishedAt < sample.receivedAt)
    throw new Error('Invalid or duplicate client publication.');
  sample.publishedAt = publishedAt;
}
export function finishClientSample(committedAt) {
  const sample = state.current; state.current = undefined;
  if (!sample || metrics.some(m => sample.calls[m] !== 1) || sample.publishedAt === undefined ||
      !Number.isFinite(committedAt) || committedAt < sample.publishedAt || sample.trust.length !== 1)
    throw new Error('Incomplete client observations.');
  const { timings: t, calls, trust } = sample;
  t.acceptOtherMs = residual(t.acceptMs - t.acceptCheckMs - t.acceptFreezeMs);
  t.snapshotOtherMs = residual(t.snapshotMs - t.translatorMs - t.signatureMs);
  t.receiveToPublishMs = sample.publishedAt - sample.receivedAt;
  t.clientOtherMs = residual(t.receiveToPublishMs - t.decodeMs - t.freezeMs - t.acceptMs - t.snapshotMs);
  t.publishToCommitMs = committedAt - sample.publishedAt;
  return { timings: t, calls, trust: trust[0] };
}
