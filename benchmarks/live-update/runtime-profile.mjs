import { performance, PerformanceObserver } from 'node:perf_hooks';
import { registerHooks } from 'node:module';
import { setImmediate as immediate, setTimeout as delay } from 'node:timers/promises';
import { summarize } from './statistics.mjs';

export const runtimeMetrics = ['sample', 'readAndCandidateMs', 'pathCheckMs', 'fileReadMs', 'catalogParseMs', 'baseStatMs', 'candidateOtherMs'];
const tickMs = 10;
let active = false, current;

export function union(intervals) {
  const result = [];
  for (const [start, end] of intervals.toSorted((a, b) => a[0] - b[0])) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) throw new Error('Invalid runtime interval.');
    if (start === end) continue;
    const previous = result.at(-1);
    if (previous && previous[1] >= start) previous[1] = Math.max(previous[1], end);
    else result.push([start, end]);
  }
  return result;
}

export function intersect(left, right) {
  return union(left.flatMap(([a, b]) => right.map(([c, d]) => [Math.max(a, c), Math.min(b, d)]).filter(([a, b]) => b > a)));
}

export function remainder(parents, children) {
  const result = [];
  for (const [start, end] of union(parents)) {
    let cursor = start;
    for (const [a, b] of intersect([[start, end]], union(children))) {
      if (a > cursor) result.push([cursor, a]);
      cursor = b;
    }
    if (cursor < end) result.push([cursor, end]);
  }
  return result;
}

const duration = intervals => union(intervals).reduce((sum, [a, b]) => sum + b - a, 0);
export function observeWindows(windows, gc, ticks) {
  return Object.fromEntries(runtimeMetrics.map(metric => {
    const region = windows[metric];
    const events = gc.filter(event => intersect(region, [[event.startMs, event.endMs]]).length);
    const late = ticks.filter(tick => intersect(region, [[tick.expectedMs, tick.observedMs]]).length);
    return [metric, { wallMs: duration(region), gcEvents: events.length,
      gcOverlapMs: duration(intersect(region, events.map(event => [event.startMs, event.endMs]))),
      timerDelayOverlapMs: duration(intersect(region, late.map(tick => [tick.expectedMs, tick.observedMs]))),
      maxTimerLatenessMs: Math.max(0, ...late.map(tick => tick.observedMs - tick.expectedMs)), lateTicks: late.length }];
  }));
}

export function beginRuntimeSample() {
  if (active) current = Object.fromEntries(runtimeMetrics.map(metric => [metric, []]));
  return startRuntimeWindow('sample');
}
export function startRuntimeWindow(metric) {
  if (!current) return;
  return { windows: current, metric, start: performance.now() };
}
export function endRuntimeWindow(window, end) {
  if (window) window.windows[window.metric].push([window.start, end ?? performance.now()]);
}
export function finishRuntimeSample(window) {
  if (!current) return;
  endRuntimeWindow(window);
  const windows = current; current = undefined;
  // baseStat is a child of the old candidateOther residual, not another additive parent.
  windows.candidateOtherMs = remainder(windows.readAndCandidateMs,
    ['pathCheckMs', 'fileReadMs', 'catalogParseMs'].flatMap(metric => windows[metric]));
  return windows;
}
export async function measureRuntimeAsync(metric, work) {
  const window = startRuntimeWindow(metric);
  try { return await work(); } finally { endRuntimeWindow(window); }
}

export function registerRuntimeProbe(enabled) {
  active = enabled;
  if (!enabled) return { start() {}, async finish() {}, dispose() {} };
  let observer, timer, hooks, started = false, transformed = false;
  let gc = [], ticks = [];
  const capture = entries => { for (const entry of entries) gc.push({ startMs: entry.startTime,
    endMs: entry.startTime + entry.duration, kind: entry.detail.kind, flags: entry.detail.flags }); };
  const schedule = () => {
    const expectedMs = performance.now() + tickMs;
    timer = setTimeout(() => { ticks.push({ expectedMs, observedMs: performance.now() }); schedule(); }, tickMs);
    timer.unref();
  };
  const target = new URL('../../packages/vite/dist/live-registry.js', import.meta.url).href;
  hooks = registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== target) return loaded;
    let source = String(loaded.source);
    const boundary = /const existing = await (this\.bounded\('Base catalog existence check',[\s\S]*?\}, \{ signal \}\)\));/g;
    if ([...source.matchAll(boundary)].length !== 1) throw new Error('Missing or ambiguous base-stat probe boundary.');
    source = source.replace(boundary, (_, work) => `const existing = await measureRuntimeAsync('baseStatMs', () => ${work});`);
    transformed = true;
    return { ...loaded, source: `import { measureRuntimeAsync } from '${import.meta.url}';\n${source}` };
  } });
  return {
    start() {
      if (started) return;
      if (!transformed) throw new Error('Base-stat module was not instrumented.');
      if (!PerformanceObserver.supportedEntryTypes.includes('gc')) throw new Error('GC observation unavailable.');
      started = true;
      gc = []; ticks = [];
      observer = new PerformanceObserver(list => capture(list.getEntries()));
      observer.observe({ entryTypes: ['gc'] }); schedule();
    },
    async finish(samples) {
      // Entry delivery is asynchronous. Yield after the final ack, outside all saved windows.
      await delay(tickMs); await immediate(); await immediate();
      capture(observer.takeRecords()); observer.disconnect(); clearTimeout(timer); started = false;
      for (const sample of samples) {
        const windows = sample.serverStages.runtimeWindows;
        if (!windows || runtimeMetrics.some(metric => !windows[metric].length)) throw new Error('Incomplete runtime windows.');
        sample.serverStages.runtime = observeWindows(windows, gc, ticks);
      }
      const measured = samples.filter(sample => !sample.warmup);
      return { scope: 'Node diagnostic only. sample covers stage begin before write to stage finish after ack receipt; locale ends at list ack, excludes selection/reset/removal. Timestamp intersections, not causal attribution or CPU time. candidateOther contains baseStat. GC and late-timer intervals can overlap; never subtract/add them or nested stage quantiles. Timer lateness includes synchronous JS, GC, I/O callback work and OS scheduling. Asynchronous GC delivery flushed after final ack; not a stop-the-world trace.',
        tickMs, gc, ticks,
        stages: Object.fromEntries(runtimeMetrics.map(metric => [metric, Object.fromEntries(
          ['wallMs', 'gcOverlapMs', 'timerDelayOverlapMs', 'maxTimerLatenessMs'].map(key =>
            [key, summarize(measured.map(sample => sample.serverStages.runtime[metric][key]))]))])) };
    },
    stop() { observer?.disconnect(); clearTimeout(timer); started = false; },
    dispose() { active = false; current = undefined; observer?.disconnect(); clearTimeout(timer); hooks?.deregister(); },
  };
}
