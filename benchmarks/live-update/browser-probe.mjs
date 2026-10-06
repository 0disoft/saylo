const metrics = ['patchMs', 'freezeMs', 'snapshotMs', 'translatorMs', 'signatureMs'];
let current;

export function beginBrowserSample() {
  current = { timings: Object.fromEntries(metrics.map(metric => [metric, 0])),
    calls: Object.fromEntries(metrics.map(metric => [metric, 0])) };
}

export function measureBrowserStage(metric, work) {
  const sample = current;
  if (!sample) return work();
  const startedAt = performance.now();
  try { return work(); }
  finally {
    sample.timings[metric] += performance.now() - startedAt;
    sample.calls[metric]++;
  }
}

export function finishBrowserSample() {
  const sample = current;
  current = undefined;
  if (!sample || metrics.some(metric => !sample.calls[metric])) throw new Error('Missing browser stage observation.');
  return sample;
}
