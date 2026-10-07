import { constants, PerformanceObserver } from 'node:perf_hooks';

const kinds = new Map([
  [constants.NODE_PERFORMANCE_GC_MINOR, 'minor'], [constants.NODE_PERFORMANCE_GC_MAJOR, 'major'],
  [constants.NODE_PERFORMANCE_GC_INCREMENTAL, 'incremental'], [constants.NODE_PERFORMANCE_GC_WEAKCB, 'weak-callback'],
]);
const tick = () => new Promise(resolve => setImmediate(resolve));

export function observeGc() {
  if (!PerformanceObserver.supportedEntryTypes.includes('gc')) throw new Error('Node GC observation is unavailable.');
  const events = [];
  const accept = entries => {
    for (const entry of entries) {
      if (!Number.isFinite(entry.startTime) || !Number.isFinite(entry.duration) || entry.duration < 0) throw new Error('Invalid GC entry.');
      events.push({ startTimeMs: entry.startTime, durationMs: entry.duration,
        kind: kinds.get(entry.detail.kind) ?? 'unknown', flags: entry.detail.flags });
    }
  };
  const observer = new PerformanceObserver(list => accept(list.getEntries()));
  observer.observe({ entryTypes: ['gc'] });
  return {
    async drain() {
      // Match by event timestamp, not by callback delivery; never force GC.
      await tick(); await tick();
      accept(observer.takeRecords());
      return [...events];
    },
    dispose() { observer.disconnect(); },
  };
}

export function gcInWindow(events, startTimeMs, endTimeMs) {
  if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs) || endTimeMs < startTimeMs) throw new Error('Invalid GC observation window.');
  const overlapping = events.flatMap(event => {
    const overlapMs = Math.min(endTimeMs, event.startTimeMs + event.durationMs) - Math.max(startTimeMs, event.startTimeMs);
    return overlapMs > 0 ? [{ ...event, overlapMs }] : [];
  });
  const intervals = overlapping.map(event => [Math.max(startTimeMs, event.startTimeMs),
    Math.min(endTimeMs, event.startTimeMs + event.durationMs)]).sort((a, b) => a[0] - b[0]);
  let observedOverlapMs = 0, end = startTimeMs;
  for (const [start, stop] of intervals) {
    observedOverlapMs += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  // Overlapping GC entries are counted separately, but their time union is
  // counted only once. Even this union is not a measured stop-the-world pause.
  return { count: overlapping.length, observedOverlapMs, events: overlapping };
}
