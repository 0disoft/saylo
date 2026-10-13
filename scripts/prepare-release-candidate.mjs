import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { packageIds, releaseInput } from './release-check.mjs';
import { privateCandidateIds, promote } from './release-candidate-source.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const exec = promisify(execFile);
const { values } = parseArgs({ options: { version: { type: 'string' } } });
const { version, tag } = releaseInput(['--version', values.version ?? '', '--tag', 'alpha']);
const current = JSON.parse(await readFile(path.join(repository, 'packages/core/package.json'), 'utf8'));
assert.notEqual(version, current.version, 'A proposed candidate must use a new version.');
const dirty = await exec('git', ['diff', '--name-only', 'HEAD'], { cwd: repository, windowsHide: true });
assert.equal(dirty.stdout.trim(), '', 'Commit tracked changes before freezing a candidate.');
const sourceCommit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repository, windowsHide: true })).stdout.trim();
const modes = (await exec('git', ['ls-files', '--stage'], { cwd: repository, windowsHide: true })).stdout;
assert.ok(!modes.split('\n').some(line => line.startsWith('120000 ')), 'Review source symlinks before archiving a candidate.');
const parent = path.join(repository, '.release');
await mkdir(parent, { recursive: true });
assert.ok(!(await lstat(parent)).isSymbolicLink());
assert.equal(await realpath(parent), path.join(await realpath(repository), '.release'));
const destination = await mkdtemp(path.join(parent, `candidate-${version}-`));
const checkout = path.join(destination, 'source');
await mkdir(checkout);
const archive = path.join(destination, 'source.zip');
await exec('git', ['archive', '--format=zip', '--output', archive, sourceCommit], { cwd: repository, windowsHide: true });
await exec('tar', ['-xf', archive, '-C', checkout], { cwd: repository, windowsHide: true });
for (const id of packageIds) {
  const file = path.join(checkout, `packages/${id}/package.json`);
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(manifest.version, current.version);
  promote(manifest, version);
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
}
const lockFile = path.join(checkout, 'package-lock.json');
const lock = JSON.parse(await readFile(lockFile, 'utf8'));
for (const id of packageIds) promote(lock.packages[`packages/${id}`], version);
for (const id of privateCandidateIds) if (lock.packages[`packages/${id}`]) {
  const file = path.join(checkout, `packages/${id}/package.json`);
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(manifest.private, true, 'The excluded workspace must remain private.');
  promote(manifest, version, { preserveVersion: true });
  promote(lock.packages[`packages/${id}`], version, { preserveVersion: true });
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
}
await writeFile(lockFile, JSON.stringify(lock, null, 2) + '\n');
const descriptor = { sourceCommit, proposedVersion: version, tag, originalVersion: current.version,
  sourceDirectory: checkout, destination, state: 'prepared temporary proposal; not validated or approved',
  limits: ['Original tracked versions are unchanged', 'No push, publish or CI dispatch', 'Validate the snapshot and its metadata before requesting publication approval'] };
await writeFile(path.join(destination, 'candidate.json'), JSON.stringify(descriptor, null, 2) + '\n');
console.log(JSON.stringify(descriptor, null, 2));
