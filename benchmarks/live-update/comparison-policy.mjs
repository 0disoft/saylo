import assert from 'node:assert/strict';

const policies = {
  'snapshot-copy': { sources: ['packages/core/src/diagnostics.ts'], tests: ['packages/core/test/catalog.test.mjs'] },
  'ast-seal': { sources: ['packages/core/src/diagnostics.ts'], tests: [] },
  'owned-map': { sources: ['packages/core/src/catalog.ts', 'packages/core/src/diagnostics.ts'],
    tests: ['packages/core/test/catalog.test.mjs'] },
  'plain-contracts': { sources: ['packages/core/src/schema.ts'], tests: ['packages/core/test/catalog.test.mjs'] },
  'fast-edits': { sources: ['packages/vite/src/live-registry.ts'], tests: ['packages/vite/test/plugin.test.mjs'] },
  'fast-additions': { sources: ['packages/vite/src/index.ts', 'packages/vite/src/live-registry.ts'],
    tests: ['packages/vite/test/plugin.test.mjs'] },
  'early-rechecks': { sources: ['packages/vite/src/disk-rechecks.ts'],
    tests: ['packages/vite/test/disk-rechecks.test.mjs', 'packages/vite/package.json'] },
};

/** Only selected sources are replaced in copied snapshots. Reject other changes. */
export function comparisonSources(experiment, changed, checkoutChanges) {
  const policy = policies[experiment];
  assert.ok(policy, `Unknown comparison experiment: ${experiment}`);
  const allowed = [...policy.sources, ...policy.tests];
  assert.ok(policy.sources.every(file => changed.includes(file)), 'Missing experiment source changes.');
  assert.ok(changed.every(file => allowed.includes(file)), 'Unexpected product changes in comparison revisions.');
  assert.ok(checkoutChanges.every(file => policy.sources.includes(file)), 'Common checkout product files differ from selected revisions.');
  return [...policy.sources];
}

export const editMetrics = ['saveToAckMs', 'saveToManifestBroadcastMs', 'receiveToCommitMs', 'commitToAckDispatchMs', 'fileWriteMs'];
