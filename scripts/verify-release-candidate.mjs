import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { packageIds, releaseInput } from './release-check.mjs';
import { inspectCandidateSource } from './release-candidate-source.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: { candidate: { type: 'string' } } });
assert.ok(values.candidate, 'Supply --candidate with the prepared candidate directory.');
const candidate = await realpath(path.resolve(repository, values.candidate));
const parent = path.join(await realpath(repository), '.release');
assert.equal(path.dirname(candidate), parent, 'Candidate must be a direct child of .release.');
assert.ok(path.basename(candidate).startsWith('candidate-'), 'Unexpected candidate directory.');
const descriptor = JSON.parse(await readFile(path.join(candidate, 'candidate.json'), 'utf8'));
const { version, tag } = releaseInput(['--version', descriptor.proposedVersion, '--tag', descriptor.tag]);
assert.equal(await realpath(descriptor.destination), candidate);
const source = path.join(candidate, 'source');
assert.equal((await lstat(source)).isSymbolicLink(), false);
assert.equal(await realpath(source), source);
assert.equal(await realpath(descriptor.sourceDirectory), source);
assert.match(descriptor.sourceCommit, /^[a-f\d]{40}$/);
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run with npm run release:candidate:verify.');
const exec = promisify(execFile);
const childEnv = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => key.toLowerCase() !== 'npm_config_allow_scripts'));
const output = await mkdtemp(path.join(candidate, 'validation-'));
const checks = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceArchiveSha256 = hash(await readFile(path.join(candidate, 'source.zip')));
descriptor.state = 'validation running';
descriptor.validationDirectory = output;
delete descriptor.validationSha256;
await writeFile(path.join(candidate, 'candidate.json'), JSON.stringify(descriptor, null, 2) + '\n');
async function check(name, args) {
  console.log(`[candidate] ${name} started; full output will be saved in ${output}`);
  const start = Date.now();
  try {
    const result = await exec(process.execPath, [npmCli, ...args], { cwd: source, env: childEnv,
      windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    await writeFile(path.join(output, `${name}.log`), result.stdout + result.stderr);
    checks.push({ name, command: ['npm', ...args], exitCode: 0, durationMs: Date.now() - start });
    console.log(`[candidate] ${name} passed (${checks.at(-1).durationMs}ms).`);
  } catch (error) {
    await writeFile(path.join(output, `${name}.log`), (error.stdout ?? '') + (error.stderr ?? ''));
    checks.push({ name, command: ['npm', ...args], exitCode: error.code ?? null, durationMs: Date.now() - start });
    throw new Error(`${name} failed; inspect ${path.join(output, `${name}.log`)}`, { cause: error });
  }
}
try {
  const inputs = await inspectCandidateSource(repository, source, descriptor.sourceCommit, version);
  await check('install', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  await check('check', ['run', 'check']);
  await check('release-metadata', ['run', 'release:check', '--', '--version', version, '--tag', tag]);
  // This output belongs to the isolated source tree, never the original .release/npm.
  await check('pack', ['exec', '--', 'node', 'scripts/pack-smoke.mjs', '--save-release']);
  await check('publish-plan', ['run', 'release:publish', '--', '--version', version, '--tag', tag]);
  assert.deepEqual(await inspectCandidateSource(repository, source, descriptor.sourceCommit, version), inputs,
    'Candidate inputs changed while validating; prepare and validate a fresh snapshot.');
  const packed = path.join(source, '.release/npm');
  const artifacts = JSON.parse(await readFile(path.join(packed, 'manifest.json'), 'utf8'));
  assert.deepEqual(artifacts.map(pack => pack.name).sort(), packageIds.map(id => `@0disoft/saylo-${id}`).sort());
  for (const pack of artifacts) {
    assert.equal(pack.version, version);
    assert.equal(pack.filename, `0disoft-saylo-${pack.name.slice('@0disoft/saylo-'.length)}-${version}.tgz`);
    const bytes = await readFile(path.join(packed, pack.filename));
    assert.equal(pack.integrity, 'sha512-' + createHash('sha512').update(bytes).digest('base64'));
    await cp(path.join(packed, pack.filename), path.join(output, pack.filename));
  }
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(artifacts, null, 2) + '\n');
  const evidence = { schema: 'saylo.release-candidate-validation/v1', sourceCommit: descriptor.sourceCommit,
    proposedVersion: version, tag, sourceArchiveSha256, checkedAt: new Date().toISOString(), checks, inputs,
    artifacts, state: 'local candidate validated; not published',
    limits: ['No source version bump, push, OIDC exchange or workflow dispatch.',
      'source.zip is the original Git archive; public package versions and internal dependency refs use the proposed version. Private workspace versions stay unchanged.',
      'Existing publication labels describe alpha.4. Final release documentation must be updated before publication.',
      'This is local JS/TS tarball consumption, not registry or SvelteKit browser acceptance.'] };
  await writeFile(path.join(output, 'validation.json'), JSON.stringify(evidence, null, 2) + '\n');
  descriptor.state = evidence.state;
  descriptor.validationDirectory = output;
  descriptor.validationSha256 = hash(await readFile(path.join(output, 'validation.json')));
  await writeFile(path.join(candidate, 'candidate.json'), JSON.stringify(descriptor, null, 2) + '\n');
  console.log(`[candidate] Verified ${artifacts.length} artifacts and saved manifest, logs and validation.json in ${output}`);
} catch (error) {
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ proposedVersion: version, checks,
    state: 'validation failed', error: error.message }, null, 2) + '\n');
  descriptor.state = 'validation failed';
  await writeFile(path.join(candidate, 'candidate.json'), JSON.stringify(descriptor, null, 2) + '\n');
  throw error;
}
