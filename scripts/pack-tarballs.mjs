import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { packageIds } from './release-check.mjs';

// Consume the exact validated bytes instead of creating a second pack from source.
export async function copyVerifiedTarballs(directory, destination) {
  const packs = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.ok(Array.isArray(packs), 'Tarball manifest must be an array.');
  assert.deepEqual(packs.map(pack => pack.name).sort(), packageIds.map(id => `@0disoft/saylo-${id}`).sort(),
    'Tarball manifest must contain exactly the five public packages.');
  const version = packs[0].version;
  assert.match(version, /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/, 'Invalid tarball version.');
  const verified = [];
  for (const pack of packs) {
    assert.equal(pack.version, version, 'Tarballs must share one version.');
    const filename = `${pack.name.slice(1).replace('/', '-')}-${version}.tgz`;
    assert.equal(pack.filename, filename, 'Unexpected tarball filename.');
    const file = path.join(directory, filename);
    assert.ok((await lstat(file)).isFile(), `${filename}: expected a regular tarball file.`);
    const bytes = await readFile(file);
    assert.equal(pack.integrity, `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      `${filename}: tarball integrity differs from manifest.`);
    verified.push({ filename, bytes });
  }
  // Do not copy a partial set if a later artifact fails verification.
  for (const { filename, bytes } of verified) await writeFile(path.join(destination, filename), bytes, { flag: 'wx' });
  return packs;
}
