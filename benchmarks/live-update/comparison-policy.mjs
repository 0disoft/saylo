import assert from 'node:assert/strict';

const policies = {
  'ast-seal': { sources: ['packages/core/src/diagnostics.ts'], tests: [] },
  'owned-map': { sources: ['packages/core/src/catalog.ts', 'packages/core/src/diagnostics.ts'],
    tests: ['packages/core/test/catalog.test.mjs'] },
  'plain-contracts': { sources: ['packages/core/src/schema.ts'], tests: ['packages/core/test/catalog.test.mjs'] },
};

/** Only selected sources are replaced in copied snapshots. Reject other changes. */
export function comparisonSources(experiment, changed, checkoutChanges) {
  const policy = policies[experiment];
  assert.ok(policy, 'Experiment must be ast-seal, owned-map or plain-contracts.');
  const allowed = [...policy.sources, ...policy.tests];
  assert.ok(policy.sources.every(file => changed.includes(file)), 'Missing experiment source changes.');
  assert.ok(changed.every(file => allowed.includes(file)), 'Unexpected product changes in comparison revisions.');
  assert.ok(checkoutChanges.every(file => policy.sources.includes(file)), 'Common checkout product files differ from selected revisions.');
  return [...policy.sources];
}

export const editMetrics = ['saveToAckMs', 'saveToManifestBroadcastMs', 'receiveToCommitMs', 'commitToAckDispatchMs', 'fileWriteMs'];
