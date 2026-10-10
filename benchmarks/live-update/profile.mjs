import { Session } from 'node:inspector';
import { performance } from 'node:perf_hooks';
import { AsyncLocalStorage } from 'node:async_hooks';
import { LiveRegistry } from '../../packages/vite/dist/live-registry.js';
import { CatalogRegistry } from '../../packages/vite/dist/catalog-registry.js';
import { DiskRechecks } from '../../packages/vite/dist/disk-rechecks.js';
import { beginFileSample, finishFileSample } from './server-file-profile.mjs';
import { beginRuntimeSample, startRuntimeWindow, endRuntimeWindow, finishRuntimeSample, union } from './runtime-profile.mjs';

// Benchmark-only wrappers: the library ships no clocks or profiling API.
export function createStageProbe() {
  let current;
  const context = new AsyncLocalStorage();
  const enqueueOrigin = new AsyncLocalStorage();
  const finishCandidate = batch => {
    if (!batch || batch.end !== undefined) return;
    batch.end = performance.now();
    endRuntimeWindow(batch.runtimeWindow, batch.end);
  };
  const restores = [];
  function wrap(prototype, name, observe) {
    const original = prototype[name];
    const instrumented = function (...args) { return observe.call(this, original, args); };
    prototype[name] = instrumented;
    restores.push(() => { if (prototype[name] === instrumented) prototype[name] = original; });
  }
  wrap(DiskRechecks.prototype, 'verify', function (original, args) {
    return enqueueOrigin.run('disk-recheck', () => original.apply(this, args));
  });
  wrap(LiveRegistry.prototype, 'enqueue', function (original, args) {
    if (current && this.owns(args[0])) {
      const now = performance.now();
      current.firstEventAt ??= now; current.queuedAt ??= now; current.fileEvents++;
      // An external call need not be an OS watcher event (tests inject readers).
      current.enqueueEvents.push({ offsetMs: now - current.startedAt,
        origin: enqueueOrigin.getStore() ?? 'external-enqueue', hasReader: typeof args[1] === 'function' });
    }
    return original.apply(this, args);
  });
  wrap(LiveRegistry.prototype, 'drain', function (original, args) {
    if (!current || !this.queued.size) return original.apply(this, args);
    const runtimeWindow = startRuntimeWindow('readAndCandidateMs');
    const batch = { start: runtimeWindow?.start ?? performance.now(), runtimeWindow };
    current.batches.push(batch);
    const wait = batch.start - (current.queuedAt ?? current.firstEventAt);
    current.queueToDrainMs ??= wait;
    current.drainWaitMs.push(wait);
    current.queuedAt = undefined;
    current.drains++;
    const result = context.run(batch, () => original.apply(this, args));
    // Superseded/error batches may never reach prepareTranslations.
    void this.running.then(() => finishCandidate(batch), () => finishCandidate(batch));
    return result;
  });
  wrap(LiveRegistry.prototype, 'prepareTranslations', function (original, args) {
    const sample = current;
    const start = performance.now();
    finishCandidate(context.getStore());
    try { return original.apply(this, args); }
    finally { if (sample) sample.translationPreparationMs += performance.now() - start; }
  });
  wrap(LiveRegistry.prototype, 'validate', function (original, args) {
    const sample = current;
    const start = performance.now();
    try { return original.apply(this, args); }
    finally { if (sample) sample.validationMs += performance.now() - start; }
  });
  for (const [method, metric] of [['replace', 'registryReplaceMs'], ['loadDelta', 'catalogDeltaMs']]) {
    wrap(CatalogRegistry.prototype, method, function (original, args) {
      const sample = current;
      const start = performance.now();
      try { return original.apply(this, args); }
      finally { if (sample) sample[metric] += performance.now() - start; }
    });
  }
  return {
    begin() {
      if (current) throw new Error('Overlapping server stage samples.');
      current = { startedAt: beginFileSample(), batches: [], drainWaitMs: [], enqueueEvents: [], runtimeWindow: beginRuntimeSample(),
        translationPreparationMs: 0, validationMs: 0, registryReplaceMs: 0, catalogDeltaMs: 0, fileEvents: 0, drains: 0 };
    },
    finish() {
      if (!current || !Number.isFinite(current.queueToDrainMs) || !current.drains) throw new Error('Missing server stage sample.');
      if (current.batches.some(batch => batch.end === undefined)) throw new Error('Unfinished drain at acknowledgement.');
      const { firstEventAt, queuedAt, startedAt, batches, runtimeWindow, ...result } = current;
      result.candidateIntervals = batches.map(batch => [batch.start - startedAt, batch.end - startedAt]);
      result.readAndCandidateMs = union(result.candidateIntervals).reduce((total, [a, b]) => total + b - a, 0);
      result.boundaryVersion = 2;
      let fileStages;
      try { fileStages = finishFileSample(result.candidateIntervals); }
      catch (error) { error.message += ` Server stages: ${JSON.stringify(result)}`; throw error; }
      if (fileStages) result.fileStages = fileStages;
      const runtimeWindows = finishRuntimeSample(runtimeWindow);
      if (runtimeWindows) result.runtimeWindows = runtimeWindows;
      current = undefined;
      return result;
    },
    dispose() { current = undefined; for (const restore of restores.reverse()) restore(); },
  };
}

export function createCpuProbe(enabled) {
  let session;
  const post = (method, params = {}) => new Promise((resolve, reject) => {
    session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
  });
  return {
    async start() {
      if (!enabled || session) return;
      session = new Session(); session.connect();
      await post('Profiler.enable');
      await post('Profiler.setSamplingInterval', { interval: 1000 });
      await post('Profiler.start');
    },
    async finish() {
      if (!session) return;
      const { profile } = await post('Profiler.stop');
      session.disconnect(); session = undefined;
      return summarizeCpu(profile);
    },
    dispose() { session?.disconnect(); session = undefined; },
  };
}

function summarizeCpu(profile) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parents = new Map(profile.nodes.flatMap(node => (node.children ?? []).map(id => [id, node.id])));
  const frames = new Map();
  let totalUs = 0, idleUs = 0;
  const label = node => `${node.callFrame.url.replaceAll('\\', '/').split('/saylo/').at(-1)}:${node.callFrame.lineNumber + 1}:${node.callFrame.functionName || '(anonymous)'}`;
  for (let index = 0; index < profile.samples.length; index++) {
    const elapsed = profile.timeDeltas[index];
    const leaf = nodes.get(profile.samples[index]);
    totalUs += elapsed;
    if (['(idle)', '(program)'].includes(leaf.callFrame.functionName)) { idleUs += elapsed; continue; }
    const visited = new Set();
    for (let node = leaf; node; node = nodes.get(parents.get(node.id))) {
      const key = label(node);
      if (visited.has(key)) continue;
      visited.add(key);
      const frame = frames.get(key) ?? { frame: key, selfUs: 0, inclusiveUs: 0 };
      frame.inclusiveUs += elapsed;
      if (node === leaf) frame.selfUs += elapsed;
      frames.set(key, frame);
    }
  }
  const rows = [...frames.values()].map(({ frame, selfUs, inclusiveUs }) => ({ frame,
    selfMs: selfUs / 1000, inclusiveMs: inclusiveUs / 1000,
    busySelfPercent: selfUs / (totalUs - idleUs) * 100 }));
  return { scope: 'Node measured edit loop only; excludes startup, calibration and warmup; includes fixture preparation, HTTP and waits; not browser CPU.',
    sampledMs: totalUs / 1000, idleMs: idleUs / 1000, busyMs: (totalUs - idleUs) / 1000,
    topSelf: rows.toSorted((a, b) => b.selfMs - a.selfMs).slice(0, 20),
    sayloInclusive: rows.filter(row => /packages\/(core|vite|typegen)\/dist\//.test(row.frame))
      .toSorted((a, b) => b.inclusiveMs - a.inclusiveMs).slice(0, 20) };
}
