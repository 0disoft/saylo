import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const repository = fileURLToPath(new URL('..', import.meta.url));
export const packageIds = ['core', 'react', 'typegen', 'vite'];
export function releaseInput(args = process.argv.slice(2)) {
  let version, tag = 'alpha', publish = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--version') version = args[++i];
    else if (args[i] === '--tag') tag = args[++i];
    else if (args[i] === '--publish') publish = true;
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  assert.match(version ?? '', /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(0|[1-9]\d*))?$/, 'Supply an exact release version.');
  assert.ok(['alpha', 'next', 'latest'].includes(tag), 'Unsupported dist-tag.');
  assert.ok(!version.includes('-') || tag !== 'latest', 'Prereleases cannot use latest.');
  assert.ok(version.includes('-') || tag !== 'alpha', 'Stable releases cannot use alpha.');
  return { version, tag, publish };
}
export async function checkRelease({ version }) {
  assert.equal(JSON.parse(await readFile(new URL('../package.json', import.meta.url))).private, true);
  const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
  const notice = await readFile(new URL('../NOTICE', import.meta.url), 'utf8');
  for (const id of packageIds) {
    const base = new URL(`../packages/${id}/`, import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('package.json', base)));
    assert.equal(manifest.name, `@0disoft/saylo-${id}`);
    assert.equal(manifest.version, version, `${id}: release version differs from source`);
    assert.equal(manifest.private, undefined, `${id}: package must be publishable`);
    assert.equal(manifest.license, 'Apache-2.0');
    assert.deepEqual(manifest.engines, { node: '24.x' });
    assert.equal(manifest.publishConfig.access, 'public');
    assert.equal(manifest.publishConfig.registry, 'https://registry.npmjs.org/');
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (name.startsWith('@0disoft/saylo-')) assert.equal(range, version, `${id}: prerelease dependency must use the same exact version`);
    }
    assert.equal(await readFile(new URL('LICENSE', base), 'utf8'), license);
    assert.equal(await readFile(new URL('NOTICE', base), 'utf8'), notice);
  }
  console.log(`[release] Four Apache-2.0 packages validated at ${version}.`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await checkRelease(releaseInput());
