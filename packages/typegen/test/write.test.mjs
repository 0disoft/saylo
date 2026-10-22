import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { writeGenerated } from '../dist/write.js';

function fixture(overrides = {}) {
  const calls = [];
  const operations = {
    acquireLock: target => ({ target: (process.platform === 'win32' ? path.resolve(target).toLowerCase() : path.resolve(target)), active: true, release: async () => {} }),
    read: async () => 'before', mkdir: async () => { calls.push('mkdir'); }, createId: () => 'test-id',
    create: async () => { calls.push('create'); return {
      writeFile: async () => { calls.push('write'); }, close: async () => { calls.push('close'); },
    }; },
    remove: async () => { calls.push('remove'); }, replace: async () => { calls.push('replace'); return 'written'; },
    ...overrides,
  };
  return { operations, calls };
}

test('exclusive-create collision never removes an unowned temporary file', async () => {
  const failure = Object.assign(new Error('already exists'), { code: 'EEXIST' });
  const f = fixture({ create: async () => { throw failure; } });
  await assert.rejects(writeGenerated('generated.d.ts', 'after', undefined, f), error => error === failure);
  assert.deepEqual(f.calls, ['mkdir']);
});

test('partial write failure remains the cause when close and cleanup also fail', async () => {
  const failure = new Error('disk full'); let closed = false, removed = false;
  const f = fixture({ create: async () => ({ writeFile: async () => { throw failure; },
    close: async () => { closed = true; throw new Error('close failed'); } }),
    remove: async () => { removed = true; throw new Error('cleanup failed'); } });
  await assert.rejects(writeGenerated('generated.d.ts', 'after', undefined, f), error =>
    error instanceof AggregateError && error.cause === failure && error.errors.length === 3 &&
    error.errors[1].message === 'close failed' && error.errors[2].message === 'cleanup failed');
  assert.equal(closed, true); assert.equal(removed, true);
});

for (const stage of ['read', 'mkdir', 'create', 'write']) {
  test(`cancellation during ${stage} releases owned resources before replacement`, async () => {
    const controller = new AbortController();
    const f = fixture();
    const stop = () => controller.abort(stage);
    if (stage === 'write') {
      const create = f.operations.create;
      f.operations.create = async file => { const handle = await create(file); handle.writeFile = async () => stop(); return handle; };
    } else {
      const original = f.operations[stage];
      f.operations[stage] = async (...args) => { const result = await original(...args); stop(); return result; };
    }
    assert.equal(await writeGenerated('generated.d.ts', 'after', undefined, { ...f, signal: controller.signal }), 'cancelled');
    assert.ok(!f.calls.includes('replace'));
    assert.equal(f.calls.includes('remove'), stage === 'create' || stage === 'write');
  });
}

test('rename success is committed even when cancellation arrives during rename', async () => {
  const controller = new AbortController();
  const f = fixture({ replace: async () => { controller.abort(); return 'written'; } });
  assert.equal(await writeGenerated('generated.d.ts', 'after', undefined, { ...f, signal: controller.signal }), 'written');
  assert.deepEqual(f.calls, ['mkdir', 'create', 'write', 'close']);
});

test('cleanup failures are visible when cancellation had no primary I/O failure', async () => {
  const controller = new AbortController(), failure = new Error('cleanup failed');
  const f = fixture({ replace: async () => { controller.abort(); return 'cancelled'; }, remove: async () => { throw failure; } });
  await assert.rejects(writeGenerated('generated.d.ts', 'after', undefined, { ...f, signal: controller.signal }), error => error === failure);
});

test('pre-aborted and unchanged writes do not create temporary files', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  assert.equal(await writeGenerated('generated.d.ts', 'after', undefined, { ...f, signal: controller.signal }), 'cancelled');
  assert.equal(await writeGenerated('generated.d.ts', 'before', undefined, f), 'unchanged');
  assert.deepEqual(f.calls, []);
});

test('injected identities cannot escape the temporary directory', async () => {
  for (const identity of ['', '../escape', 'with/slash', 'with\\slash']) {
    const f = fixture({ createId: () => identity });
    await assert.rejects(writeGenerated('generated.d.ts', 'after', undefined, f), /Invalid typegen temporary/);
    assert.deepEqual(f.calls, ['mkdir']);
  }
});
