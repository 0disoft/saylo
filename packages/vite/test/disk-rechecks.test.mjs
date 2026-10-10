import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setImmediate as immediate } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { DiskRechecks, diskStamp } from '../dist/disk-rechecks.js';

for (const scenario of ['early change', 'change after early match', 'change after middle match', 'reset and stop']) {
  test(`disk rechecks: ${scenario}`, async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'saylo-recheck-test-'));
    const file = path.join(directory, 'demo.json');
    const enqueued = []; const checks = new DiskRechecks(file => enqueued.push(file));
    let completed = 0;
    const original = DiskRechecks.prototype.verify;
    t.mock.method(DiskRechecks.prototype, 'verify', async function (...args) {
      try { return await original.apply(this, args); } finally { completed++; }
    });
    const waitFor = async count => {
      const deadline = performance.now() + 2000;
      while (completed < count && performance.now() < deadline) await immediate();
      assert.equal(completed, count);
    };
    try {
      await writeFile(file, 'old'); const stamp = await diskStamp(file);
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const check = checks.reset(file); checks.finish(file, check, stamp);
      if (scenario === 'early change') {
        await writeFile(file, 'changed content');
        t.mock.timers.tick(9); assert.equal(completed, 0);
        t.mock.timers.tick(1); await waitFor(1);
        assert.deepEqual(enqueued, [file]); assert.equal(checks.token(file), undefined);
        t.mock.timers.tick(50); await immediate(); assert.equal(completed, 1);
      } else if (scenario === 'change after early match') {
        t.mock.timers.tick(10); await waitFor(1);
        assert.deepEqual(enqueued, []); assert.equal(checks.token(file), check);
        await writeFile(file, 'late changed content');
        t.mock.timers.tick(19); assert.equal(completed, 1);
        t.mock.timers.tick(1); await waitFor(2); assert.deepEqual(enqueued, [file]);
        t.mock.timers.tick(30); await immediate(); assert.equal(completed, 2);
      } else if (scenario === 'change after middle match') {
        t.mock.timers.tick(10); await waitFor(1);
        t.mock.timers.tick(20); await waitFor(2);
        assert.deepEqual(enqueued, []); assert.equal(checks.token(file), check);
        await writeFile(file, 'late changed content');
        t.mock.timers.tick(29); assert.equal(completed, 2);
        t.mock.timers.tick(1); await waitFor(3); assert.deepEqual(enqueued, [file]);
      } else {
        const newer = checks.reset(file); checks.finish(file, newer, stamp);
        checks.finish(file, check, stamp); // Retired completion cannot reinstall timers.
        await writeFile(file, 'changed'); checks.stop();
        t.mock.timers.tick(100); await immediate();
        assert.equal(completed, 0); assert.deepEqual(enqueued, []);
      }
    } finally {
      checks.stop(); t.mock.timers.reset();
      assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
      assert.ok(path.basename(directory).startsWith('saylo-recheck-test-'));
      await rm(directory, { recursive: true, force: true });
    }
  });
}
