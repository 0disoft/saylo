import assert from 'node:assert/strict';

/** Sample counts locate hot stacks; timestamp gaps are not exact CPU time. */
export function summarizeParserCpu(profile) {
  assert.equal(profile.samples.length, profile.timeDeltas.length);
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  assert.equal(nodes.size, profile.nodes.length);
  const parents = new Map();
  for (const node of nodes.values()) for (const child of node.children ?? []) {
    assert.ok(nodes.has(child));
    assert.ok(!parents.has(child), 'CPU profile must be a tree.');
    parents.set(child, node.id);
  }
  const frameKey = frame => `${frame.url}:${frame.lineNumber + 1}:${frame.columnNumber + 1}:${frame.functionName || '(anonymous)'}`;
  const frames = new Map();
  const buckets = { parserStack: { samples: 0 }, coreWithoutParserStack: { samples: 0 }, gc: { samples: 0 },
    idleProgram: { samples: 0 }, outsideOrUnattributed: { samples: 0 } };
  const eligibleNodes = new Set();
  for (let index = 0; index < profile.samples.length; index++) {
    assert.ok(Number.isFinite(profile.timeDeltas[index]));
    const leaf = nodes.get(profile.samples[index]);
    assert.ok(leaf, 'Unknown CPU sample node.');
    const stack = [];
    const visited = new Set();
    for (let node = leaf; node; node = nodes.get(parents.get(node.id))) {
      assert.ok(!visited.has(node.id), 'CPU profile contains a cycle.');
      visited.add(node.id);
      stack.push(node);
    }
    const parserIndex = stack.findIndex(node => node.callFrame.functionName === 'parseCatalog' &&
      node.callFrame.url.replaceAll('\\', '/').endsWith('/packages/core/dist/catalog.js'));
    const coreIndex = stack.findLastIndex(node => /\/packages\/core\/dist\//.test(node.callFrame.url.replaceAll('\\', '/')));
    const kind = leaf.callFrame.functionName === '(garbage collector)' ? 'gc' :
      ['(idle)', '(program)'].includes(leaf.callFrame.functionName) ? 'idleProgram' :
      parserIndex >= 0 ? 'parserStack' : coreIndex >= 0 ? 'coreWithoutParserStack' : 'outsideOrUnattributed';
    buckets[kind].samples++;
    if (!['parserStack', 'coreWithoutParserStack'].includes(kind)) continue;
    const seenFrames = new Set();
    for (const node of stack.slice(0, (parserIndex >= 0 ? parserIndex : coreIndex) + 1)) {
      eligibleNodes.add(node.id);
      const key = frameKey(node.callFrame);
      if (seenFrames.has(key)) continue; // Recursive frames count once inclusively.
      seenFrames.add(key);
      const row = frames.get(key) ?? { ...node.callFrame, selfSamples: 0, inclusiveSamples: 0 };
      row.inclusiveSamples++;
      if (node === leaf) row.selfSamples++;
      frames.set(key, row);
    }
  }
  const ticksByFrame = new Map();
  for (const id of eligibleNodes) {
    const node = nodes.get(id);
    const key = frameKey(node.callFrame);
    const ticks = ticksByFrame.get(key) ?? new Map();
    for (const { line, ticks: count } of node.positionTicks ?? []) ticks.set(line, (ticks.get(line) ?? 0) + count);
    ticksByFrame.set(key, ticks);
  }
  const attributedSamples = buckets.parserStack.samples + buckets.coreWithoutParserStack.samples;
  const rows = [...frames.values()].map(row => ({ ...row,
    attributedSelfPercent: attributedSamples ? row.selfSamples / attributedSamples * 100 : 0,
    attributedInclusivePercent: attributedSamples ? row.inclusiveSamples / attributedSamples * 100 : 0,
    lineTicks: [...(ticksByFrame.get(frameKey(row)) ?? [])].map(([line, ticks]) => ({ line, ticks })).sort((a, b) => b.ticks - a.ticks) }));
  assert.equal(rows.reduce((sum, row) => sum + row.selfSamples, 0), attributedSamples);
  return { samples: profile.samples.length, buckets,
    timeDeltas: { negativeSamples: profile.timeDeltas.filter(value => value < 0).length,
      minUs: profile.timeDeltas.length ? Math.min(...profile.timeDeltas) : null,
      maxUs: profile.timeDeltas.length ? Math.max(...profile.timeDeltas) : null,
      signedSumUs: profile.timeDeltas.reduce((sum, value) => sum + value, 0) },
    attributedSamples, frames: rows.toSorted((a, b) => b.selfSamples - a.selfSamples || b.inclusiveSamples - a.inclusiveSamples) };
}
