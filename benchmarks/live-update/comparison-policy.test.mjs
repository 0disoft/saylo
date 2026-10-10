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
  for (const file of ['packages/core/src/index.ts', 'packages/core/package.json', 'packages/vite/src/index.ts']) {
    assert.throws(() => comparisonSources('owned-map', [catalog, diagnostics, file], []));
    assert.throws(() => comparisonSources('owned-map', [catalog, diagnostics], [file]));
    assert.throws(() => comparisonSources('plain-contracts', [schema, file], []));
    assert.throws(() => comparisonSources('plain-contracts', [schema], [file]));
  }
  assert.throws(() => comparisonSources('ast-seal', [catalog, diagnostics], []));
  assert.throws(() => comparisonSources('owned-map', [diagnostics], []));
  assert.throws(() => comparisonSources('unrestricted', [catalog, diagnostics], []));
  assert.throws(() => comparisonSources('plain-contracts', [catalog], []));
});
