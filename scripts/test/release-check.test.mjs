import assert from 'node:assert/strict';
import test from 'node:test';
import { releaseInput } from '../release-check.mjs';
import { promote } from '../release-candidate-source.mjs';

test('release commands default stable versions to latest and prereleases to alpha', () => {
  assert.deepEqual(releaseInput(['--version', '0.1.0']),
    { version: '0.1.0', tag: 'latest', publish: false });
  assert.deepEqual(releaseInput(['--version', '0.1.0-alpha.9']),
    { version: '0.1.0-alpha.9', tag: 'alpha', publish: false });
  assert.deepEqual(releaseInput(['--version', '0.1.0', '--tag', 'next', '--publish']),
    { version: '0.1.0', tag: 'next', publish: true });
});

test('explicit distribution tags still reject incompatible release versions', () => {
  assert.throws(() => releaseInput(['--version', '0.1.0', '--tag', 'alpha']),
    /Stable releases cannot use alpha/);
  assert.throws(() => releaseInput(['--version', '0.1.0-alpha.9', '--tag', 'latest']),
    /Prereleases cannot use latest/);
});

test('candidate promotion switches default publication channels and preserves private versions', () => {
  const manifest = { version: '0.1.0-alpha.9', publishConfig: { tag: 'alpha', access: 'public' } };
  promote(manifest, '0.1.0');
  assert.deepEqual(manifest.publishConfig, { tag: 'latest', access: 'public' });
  promote(manifest, '0.2.0-alpha.1');
  assert.equal(manifest.publishConfig.tag, 'alpha');
  promote(manifest, '0.2.0', { preserveVersion: true });
  assert.equal(manifest.version, '0.2.0-alpha.1');
  assert.equal(manifest.publishConfig.tag, 'alpha');
});
