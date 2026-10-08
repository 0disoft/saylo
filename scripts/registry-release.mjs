import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { packageIds, repository } from './release-check.mjs';

export async function approvedRegistryRelease(version) {
  assert.match(version ?? '', /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/, 'Supply --registry-version for an approved release.');
  const packs = JSON.parse(await readFile(path.join(repository, 'releases', `${version}.json`), 'utf8'));
  assert.ok(Array.isArray(packs) && packs.length > 0, 'Approved release must contain packages.');
  const names = new Set();
  for (const pack of packs) {
    assert.ok(packageIds.some(id => pack.name === `@0disoft/saylo-${id}`), 'Unknown approved package.');
    assert.ok(!names.has(pack.name), 'Duplicate approved package.');
    names.add(pack.name);
    assert.equal(pack.version, version);
    assert.match(pack.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/, 'Invalid approved integrity.');
  }
  return packs;
}

export function verifyRegistryVersion(pack, metadata) {
  // Historical artifacts stay valid when a newer release moves the alpha tag.
  const version = metadata.versions?.[pack.version];
  assert.ok(version, `${pack.name}: approved version missing`);
  assert.equal(version.version, pack.version);
  assert.equal(version.dist?.integrity, pack.integrity, `${pack.name}: published bytes differ from approved artifact`);
  return version;
}
