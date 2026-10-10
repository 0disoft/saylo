import assert from 'node:assert/strict';
import { test } from 'node:test';
import { union, intersect, remainder, observeWindows, runtimeMetrics } from './runtime-profile.mjs';

test('runtime windows clip boundaries and count overlapping events without double-counting duration', () => {
  const windows = Object.fromEntries(runtimeMetrics.map(metric => [metric, [[10, 20], [30, 40]]]));
  const gc = [{ startMs: 5, endMs: 12 }, { startMs: 11, endMs: 18 }, { startMs: 22, endMs: 28 }, { startMs: 39, endMs: 42 }];
  const ticks = [{ expectedMs: 15, observedMs: 35 }, { expectedMs: 19, observedMs: 21 }];
  assert.deepEqual(observeWindows(windows, gc, ticks).sample, {
    wallMs: 20, gcEvents: 3, gcOverlapMs: 9, timerDelayOverlapMs: 10, maxTimerLatenessMs: 20, lateTicks: 2,
  });
  assert.deepEqual(intersect([[10, 20]], [[0, 10], [20, 30]]), []);
});

test('candidate residual preserves gaps and merges intersecting file windows', () => {
  assert.deepEqual(remainder([[0, 100]], [[5, 10], [9, 20], [40, 60], [90, 110]]), [[0, 5], [20, 40], [60, 90]]);
  assert.deepEqual(union([[2, 4], [1, 3], [4, 5]]), [[1, 5]]);
  assert.throws(() => union([[10, 5]]), /Invalid/);
  const empty = Object.fromEntries(runtimeMetrics.map(metric => [metric, []]));
  assert.equal(observeWindows(empty, [], []).fileReadMs.gcOverlapMs, 0);
});
