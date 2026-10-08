import assert from 'node:assert/strict';
import test from 'node:test';
import { approvedRegistryRelease, verifyRegistryVersion } from '../registry-release.mjs';

test('historical registry verification follows approved bytes after alpha moves', async () => {
  const packs = await approvedRegistryRelease('0.1.0-alpha.1');
  assert.equal(packs.length, 4);
  assert.ok(packs.every(pack => pack.name !== '@0disoft/saylo-svelte'));
  const pack = packs[0];
  const published = { version: pack.version, dist: { integrity: pack.integrity } };
  const metadata = { 'dist-tags': { alpha: '0.1.0-alpha.2' }, versions: { [pack.version]: published } };
  assert.equal(verifyRegistryVersion(pack, metadata), published);
  assert.throws(() => verifyRegistryVersion(pack, { versions: {} }), /approved version missing/);
  assert.throws(() => verifyRegistryVersion(pack, { versions: {
    [pack.version]: { version: pack.version, dist: { integrity: 'sha512-tampered' } },
  } }), /published bytes differ/);
});

test('registry release selectors reject traversal and unpublished versions', async () => {
  await assert.rejects(approvedRegistryRelease('../package'), /registry-version/);
  await assert.rejects(approvedRegistryRelease('999.999.999-alpha.0'), /ENOENT/);
});
