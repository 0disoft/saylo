import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { parseCatalog } from '@0disoft/saylo-core';
import { LiveRegistry } from '../dist/live-registry.js';
import { DiskRechecks } from '../dist/disk-rechecks.js';
import { scheduler } from '../../../scripts/test/helpers/scheduler.mjs';

function fixture(t, publish = () => {}) {
  const clock = scheduler();
  const root = path.resolve('virtual-locales');
  const file = path.join(root, 'ko', 'demo.json');
  let source = '{"title":"Before"}';
  const item = text => ({ file, source: text, catalog: parseCatalog(text, { locale: 'ko', namespace: 'demo' }) });
  let reads = 0;
  const registry = new LiveRegistry(root, [item(source)], 'ko', publish, { ...clock,
    read: async () => { reads++; return source; }, stamp: async () => 'stable', isFile: async () => true,
    readCatalog: async (_root, _file, _locale, _namespace, read) => item(await read()),
  });
  t.after(() => registry.stop());
  return { clock, file, registry, get reads() { return reads; }, write(text) { source = JSON.stringify({ title: text }); } };
}

test('failed publication cannot poison later saves and identical saves retry publication', async t => {
  let failing = true;
  const calls = [];
  const f = fixture(t, (files, changed) => {
    calls.push([files[0].catalog.messages.title.source, changed]);
    if (failing) throw new Error('Socket failed');
  });
  f.write('After');
  const first = f.registry.enqueue(f.file, () => '{"title":"After"}');
  f.clock.tick(0); await first;
  assert.match(f.registry.diagnostic().message, /Socket failed/);
  failing = false;
  const second = f.registry.enqueue(f.file, () => '{"title":"After"}');
  f.clock.tick(0); await second;
  assert.deepEqual(calls, [['After', true], ['After', true]]);
  assert.equal(f.registry.diagnostic().message, '');
  f.write('Latest');
  const third = f.registry.enqueue(f.file);
  f.clock.tick(40); await third;
  assert.deepEqual(calls.at(-1), ['Latest', true]);
});

test('zero-origin disk bursts drain at 200ms and are independent of the wall clock', async t => {
  let published = 0;
  const f = fixture(t, () => { published++; });
  const jobs = [f.registry.enqueue(f.file)];
  for (let i = 0; i < 6; i++) { f.clock.tick(30); jobs.push(f.registry.enqueue(f.file)); }
  f.clock.tick(19); assert.equal(f.reads, 0);
  f.clock.tick(1); await Promise.all(jobs);
  assert.equal(f.reads, 1); assert.equal(published, 1);
  f.registry.stop(); assert.equal(f.clock.size, 0);
});

test('non-Error reader failures are diagnostic and do not block recovery', async t => {
  const f = fixture(t);
  for (const error of [null, { toString() { throw new Error('broken coercion'); } }]) {
    const pending = f.registry.enqueue(f.file, () => { throw error; });
    f.clock.tick(0); await pending;
    assert.ok(f.registry.diagnostic().message);
  }
  const pending = f.registry.enqueue(f.file, () => '{"title":"Recovered"}');
  f.clock.tick(0); await pending;
  assert.equal(f.registry.diagnostic().message, '');
});

test('a late early stat can report changes after the final stat completed', async () => {
  const clock = scheduler(), deferred = [], files = [];
  const checks = new DiskRechecks(file => files.push(file), { schedule: clock.schedule,
    stamp: () => new Promise(resolve => deferred.push(resolve)) });
  const token = checks.reset('demo'); checks.finish('demo', token, 'old');
  clock.tick(60);
  assert.equal(deferred.length, 3);
  deferred[2]('old'); deferred[1]('old'); await Promise.resolve();
  assert.equal(checks.token('demo'), token);
  deferred[0]('new'); await Promise.resolve();
  assert.deepEqual(files, ['demo']); assert.equal(checks.token('demo'), undefined);
  checks.stop(); assert.equal(clock.size, 0);
});

test('reset and stop invalidate stats already in flight', async () => {
  const clock = scheduler(); let release;
  const checks = new DiskRechecks(() => assert.fail('obsolete stat'), { schedule: clock.schedule,
    stamp: () => new Promise(resolve => { release = resolve; }) });
  const token = checks.reset('demo'); checks.finish('demo', token, 'old'); clock.tick(10);
  checks.reset('demo'); checks.stop(); release('new'); await Promise.resolve();
  assert.equal(clock.size, 0);
});
