import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createBaseSchema, parseCatalog } from '@0disoft/saylo-core';
import { TypeGenerator } from '../dist/generator.js';

const acquireLock = target => ({ target, active: true, release: async () => {} });
const schema = name => [createBaseSchema(parseCatalog(JSON.stringify({ [name]: name }), { locale: 'ko', namespace: 'demo' }))];
class Worker extends EventEmitter {
  jobs = []; terminations = 0;
  ref() {} unref() {}
  postMessage(job) { this.jobs.push(job); }
  async terminate() { this.terminations++; return 0; }
  reply(source, generation = this.jobs.at(-1).generation) { this.emit('message', { generation, source }); }
}

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
