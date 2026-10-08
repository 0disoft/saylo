import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceGenerated } from '../dist/replace.js';

test('Windows transient replacement failures retry the same rename with bounded delays', async () => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    let attempts = 0;
    const waits = [];
    const result = await replaceGenerated('temp', 'target', () => true, { platform: 'win32',
      async rename(from, to) {
        assert.deepEqual([from, to], ['temp', 'target']);
        if (++attempts <= 2) throw Object.assign(new Error('Sharing violation'), { code });
      }, wait: async delay => { waits.push(delay); } });
    assert.equal(result, 'written');
    assert.equal(attempts, 3);
    assert.deepEqual(waits, [20, 40]);
  }
});

test('new generation or stop during a retry wait cancels before replacing the target', async () => {
  let current = true, attempts = 0;
  const result = await replaceGenerated('temp', 'target', () => current, { platform: 'win32',
    async rename() { attempts++; throw Object.assign(new Error('Sharing violation'), { code: 'EPERM' }); },
    async wait() { current = false; } });
  assert.equal(result, 'cancelled');
  assert.equal(attempts, 1);
});

test('permanent, non-Windows and exhausted failures keep the original error', async () => {
  for (const [platform, code, expectedAttempts] of [['linux', 'EPERM', 1], ['win32', 'ENOENT', 1], ['win32', 'EPERM', 6]]) {
    const failure = Object.assign(new Error('Rename failed'), { code });
    let attempts = 0;
    const waits = [];
    await assert.rejects(replaceGenerated('temp', 'target', () => true, { platform,
      async rename() { attempts++; throw failure; }, async wait(delay) { waits.push(delay); } }), error => error === failure);
    assert.equal(attempts, expectedAttempts);
    assert.ok(waits.reduce((sum, delay) => sum + delay, 0) <= 620);
  }
});
