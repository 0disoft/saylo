import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdtemp, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createBaseSchema, parseCatalog } from '@0disoft/saylo-core';
import { TypeGenerator } from '../dist/generator.js';
import { acquireOutputLock, withOutputLock } from '../dist/output-lock.js';
import { isGeneratedFile, writeGenerated } from '../dist/write.js';

const schemas = [createBaseSchema(parseCatalog('{"title":"Hello"}', { locale: 'ko', namespace: 'demo' }))];
class Worker extends EventEmitter {
  ref() {} unref() {}
  postMessage(job) { this.job = job; }
  async terminate() { return 0; }
  reply(source) { this.emit('message', { generation: this.job.generation, source }); }
}
async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-output-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('a generator owns output before rendering; another generator, direct writer and CLI cannot overwrite it', async t => {
  const root = await directory(t), out = path.join(root, 'generated.d.ts');
  const worker = new Worker(), otherWorker = new Worker();
  const first = new TypeGenerator(out, { createWorker: () => worker });
  const other = new TypeGenerator(out, { createWorker: () => otherWorker });
  t.after(async () => { await first.stop(); await other.stop(); });
  const pending = first.update(schemas);
  pending.catch(() => {});
  await assert.rejects(other.update(schemas), { code: 'OUTPUT_LOCKED' });
  assert.equal(otherWorker.job, undefined);
  await assert.rejects(writeGenerated(out, 'foreign'), { code: 'OUTPUT_LOCKED' });
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--out-file', out, '--base-locale', 'ko',
    '--locales-dir', path.join(root, 'missing')], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /output is locked/);
  worker.reply('first'); await pending;
  assert.equal(await readFile(out, 'utf8'), 'first');
  await first.stop();
  const retried = other.update(schemas); otherWorker.reply('second'); await retried;
  await other.stop();
  assert.equal(await readFile(out, 'utf8'), 'second');
  assert.deepEqual(await readdir(root), ['generated.d.ts']);
});

test('overlapping direct writes reject rather than silently reorder and release the lock after completion', async t => {
  const root = await directory(t), out = path.join(root, 'generated.d.ts');
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  const old = writeGenerated(out, 'old', undefined, { operations: {
    async replace(temp, target) { started.resolve(); await release.promise; await rename(temp, target); return 'written'; },
  } });
  old.catch(() => {});
  t.after(async () => { release.resolve(); await old.catch(() => {}); });
  await started.promise;
  await assert.rejects(writeGenerated(out, 'new'), { code: 'OUTPUT_LOCKED' });
  release.resolve(); await old;
  await writeGenerated(out, 'new');
  assert.equal(await readFile(out, 'utf8'), 'new');
  assert.deepEqual(await readdir(root), ['generated.d.ts']);
});

test('cancellation after exclusive temp creation removes both the temporary file and output lock', async t => {
  const root = await directory(t), out = path.join(root, 'generated.d.ts');
  const controller = new AbortController();
  assert.equal(await writeGenerated(out, 'cancelled', undefined, { signal: controller.signal, operations: {
    async create(file) { const handle = await open(file, 'wx'); controller.abort(); return handle; },
  } }), 'cancelled');
  assert.deepEqual(await readdir(root), []);
});

test('writer failures release output ownership and a released or foreign lease cannot be reused', async t => {
  const root = await directory(t), out = path.join(root, 'generated.d.ts');
  const failure = new Error('Write failed');
  await assert.rejects(writeGenerated(out, 'bad', undefined, { operations: { read: async () => { throw failure; } } }), error => error === failure);
  const lock = acquireOutputLock(out);
  await assert.rejects(writeGenerated(path.join(root, 'other.d.ts'), 'wrong', undefined, { lock }), /another file/);
  await lock.release(); await lock.release();
  await assert.rejects(writeGenerated(out, 'released', undefined, { lock }), /inactive/);
  assert.deepEqual(await readdir(root), []);
});

test('stop waits for the active writer and releases ownership even if worker termination rejects', async t => {
  const root = await directory(t), out = path.join(root, 'generated.d.ts');
  const worker = new Worker(), failure = new Error('Terminate failed');
  worker.terminate = async () => { throw failure; };
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  const generator = new TypeGenerator(out, { createWorker: () => worker,
    async write() { started.resolve(); await release.promise; return 'cancelled'; } });
  t.after(async () => { release.resolve(); await generator.stop().catch(() => {}); });
  const pending = generator.update(schemas); worker.reply('old'); await started.promise;
  const cancelled = assert.rejects(pending, /stopped/);
  const stopping = generator.stop();
  const failed = assert.rejects(stopping, error => error === failure);
  await cancelled;
  assert.throws(() => acquireOutputLock(out), { code: 'OUTPUT_LOCKED' });
  release.resolve(); await failed;
  const lock = acquireOutputLock(out); await lock.release();
  assert.deepEqual(await readdir(root), []);
});

test('unreleased locks are never stolen and watcher exclusions cover ownership metadata', async t => {
  const root = await directory(t), out = path.join(root, 'generated.d.ts');
  const lock = acquireOutputLock(out), directoryPath = path.join(root, '.generated.d.ts.saylo-typegen.lock');
  t.after(() => lock.release());
  const owner = await readFile(path.join(directoryPath, 'owner.json'), 'utf8');
  assert.throws(() => acquireOutputLock(path.join(root, '.', 'generated.d.ts')), { code: 'OUTPUT_LOCKED' });
  assert.equal(await readFile(path.join(directoryPath, 'owner.json'), 'utf8'), owner);
  assert.equal(isGeneratedFile(out, directoryPath), true);
  assert.equal(isGeneratedFile(out, path.join(directoryPath, 'owner.json')), true);
  assert.equal(isGeneratedFile(out, path.join(root, '.other.d.ts.saylo-typegen.lock')), false);
});

test('operation errors retain their cause when lock cleanup also fails', async () => {
  const failure = new Error('Render failed'), cleanup = new Error('Release failed');
  await assert.rejects(withOutputLock('unused.d.ts', async () => { throw failure; },
    () => ({ release: async () => { throw cleanup; } })), error =>
    error instanceof AggregateError && error.cause === failure && error.errors[1] === cleanup);
});
