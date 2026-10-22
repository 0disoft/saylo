import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createBaseSchema, parseCatalog } from '@0disoft/saylo-core';
import { TypeGenerator } from '../dist/generator.js';
import { serializeFailure, restoreFailure } from '../dist/worker-errors.js';
import { scheduler } from '../../../scripts/test/helpers/scheduler.mjs';

const acquireLock = target => ({ target, active: true, release: async () => {} });
const schema = name => [createBaseSchema(parseCatalog(JSON.stringify({ [name]: name }), { locale: 'ko', namespace: 'demo' }))];
class Worker extends EventEmitter {
  jobs = []; terminations = 0;
  ref() {} unref() {}
  postMessage(job) { this.jobs.push(job); }
  async terminate() { this.terminations++; return 0; }
  reply(source, generation = this.jobs.at(-1).generation) { this.emit('message', { generation, source }); }
}

const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };

test('worker deadlines ignore wrong and late replies, release timers, and allow a fresh worker', async t => {
  const clock = scheduler(), workers = [], writes = [];
  const generator = new TypeGenerator('generated.d.ts', { ...clock, timeoutMs: 100, acquireLock,
    createWorker() { const worker = new Worker(); workers.push(worker); return worker; },
    write: async (_file, source) => { writes.push(source); return 'written'; } });
  t.after(() => generator.stop());
  const failed = assert.rejects(generator.update(schema('one')), { code: 'TIMEOUT' });
  clock.tick(99); workers[0].reply('wrong generation', 99); await flush();
  assert.equal(workers[0].terminations, 0);
  clock.tick(1); await failed; await flush();
  assert.equal(workers[0].terminations, 1);
  const recovered = generator.update(schema('two'));
  workers[0].reply('late'); workers[1].reply('two'); await recovered;
  assert.deepEqual(writes, ['two']);
  assert.equal(clock.size, 0);
  await generator.stop(); assert.equal(clock.size, 0);
});

test('a write timeout reports promptly but retains ownership until the physical write settles', async () => {
  const clock = scheduler(), worker = new Worker(), release = Promise.withResolvers();
  let released = false, signal, writes = 0;
  const generator = new TypeGenerator('generated.d.ts', { ...clock, timeoutMs: 100,
    acquireLock: target => ({ target, active: true, release: async () => { released = true; } }),
    createWorker: () => worker,
    write: async (_file, _source, current, options) => {
      writes++; signal = options.signal; await release.promise;
      assert.equal(current(), false); return 'cancelled';
    } });
  const failed = assert.rejects(generator.update(schema('one')), { code: 'TIMEOUT' });
  worker.reply('one'); await flush();
  clock.tick(99); assert.equal(signal.aborted, false);
  clock.tick(1); await failed;
  assert.equal(signal.aborted, true); assert.equal(signal.reason.code, 'TIMEOUT');
  await assert.rejects(generator.update(schema('two')), { code: 'TIMEOUT' });
  assert.equal(writes, 1);
  let stopped = false;
  const stopping = generator.stop().then(() => { stopped = true; }); await flush();
  assert.equal(stopped, false); assert.equal(released, false);
  release.resolve(); await stopping;
  assert.equal(released, true); assert.equal(clock.size, 0);
});

test('after a timed out physical write settles a later update can recover without concurrent writes', async t => {
  const clock = scheduler(), workers = [], release = Promise.withResolvers(); let writes = 0;
  const generator = new TypeGenerator('generated.d.ts', { ...clock, timeoutMs: 100, acquireLock,
    createWorker() { const worker = new Worker(); workers.push(worker); return worker; },
    async write(_file, _source, current) {
      if (++writes === 1) { await release.promise; assert.equal(current(), false); return 'cancelled'; }
      return 'written';
    } });
  t.after(() => generator.stop());
  const failed = assert.rejects(generator.update(schema('one')), { code: 'TIMEOUT' });
  workers[0].reply('one'); await flush(); clock.tick(100); await failed;
  release.resolve(); await flush();
  const recovered = generator.update(schema('two')); workers[1].reply('two'); await recovered;
  assert.equal(writes, 2); assert.equal(clock.size, 0);
});

test('worker errors preserve nested causes and codes across the message boundary', async t => {
  const worker = new Worker(), cause = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  const error = new TypeError('render failed', { cause });
  const failure = serializeFailure(error);
  const generator = new TypeGenerator('generated.d.ts', { acquireLock, createWorker: () => worker });
  t.after(() => generator.stop());
  const failed = assert.rejects(generator.update(schema('one')), e =>
    e.name === 'TypeError' && e.message === 'render failed' && e.cause.code === 'ENOSPC' && e.cause.message === 'disk full');
  worker.emit('message', { generation: worker.jobs[0].generation, error: failure.message, failure }); await failed;
  error.cause = error;
  assert.ok(restoreFailure(serializeFailure(error)) instanceof Error);
  assert.match(serializeFailure({ toString() { throw cause; } }).message, /unreadable/);
});

test('worker termination failure is surfaced by stop with the original operational cause', async () => {
  const worker = new Worker(), original = new Error('worker crashed'), cleanup = new Error('terminate failed');
  worker.terminate = async () => { throw cleanup; };
  const generator = new TypeGenerator('generated.d.ts', { acquireLock, createWorker: () => worker });
  const failed = assert.rejects(generator.update(schema('one')), e => e === original);
  worker.emit('error', original); await failed;
  await assert.rejects(generator.stop(), e => e instanceof AggregateError && e.cause === original && e.errors[1] === cleanup);
});

test('stop bounds a stalled worker termination and releases output ownership', async () => {
  const clock = scheduler(), worker = new Worker(); let released = false;
  worker.terminate = () => new Promise(() => {});
  const generator = new TypeGenerator('generated.d.ts', { ...clock, timeoutMs: 100,
    acquireLock: target => ({ target, active: true, release: async () => { released = true; } }), createWorker: () => worker });
  const cancelled = assert.rejects(generator.update(schema('one')), /stopped/);
  const failed = assert.rejects(generator.stop(), { code: 'TIMEOUT' });
  await cancelled; clock.tick(100); await failed;
  assert.equal(released, true); assert.equal(clock.size, 0);
});

test('lock release failures retain the original operational cause', async () => {
  const worker = new Worker(), original = new Error('render failed'), cleanup = new Error('lock cleanup failed');
  const generator = new TypeGenerator('generated.d.ts', { createWorker: () => worker,
    acquireLock: target => ({ target, active: true, release: async () => { throw cleanup; } }) });
  const failed = assert.rejects(generator.update(schema('one')), e => e === original);
  worker.emit('error', original); await failed;
  await assert.rejects(generator.stop(), e => e instanceof AggregateError && e.cause === original && e.errors[1] === cleanup);
});

test('an old writer deadline also bounds recovery queued after a worker failure', async t => {
  const clock = scheduler(), workers = [], release = Promise.withResolvers();
  const generator = new TypeGenerator('generated.d.ts', { ...clock, timeoutMs: 100, acquireLock,
    createWorker() { const worker = new Worker(); workers.push(worker); return worker; },
    async write() { await release.promise; return 'cancelled'; } });
  t.after(async () => { release.resolve(); await generator.stop(); });
  const crashed = assert.rejects(generator.update(schema('one')), /crashed/);
  workers[0].reply('one'); await flush();
  workers[0].emit('error', new Error('crashed')); await crashed;
  const recovery = assert.rejects(generator.update(schema('two')), { code: 'TIMEOUT' });
  workers[1].reply('two'); await flush(); clock.tick(100); await recovery;
  release.resolve(); await flush();
  assert.equal(clock.size, 0);
});

test('invalid deadline durations are rejected before starting work', () => {
  for (const timeoutMs of [0, -1, NaN, Infinity, 2147483648])
    assert.throws(() => new TypeGenerator('generated.d.ts', { timeoutMs }), RangeError);
});

for (const lateFailure of [false, true]) {
  test(`a failed worker's delayed writer cannot corrupt its replacement (${lateFailure ? 'rejected' : 'written'})`, async t => {
    const workers = [], started = Promise.withResolvers(), release = Promise.withResolvers(), writes = [];
    const generator = new TypeGenerator('generated.d.ts', { acquireLock, createWorker() { const worker = new Worker(); workers.push(worker); return worker; },
      async write(_file, source, isCurrent) {
        writes.push(source);
        if (source === 'old') { started.resolve(); await release.promise; if (lateFailure) throw new Error('old writer failed'); return 'written'; }
        assert.equal(isCurrent(), true); return 'written';
      } });
    t.after(async () => { release.resolve(); await generator.stop(); });
    const old = assert.rejects(generator.update(schema('old')), /worker failed/);
    workers[0].reply('old'); await started.promise;
    workers[0].emit('error', new Error('worker failed')); await old;
    const current = generator.update(schema('current'));
    workers[1].reply('current');
    workers[0].reply('stale'); workers[0].emit('exit', 1);
    release.resolve(); await current;
    assert.deepEqual(writes, ['old', 'current']);
    assert.equal(workers[1].terminations, 0);
    await generator.update(schema('current')); // The cached current output, not the old writer, is restored.
    assert.equal(writes.at(-1), 'current');
  });
}

test('stop waits for an active writer and ignores late worker results', async () => {
  const worker = new Worker(), started = Promise.withResolvers(), release = Promise.withResolvers(); let writes = 0;
  const generator = new TypeGenerator('generated.d.ts', { acquireLock, createWorker: () => worker,
    async write(_file, _source, current) { writes++; started.resolve(); await release.promise; assert.equal(current(), false); return 'cancelled'; } });
  const cancelled = assert.rejects(generator.update(schema('one')), /stopped/);
  worker.reply('one'); await started.promise;
  let stopped = false;
  const stopping = generator.stop().then(() => { stopped = true; });
  await cancelled; await Promise.resolve(); assert.equal(stopped, false);
  worker.reply('late'); release.resolve(); await stopping;
  assert.equal(writes, 1); assert.equal(worker.terminations, 1);
  await assert.rejects(generator.update(schema('two')), /stopped/);
});

test('duplicate and wrong-generation results do not start concurrent writes', async t => {
  const worker = new Worker(), started = Promise.withResolvers(), release = Promise.withResolvers(); let writes = 0;
  const generator = new TypeGenerator('generated.d.ts', { acquireLock, createWorker: () => worker,
    async write() { writes++; started.resolve(); await release.promise; return 'written'; } });
  t.after(() => generator.stop());
  const done = generator.update(schema('one'));
  worker.reply('wrong', 99); worker.reply('one'); worker.reply('duplicate');
  await started.promise; assert.equal(writes, 1); release.resolve(); await done;
  await generator.stop(); assert.equal(writes, 1);
});
