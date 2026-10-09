import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';
import { createBaseSchema, parseCatalog } from '@0disoft/saylo-core';
import { writeGenerated } from '../dist/write.js';

const written = Promise.withResolvers();
const release = Promise.withResolvers();
let pauseAfterWrite = false;
mock.module('../dist/write.js', { exports: {
  async writeGenerated(...args) {
    const result = await writeGenerated(...args);
    if (pauseAfterWrite && result === 'written') {
      pauseAfterWrite = false;
      written.resolve();
      await release.promise;
    }
    return result;
  },
} });
const { TypeGenerator } = await import('../dist/generator.js');
const schema = messages => createBaseSchema(parseCatalog(JSON.stringify(messages), { locale: 'ko', namespace: 'demo' }));

test('a superseded successful write is tracked before restoring the latest requested schema', { timeout: 10000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-typegen-race-'));
  const out = path.join(root, 'generated.d.ts');
  const generator = new TypeGenerator(out);
  t.after(async () => { release.resolve(); await generator.stop(); await rm(root, { recursive: true, force: true }); });
  const a = [schema({ first: 'A' })], b = [schema({ second: 'B' })];
  await generator.update(a);
  const original = await readFile(out, 'utf8');
  pauseAfterWrite = true;
  const pendingB = generator.update(b);
  await written.promise;
  assert.ok((await readFile(out, 'utf8')).includes('demo:second'));
  const pendingA = generator.update(a);
  release.resolve();
  await Promise.all([pendingB, pendingA]);
  assert.equal(await readFile(out, 'utf8'), original);
  await generator.update(a);
  assert.equal(await readFile(out, 'utf8'), original);
});
