import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { packageIds } from './release-check.mjs';

const exec = promisify(execFile);
const owned = new Set(packageIds.map(id => `@0disoft/saylo-${id}`));
export const privateCandidateIds = ['vue'];
export function promote(manifest, version, { preserveVersion = false } = {}) {
  if (!preserveVersion) manifest.version = version;
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) if (owned.has(name)) manifest[field][name] = version;
  }
}

// Verify the snapshot against Git objects, not a descriptor's unverified claim.
// Public versions/dependencies and private workspace internal dependency refs
// may differ. Private versions and publication settings stay unchanged.
export async function inspectCandidateSource(repository, source, commit, version) {
  const { stdout } = await exec('git', ['ls-tree', '-rz', '--full-tree', commit],
    { cwd: repository, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const manifests = new Set(packageIds.map(id => `packages/${id}/package.json`));
  const privateManifests = new Set(privateCandidateIds.map(id => `packages/${id}/package.json`));
  const inputs = [];
  for (const line of stdout.split('\0').filter(Boolean)) {
    const [header, file] = line.split('\t');
    const [mode, type, oid] = header.split(' ');
    assert.equal(type, 'blob', `Unsupported source object: ${file}`);
    assert.ok(['100644', '100755'].includes(mode), `Unsupported file mode: ${file}`);
    const target = path.join(source, file);
    assert.equal(await realpath(target), target, `Candidate input must not follow a symlink: ${file}`);
    const bytes = await readFile(target);
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (manifests.has(file) || privateManifests.has(file) || file === 'package-lock.json') {
      const original = await exec('git', ['show', `${commit}:${file}`], { cwd: repository, windowsHide: true,
        maxBuffer: 4 * 1024 * 1024 });
      const expected = JSON.parse(original.stdout);
      if (manifests.has(file)) promote(expected, version);
      else if (privateManifests.has(file)) {
        assert.equal(expected.private, true, 'The excluded workspace must remain private.');
        promote(expected, version, { preserveVersion: true });
      }
      else {
        for (const id of packageIds) promote(expected.packages[`packages/${id}`], version);
        for (const id of privateCandidateIds) if (expected.packages[`packages/${id}`])
          promote(expected.packages[`packages/${id}`], version, { preserveVersion: true });
      }
      assert.deepEqual(JSON.parse(bytes), expected, `Unexpected candidate metadata edits: ${file}`);
    } else assert.equal(blob, oid, `Candidate source differs from frozen commit: ${file}`);
    inputs.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  assert.ok(inputs.length > 0, 'Empty candidate source.');
  return inputs;
}
