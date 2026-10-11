import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { inspectCandidateSource, promote } from '../release-candidate-source.mjs';
import { packageIds, repository as checkout } from '../release-check.mjs';

test('a frozen candidate rejects code changes, metadata changes and missing inputs', async t => {
  const parent = path.resolve(os.tmpdir());
  const root = await mkdtemp(path.join(parent, 'saylo-candidate-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), parent);
    assert.ok(path.basename(root).startsWith('saylo-candidate-test-'));
    await rm(root, { recursive: true, force: true });
  });
  const repository = path.join(root, 'repository');
  const source = path.join(root, 'source');
  await mkdir(repository);
  await mkdir(source);
  const exec = promisify(execFile);
  const git = args => exec('git', args, { cwd: repository, windowsHide: true });
  await git(['init', '--quiet']);
  const version = '0.1.0-alpha.5';
  const lock = { lockfileVersion: 3, packages: {} };
  const files = ['package-lock.json', 'index.js'];
  for (const id of packageIds) {
    const directory = `packages/${id}`;
    const file = `${directory}/package.json`;
    files.push(file);
    const manifest = { name: `@0disoft/saylo-${id}`, version: '0.1.0-alpha.4', description: 'fixture',
      dependencies: id === 'core' ? {} : { '@0disoft/saylo-core': '0.1.0-alpha.4' } };
    lock.packages[directory] = structuredClone(manifest);
    await mkdir(path.join(repository, directory), { recursive: true });
    await writeFile(path.join(repository, file), JSON.stringify(manifest));
  }
  await writeFile(path.join(repository, 'package-lock.json'), JSON.stringify(lock));
  await writeFile(path.join(repository, 'index.js'), 'export const value = 1;\n');
  await git(['add', '.']);
  await git(['-c', 'user.name=Candidate Fixture', '-c', 'user.email=candidate@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture']);
  const commit = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  for (const file of files) {
    await mkdir(path.dirname(path.join(source, file)), { recursive: true });
    await cp(path.join(repository, file), path.join(source, file));
  }
  for (const id of packageIds) {
    const file = path.join(source, `packages/${id}/package.json`);
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    promote(manifest, version);
    promote(lock.packages[`packages/${id}`], version);
    await writeFile(file, JSON.stringify(manifest));
  }
  await writeFile(path.join(source, 'package-lock.json'), JSON.stringify(lock));
  assert.equal((await inspectCandidateSource(repository, source, commit, version)).length, files.length);
  await writeFile(path.join(source, 'index.js'), 'export const value = 2;\n');
  await assert.rejects(inspectCandidateSource(repository, source, commit, version), /source differs from frozen commit/);
  await cp(path.join(repository, 'index.js'), path.join(source, 'index.js'));
  const core = path.join(source, 'packages/core/package.json');
  const saved = await readFile(core);
  const edited = JSON.parse(saved);
  edited.description = 'unreviewed change';
  await writeFile(core, JSON.stringify(edited));
  await assert.rejects(inspectCandidateSource(repository, source, commit, version), /Unexpected candidate metadata edits/);
  await writeFile(core, saved);
  await rm(path.join(source, 'index.js'));
  await assert.rejects(inspectCandidateSource(repository, source, commit, version), { code: 'ENOENT' });
});

test('failed candidate revalidation clears the previous success status', async t => {
  const parent = path.join(await realpath(checkout), '.release');
  await mkdir(parent, { recursive: true });
  assert.equal(await realpath(parent), parent);
  const directory = await mkdtemp(path.join(parent, 'candidate-validation-test-'));
  t.after(async () => {
    assert.equal(path.dirname(await realpath(directory)), parent);
    assert.ok(path.basename(directory).startsWith('candidate-validation-test-'));
    await rm(directory, { recursive: true, force: true });
  });
  const exec = promisify(execFile);
  const commit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: checkout, windowsHide: true })).stdout.trim();
  const source = path.join(directory, 'source');
  await mkdir(source);
  await writeFile(path.join(directory, 'source.zip'), 'test marker');
  const descriptor = { sourceCommit: commit, proposedVersion: '0.1.0-alpha.5', tag: 'alpha',
    sourceDirectory: source, destination: directory, state: 'local candidate validated; not published',
    validationSha256: 'previous-success-marker' };
  const file = path.join(directory, 'candidate.json');
  await writeFile(file, JSON.stringify(descriptor));
  // The deliberately empty source must fail before any npm child can execute.
  await assert.rejects(exec(process.execPath, [path.join(checkout, 'scripts/verify-release-candidate.mjs'),
    '--candidate', directory], { cwd: checkout, env: { ...process.env, npm_execpath: process.execPath },
    windowsHide: true }), { code: 1 });
  const result = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(result.state, 'validation failed');
  assert.equal(result.validationSha256, undefined);
  const failure = JSON.parse(await readFile(path.join(result.validationDirectory, 'failure.json'), 'utf8'));
  assert.equal(failure.state, 'validation failed');
  assert.deepEqual(failure.checks, []);
});
