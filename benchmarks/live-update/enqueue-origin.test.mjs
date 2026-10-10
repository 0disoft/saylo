import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseCatalog } from '@0disoft/saylo-core';
import { LiveRegistry } from '../../packages/vite/dist/live-registry.js';
import { createStageProbe } from './profile.mjs';

test('stage origins distinguish an external reader from the real trailing metadata recheck', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'saylo-enqueue-origin-'));
  const files = ['../../packages/vite/dist/live-registry.js', '../../packages/vite/dist/disk-rechecks.js'];
  const hashes = () => Promise.all(files.map(async file => createHash('sha256').update(
    await readFile(new URL(file, import.meta.url))).digest('hex')));
  const before = await hashes();
  const probe = createStageProbe(); let live;
  try {
    await mkdir(path.join(directory, 'en'));
    const file = path.join(directory, 'en', 'demo.json');
    const initial = '{"message":"Original"}', updated = '{"message":"Changed"}';
    await writeFile(file, initial);
    const catalog = parseCatalog(initial, { locale: 'en', namespace: 'demo' });
    let publications = 0, latest;
    live = new LiveRegistry(directory, [{ file, source: initial, catalog }], 'en', accepted => {
      publications++; latest = accepted[0].catalog.messages.message.source;
    });
    probe.begin(); await live.enqueue(file, () => readFile(file, 'utf8'));
    const first = probe.finish();
    assert.equal(first.enqueueEvents.length, 1);
    assert.equal(first.enqueueEvents[0].origin, 'external-enqueue');
    assert.equal(first.enqueueEvents[0].hasReader, true);
    probe.begin(); await writeFile(file, updated);
    const deadline = Date.now() + 2000;
    while (publications < 2 && Date.now() < deadline) await delay(5);
    assert.equal(publications, 2); assert.equal(latest, 'Changed');
    const trailing = probe.finish();
    assert.equal(trailing.enqueueEvents.length, 1);
    assert.equal(trailing.enqueueEvents[0].origin, 'disk-recheck');
    assert.equal(trailing.enqueueEvents[0].hasReader, true);
    assert.ok(trailing.enqueueEvents[0].offsetMs >= 0);
    assert.deepEqual(await hashes(), before, 'Instrumentation never changes product dist.');
  } finally {
    live?.stop(); probe.dispose();
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('saylo-enqueue-origin-'));
    await rm(directory, { recursive: true, force: true });
  }
});
