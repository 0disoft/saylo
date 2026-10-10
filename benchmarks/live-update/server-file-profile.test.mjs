import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { summarizeFileSample } from './server-file-profile.mjs';

const op = (metric, startMs, endMs, status = 'ok') => ({ metric, startMs, endMs, status });
const sample = operations => ({ operations, calls: Object.fromEntries(['pathCheckMs', 'fileReadMs', 'catalogParseMs']
  .map(metric => [metric, operations.filter(operation => operation.metric === metric).length])) });

test('two reads use interval unions and retain failed-path counts without double-counting candidate wait', () => {
  const result = summarizeFileSample(sample([
    op('pathCheckMs', 10, 20), op('fileReadMs', 20, 30), op('catalogParseMs', 30, 70),
    op('pathCheckMs', 100, 105), op('fileReadMs', 105, 110), op('catalogParseMs', 110, 111),
  ]), [[0, 100], [20, 130]]);
  assert.deepEqual(result.timings, { pathCheckMs: 15, fileReadMs: 15, catalogParseMs: 41, candidateOtherMs: 59 });
  assert.deepEqual(result.calls, { pathCheckMs: 2, fileReadMs: 2, catalogParseMs: 2 });
  const recovered = summarizeFileSample(sample([
    op('pathCheckMs', 5, 8, 'error'), op('pathCheckMs', 30, 35), op('fileReadMs', 35, 36), op('catalogParseMs', 36, 40),
  ]), [[0, 40]]);
  assert.equal(recovered.timings.candidateOtherMs, 27);
  assert.deepEqual(recovered.calls, { pathCheckMs: 2, fileReadMs: 1, catalogParseMs: 1 });
});

test('missing, unfinished and out-of-window operations cannot become passing timing samples', () => {
  assert.throws(() => summarizeFileSample(sample([]), [[0, 20]]), /Missing/);
  const valid = [op('pathCheckMs', 0, 1), op('fileReadMs', 1, 2), op('catalogParseMs', 2, 3)];
  assert.throws(() => summarizeFileSample(sample(valid), [[0, 2]]), /escape/);
  assert.throws(() => summarizeFileSample(sample([...valid, op('fileReadMs', 3, undefined, 'running')]), [[0, 10]]), /unfinished/);
  const wrongCount = sample(valid); wrongCount.calls.catalogParseMs = 2;
  assert.throws(() => summarizeFileSample(wrongCount, [[0, 3]]), /count mismatch/);
});

test('real serialized superseded reads preserve publication and both candidate windows without changing dist', () => {
  const probe = new URL('./server-file-profile.mjs', import.meta.url).href;
  const stages = new URL('./profile.mjs', import.meta.url).href;
  const registry = new URL('../../packages/vite/dist/live-registry.js', import.meta.url).href;
  const code = `
    import assert from 'node:assert/strict';
    import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
    import { createHash } from 'node:crypto';
    import os from 'node:os'; import path from 'node:path';
    import { registerFileProbe } from ${JSON.stringify(probe)};
    const hooks = registerFileProbe(true);
    const { createStageProbe } = await import(${JSON.stringify(stages)});
    const { LiveRegistry } = await import(${JSON.stringify(registry)});
    const { parseCatalog } = await import('@0disoft/saylo-core');
    const fileUrl = new URL(${JSON.stringify(registry)});
    const hash = async () => createHash('sha256').update(await readFile(fileUrl)).digest('hex');
    const beforeHash = await hash();
    const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-stage-proof-'));
    const probe = createStageProbe(); let live;
    try {
      await mkdir(path.join(root, 'en'));
      const file = path.join(root, 'en', 'demo.json');
      const source = '{"hello":"Hello {name}"}'; await writeFile(file, source);
      const catalog = parseCatalog(source, { locale: 'en', namespace: 'demo', sourceName: 'en/demo.json' });
      let active, publications = 0;
      live = new LiveRegistry(root, [{ file, source, catalog }], 'en', files => { active = files; publications++; });
      let release, started;
      const reading = new Promise(resolve => { started = resolve; });
      const slow = new Promise(resolve => { release = resolve; });
      const next = '{"hello":"Latest {name}"}';
      probe.begin();
      const first = live.enqueue(file, () => { started(); return slow; });
      await reading;
      const second = live.enqueue(file, () => next);
      await new Promise(resolve => setTimeout(resolve, 10));
      release(next); await Promise.all([first, second]);
      const result = probe.finish(); hooks.assertTransformed();
      assert.equal(publications, 1); assert.equal(active[0].catalog.messages.hello.source, 'Latest {name}');
      assert.equal(result.drains, 2); assert.equal(result.candidateIntervals.length, 2);
      assert.equal(result.boundaryVersion, 2); assert.equal(result.drainWaitMs.length, 2);
      assert.deepEqual(result.fileStages.calls, { pathCheckMs: 2, fileReadMs: 2, catalogParseMs: 2 });
      const parses = result.fileStages.operations.filter(op => op.metric === 'catalogParseMs');
      assert.ok(parses.every(op => op.hasPrevious));
      const children = Object.values(result.fileStages.timings).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(children - result.readAndCandidateMs) < .00001);
      assert.equal(await hash(), beforeHash);
    } finally {
      live?.stop(); probe.dispose(); hooks.dispose();
      const resolved = path.resolve(root);
      assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
      assert.ok(path.basename(resolved).startsWith('saylo-stage-proof-'));
      await rm(resolved, { recursive: true, force: true });
    }
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000 });
});
