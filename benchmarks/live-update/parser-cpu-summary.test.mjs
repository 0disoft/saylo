import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeParserCpu } from './parser-cpu-summary.mjs';

test('CPU summary isolates parser stacks and partitions GC, idle and outside samples', () => {
  const node = (id, functionName, children = [], url = '') => ({ id, callFrame: { functionName, url, lineNumber: 0, columnNumber: 0 }, children });
  const profile = { nodes: [node(1, '(root)', [2, 6, 7, 8, 9]),
    node(2, 'parseCatalog', [3, 4], 'file:///repo/packages/core/dist/catalog.js'),
    node(3, 'readJson', [], 'file:///repo/packages/core/dist/json.js'),
    node(4, 'freeze', [5], 'file:///repo/packages/core/dist/diagnostics.js'),
    node(5, 'freeze', [], 'file:///repo/packages/core/dist/diagnostics.js'),
    node(6, '(garbage collector)'), node(7, '(idle)'), node(8, 'assert'),
    node(9, 'inferArguments', [], 'file:///repo/packages/core/dist/schema.js')],
    samples: [3, 5, 2, 6, 7, 8, 9], timeDeltas: [1000, -2000, 3000, 4000, 5000, 6000, 7000] };
  profile.nodes[1].positionTicks = [{ line: 20, ticks: 1 }];
  const result = summarizeParserCpu(profile);
  assert.deepEqual(result.timeDeltas, { negativeSamples: 1, minUs: -2000, maxUs: 7000, signedSumUs: 24000 });
  assert.deepEqual(result.buckets, { parserStack: { samples: 3 }, coreWithoutParserStack: { samples: 1 }, gc: { samples: 1 },
    idleProgram: { samples: 1 }, outsideOrUnattributed: { samples: 1 } });
  const parser = result.frames.find(row => row.functionName === 'parseCatalog');
  assert.equal(parser.selfSamples, 1); assert.equal(parser.inclusiveSamples, 3);
  assert.deepEqual(parser.lineTicks, [{ line: 20, ticks: 1 }]);
  assert.equal(parser.attributedInclusivePercent, 75, 'Do not synthesize missing parser callers.');
  const recursive = result.frames.filter(row => row.functionName === 'freeze');
  assert.equal(recursive.length, 1); assert.equal(recursive[0].inclusiveSamples, 1);
  assert.equal(result.frames.reduce((sum, row) => sum + row.attributedSelfPercent, 0), 100);
  assert.ok(result.frames.every(row => !['(root)', 'assert', '(garbage collector)', '(idle)'].includes(row.functionName)));
  assert.throws(() => summarizeParserCpu({ ...profile, timeDeltas: [] }));
  assert.throws(() => summarizeParserCpu({ ...profile, samples: [999], timeDeltas: [1000] }));
});
