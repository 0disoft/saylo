import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonSources } from './comparison-policy.mjs';

test('snapshot policy accepts the exact experiment while rejecting unrelated source, API and package changes', () => {
  const catalog = 'packages/core/src/catalog.ts', diagnostics = 'packages/core/src/diagnostics.ts';
  assert.deepEqual(comparisonSources('ast-seal', [diagnostics], [diagnostics]), [diagnostics]);
  assert.deepEqual(comparisonSources('owned-map', [catalog, diagnostics, 'packages/core/test/catalog.test.mjs'], []), [catalog, diagnostics]);
  assert.deepEqual(comparisonSources('owned-map', [catalog, diagnostics], [catalog, diagnostics]), [catalog, diagnostics]);
  const schema = 'packages/core/src/schema.ts';
  assert.deepEqual(comparisonSources('plain-contracts', [schema, 'packages/core/test/catalog.test.mjs'], []), [schema]);
  const live = 'packages/vite/src/live-registry.ts';
  assert.deepEqual(comparisonSources('fast-edits', [live, 'packages/vite/test/plugin.test.mjs'], []), [live]);
  assert.deepEqual(comparisonSources('fast-edits', [live], [live]), [live]);
  const index = 'packages/vite/src/index.ts';
  const rechecks = 'packages/vite/src/disk-rechecks.ts';
  assert.deepEqual(comparisonSources('early-rechecks', [rechecks, 'packages/vite/test/disk-rechecks.test.mjs',
    'packages/vite/package.json'], []), [rechecks]);
  assert.throws(() => comparisonSources('early-rechecks', [rechecks, live], []));
  assert.throws(() => comparisonSources('early-rechecks', [rechecks], [live]));
  assert.deepEqual(comparisonSources('fast-additions', [index, live, 'packages/vite/test/plugin.test.mjs'], []), [index, live]);
  assert.deepEqual(comparisonSources('fast-additions', [index, live], [index, live]), [index, live]);
  assert.throws(() => comparisonSources('fast-additions', [index], []));
  assert.throws(() => comparisonSources('fast-additions', [index, live, catalog], []));
  assert.throws(() => comparisonSources('fast-additions', [index, live], ['packages/vite/src/types.ts']));
  for (const file of ['packages/core/src/index.ts', 'packages/core/package.json', 'packages/vite/src/index.ts']) {
    assert.throws(() => comparisonSources('owned-map', [catalog, diagnostics, file], []));
    assert.throws(() => comparisonSources('owned-map', [catalog, diagnostics], [file]));
    assert.throws(() => comparisonSources('plain-contracts', [schema, file], []));
    assert.throws(() => comparisonSources('plain-contracts', [schema], [file]));
    assert.throws(() => comparisonSources('fast-edits', [live, file], []));
    assert.throws(() => comparisonSources('fast-edits', [live], [file]));
  }
  assert.throws(() => comparisonSources('ast-seal', [catalog, diagnostics], []));
  assert.throws(() => comparisonSources('owned-map', [diagnostics], []));
  assert.throws(() => comparisonSources('unrestricted', [catalog, diagnostics], []));
  assert.throws(() => comparisonSources('plain-contracts', [catalog], []));
  assert.throws(() => comparisonSources('fast-edits', [schema], []));
});
