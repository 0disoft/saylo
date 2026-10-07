const metrics = ['patchMs', 'freezeMs', 'snapshotMs', 'translatorMs', 'signatureMs'];
const localeMetrics = ['decodeMs', 'freezeMs', 'snapshotMs', 'translatorMs', 'signatureMs'];
let current;

export function beginBrowserSample(mode = 'edit') {
  if (current || !['edit', 'locale-add'].includes(mode)) throw new Error('Invalid or overlapping browser stage sample.');
  const selected = mode === 'locale-add' ? localeMetrics : metrics;
  current = { mode, timings: Object.fromEntries(selected.map(metric => [metric, 0])),
    calls: Object.fromEntries(selected.map(metric => [metric, 0])) };
}

export function measureBrowserStage(metric, work) {
  const sample = current;
  if (!sample) return work();
  if (!Object.hasOwn(sample.timings, metric)) throw new Error(`Unexpected browser stage: ${metric}`);
  const startedAt = performance.now();
  try { return work(); }
  finally {
    sample.timings[metric] += performance.now() - startedAt;
    sample.calls[metric]++;
  }
}

export function finishBrowserSample(elapsedMs) {
  const state = current;
  current = undefined;
  if (!state) throw new Error('Missing browser stage observation.');
  const { mode, ...sample } = state;
  const selected = mode === 'locale-add' ? localeMetrics : metrics;
  if (selected.some(metric => !sample.calls[metric])) throw new Error('Missing browser stage observation.');
  if (mode === 'locale-add') {
    const residual = value => {
      if (!Number.isFinite(value) || value < -0.00001) throw new Error('Nested browser stages exceed their window.');
      return Math.max(0, value);
    };
    sample.timings.snapshotOtherMs = residual(sample.timings.snapshotMs - sample.timings.translatorMs - sample.timings.signatureMs);
    sample.timings.selectionOtherMs = residual(elapsedMs - sample.timings.decodeMs - sample.timings.freezeMs - sample.timings.snapshotMs);
  }
  return sample;
}
