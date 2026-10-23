import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { packageIds } from '../release-check.mjs';
import { copyVerifiedTarballs } from '../pack-tarballs.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-tarballs-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('saylo-tarballs-'));
    await rm(root, { recursive: true, force: true });
  });
  const destination = path.join(root, 'consumer');
  await mkdir(destination);
  const packs = [];
  for (const id of packageIds) {
    const bytes = Buffer.from(`frozen ${id}`), version = '0.1.0-alpha.5';
    const filename = `0disoft-saylo-${id}-${version}.tgz`;
    packs.push({ name: `@0disoft/saylo-${id}`, version, filename,
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` });
    await writeFile(path.join(root, filename), bytes);
  }
  const manifest = async () => writeFile(path.join(root, 'manifest.json'), JSON.stringify(packs));
  await manifest();
  return { root, destination, packs, manifest };
}

test('copies exactly the verified artifacts without repacking or changing the input manifest', async t => {
  const f = await fixture(t);
  const before = await readFile(path.join(f.root, 'manifest.json'), 'utf8');
  assert.deepEqual(await copyVerifiedTarballs(f.root, f.destination), f.packs);
  for (const pack of f.packs) assert.deepEqual(await readFile(path.join(f.destination, pack.filename)),
    await readFile(path.join(f.root, pack.filename)));
  assert.equal(await readFile(path.join(f.root, 'manifest.json'), 'utf8'), before);
});

test('rejects corrupted artifacts before copying any packages', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, f.packs.at(-1).filename), 'changed');
  await assert.rejects(copyVerifiedTarballs(f.root, f.destination), /integrity differs/);
  assert.deepEqual(await readdir(f.destination), []);
});

test('rejects missing or duplicate packages, mixed versions and path overrides', async t => {
  const f = await fixture(t), original = structuredClone(f.packs);
  for (const change of [packs => packs.pop(), packs => { packs[1] = packs[0]; },
    packs => { packs[0].version = '0.1.0-alpha.4'; },
    packs => { packs[0].filename = '../outside.tgz'; }]) {
    f.packs.splice(0, f.packs.length, ...structuredClone(original));
    change(f.packs); await f.manifest();
    await assert.rejects(copyVerifiedTarballs(f.root, f.destination));
    assert.deepEqual(await readdir(f.destination), []);
  }
});
