import assert from 'node:assert/strict';
import test from 'node:test';
import { browserMetrics, localeBrowserMetrics, validateLocaleBrowserStages } from './browser-profile.mjs';
import { beginBrowserSample, finishBrowserSample, measureBrowserStage } from './browser-probe.mjs';

test('full selection measures decode without patch and ends before reset work', () => {
  beginBrowserSample('locale-add');
  measureBrowserStage('decodeMs', () => 'decoded');
  measureBrowserStage('freezeMs', () => 'frozen');
  measureBrowserStage('snapshotMs', () => {
    measureBrowserStage('translatorMs', () => 'translator');
    measureBrowserStage('signatureMs', () => 'signature');
  });
  const sample = finishBrowserSample(1000);
  validateLocaleBrowserStages(sample, 1000);
  assert.deepEqual(Object.keys(sample.calls), localeBrowserMetrics);
  assert.ok(!('patchMs' in sample.calls));
  assert.equal(measureBrowserStage('freezeMs', () => 'reset'), 'reset');
  assert.equal(sample.calls.freezeMs, 1);
});

test('edit requirements remain patch-specific and missing full decode cannot report success', () => {
  beginBrowserSample();
  for (const metric of browserMetrics) measureBrowserStage(metric, () => {});
  assert.deepEqual(Object.keys(finishBrowserSample().calls), browserMetrics);
  beginBrowserSample('locale-add');
  assert.throws(() => beginBrowserSample(), /overlapping/);
  for (const metric of localeBrowserMetrics.filter(name => name !== 'decodeMs')) measureBrowserStage(metric, () => {});
  assert.throws(() => finishBrowserSample(1000), /Missing browser stage/);
});

test('selection acknowledgements reject missing calls, nonfinite timings and overlapping residuals', () => {
  const valid = { timings: { decodeMs: 10, freezeMs: 20, snapshotMs: 30, translatorMs: 12, signatureMs: 8,
    snapshotOtherMs: 10, selectionOtherMs: 40 }, calls: Object.fromEntries(localeBrowserMetrics.map(name => [name, 1])) };
  validateLocaleBrowserStages(valid, 100);
  const copy = () => structuredClone(valid);
  const missing = copy(); missing.calls.decodeMs = 0;
  assert.throws(() => validateLocaleBrowserStages(missing, 100));
  const invalid = copy(); invalid.timings.freezeMs = Infinity;
  assert.throws(() => validateLocaleBrowserStages(invalid, 100));
  const nested = copy(); nested.timings.translatorMs = 40;
  assert.throws(() => validateLocaleBrowserStages(nested, 100));
  const residual = copy(); residual.timings.selectionOtherMs = 60;
  assert.throws(() => validateLocaleBrowserStages(residual, 100));
  assert.throws(() => validateLocaleBrowserStages(valid, 50));
});
