import { Session } from 'node:inspector';
import { performance } from 'node:perf_hooks';
import { LiveRegistry } from '../../packages/vite/dist/live-registry.js';
import { CatalogRegistry } from '../../packages/vite/dist/catalog-registry.js';
import { beginFileSample, finishFileSample } from './server-file-profile.mjs';

// Benchmark-only wrappers: the library ships no clocks or profiling API.
export function createStageProbe() {
  let current;
  const restores = [];
  function wrap(prototype, name, observe) {
    const original = prototype[name];
    const instrumented = function (...args) { return observe.call(this, original, args); };
    prototype[name] = instrumented;
    restores.push(() => { if (prototype[name] === instrumented) prototype[name] = original; });
  }
  wrap(LiveRegistry.prototype, 'enqueue', function (original, args) {
    if (current && this.owns(args[0])) { current.firstEventAt ??= performance.now(); current.fileEvents++; }
    return original.apply(this, args);
  });
  wrap(LiveRegistry.prototype, 'drain', function (original, args) {
    if (current && this.queued.size) {
      current.candidateStartedAt = performance.now();
      current.queueToDrainMs = current.candidateStartedAt - current.firstEventAt;
      current.drains++;
    }
    return original.apply(this, args);
  });
  wrap(LiveRegistry.prototype, 'prepareTranslations', function (original, args) {
    const sample = current;
    const start = performance.now();
    if (sample?.candidateStartedAt !== undefined) {
      sample.readAndCandidateMs += start - sample.candidateStartedAt;
      sample.candidateStartedAt = undefined;
    }
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
    begin() { beginFileSample(); current = { readAndCandidateMs: 0, translationPreparationMs: 0, validationMs: 0, registryReplaceMs: 0, catalogDeltaMs: 0, fileEvents: 0, drains: 0 }; },
    finish() {
      if (!current || !Number.isFinite(current.queueToDrainMs) || !current.drains) throw new Error('Missing server stage sample.');
      const { firstEventAt, candidateStartedAt, ...result } = current;
      const fileStages = finishFileSample(current.readAndCandidateMs);
      if (fileStages) result.fileStages = fileStages;
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
