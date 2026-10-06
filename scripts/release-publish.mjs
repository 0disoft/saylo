import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { checkRelease, packageIds, releaseInput, repository } from './release-check.mjs';

const input = releaseInput();
await checkRelease(input);
const artifacts = path.join(repository, '.release/npm');
const packs = JSON.parse(await readFile(path.join(artifacts, 'manifest.json'), 'utf8'));
assert.deepEqual(packs.map(pack => pack.name).sort(), packageIds.map(id => `@0disoft/saylo-${id}`).sort());
for (const pack of packs) {
  assert.equal(pack.version, input.version);
  assert.equal(pack.filename, `0disoft-saylo-${pack.name.split('saylo-')[1]}-${input.version}.tgz`);
  const bytes = await readFile(path.join(artifacts, pack.filename));
  assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, pack.integrity, 'Artifact integrity changed.');
}
if (!input.publish) {
  console.log(`[release] Dry run: validated ${packs.length} artifacts for ${input.tag}; no registry writes.`);
} else {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Publishing is supported only by the release workflow.');
  assert.equal(process.env.GITHUB_REPOSITORY, '0disoft/saylo');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert.ok(process.env.ACTIONS_ID_TOKEN_REQUEST_URL, 'OIDC permission is required.');
  assert.ok(process.env.npm_execpath, 'Use npm run release:publish.');
  const provenance = process.env.NPM_CONFIG_PROVENANCE;
  assert.ok(['true', 'false'].includes(provenance), 'The workflow must set provenance according to repository visibility.');
  const exec = promisify(execFile);
  const published = new Set();
  // Check every package before the first write. Only an identical artifact may be skipped.
  for (const pack of packs) {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pack.name)}`, { signal: AbortSignal.timeout(30000) });
    if (response.status === 404) continue;
    assert.ok(response.ok, `Registry lookup failed: ${pack.name} (${response.status})`);
    const metadata = await response.json();
    const existing = metadata.versions?.[input.version];
    if (!existing) continue;
    assert.equal(existing.dist?.integrity, pack.integrity, `${pack.name}: version already exists with different bytes. Use a new version.`);
    assert.equal(metadata['dist-tags']?.[input.tag], input.version, `${pack.name}: existing version has a different dist-tag. Resolve the tag before retrying.`);
    published.add(pack.name);
  }
  for (const id of packageIds) {
    const pack = packs.find(entry => entry.name === `@0disoft/saylo-${id}`);
    if (published.has(pack.name)) { console.log(`[release] Skipping identical published version: ${pack.name}`); continue; }
    const result = await exec(process.execPath, [process.env.npm_execpath, 'publish', path.join(artifacts, pack.filename),
      '--access', 'public', '--tag', input.tag, `--provenance=${provenance}`, '--ignore-scripts', '--registry', 'https://registry.npmjs.org/'],
      { cwd: repository, windowsHide: true, maxBuffer: 1024 * 1024 });
    console.log(result.stdout.trim());
  }
}
