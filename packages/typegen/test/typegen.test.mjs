import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createBaseSchema, parseCatalog } from '@0disoft/saylo-core';
import { renderTypes, TypeGenerator, writeGenerated, isGeneratedFile } from '@0disoft/saylo-typegen';
import { fixtureSchema } from './fixture.mjs';
import { mapFileTasks, FileTaskQueue, scanCatalogs } from '../dist/catalog-files.js';

const schema = (messages, namespace = 'demo') => createBaseSchema(parseCatalog(JSON.stringify(messages), { locale: 'ko', namespace }));
async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-typegen-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('file tasks cap concurrency, keep input order, and report the earliest input failure', async () => {
  const pending = [], started = [];
  let active = 0, peak = 0;
  const work = mapFileTasks(Array.from({ length: 20 }, (_, i) => i), i => {
    const gate = Promise.withResolvers(); pending[i] = gate; started.push(i);
    peak = Math.max(peak, ++active);
    return gate.promise.then(() => i).finally(() => { active--; });
  });
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  assert.equal(started.length, 8);
  for (let offset = 0; offset < 20; offset += 8) {
    for (let i = Math.min(offset + 7, 19); i >= offset; i--) pending[i].resolve();
    await flush();
  }
  assert.deepEqual(await work, Array.from({ length: 20 }, (_, i) => i)); assert.equal(peak, 8);
  const gates = Array.from({ length: 4 }, () => Promise.withResolvers());
  const first = new Error('first input failure'), later = new Error('faster later failure');
  const failed = assert.rejects(mapFileTasks(gates, gate => gate.promise, { concurrency: 4 }), error => error === first);
  gates[3].reject(later); gates[1].reject(first); gates[0].resolve(); gates[2].resolve(); await failed;
});

test('aborted file tasks retain physical slots and discard queued operations', async () => {
  const queue = new FileTaskQueue(1), controller = new AbortController(), physical = Promise.withResolvers();
  const reason = new Error('deadline'); let started = 0;
  const first = assert.rejects(queue.run(() => { started++; return physical.promise; }, controller.signal), error => error === reason);
  const discarded = assert.rejects(queue.run(async () => { assert.fail('aborted queued operation'); }, controller.signal), error => error === reason);
  await Promise.resolve(); controller.abort(reason); await Promise.all([first, discarded]);
  const next = queue.run(async () => { started++; return 'recovered'; });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(started, 1); physical.resolve(); assert.equal(await next, 'recovered'); assert.equal(started, 2);
});

test('parallel catalog scanning preserves sorted locale and namespace output', async t => {
  const root = await directory(t);
  for (const locale of ['ko', 'en']) {
    await mkdir(path.join(root, locale));
    for (const namespace of ['z', 'b', 'a']) await writeFile(path.join(root, locale, `${namespace}.json`), '{"title":"Value"}');
  }
  assert.deepEqual((await scanCatalogs(root)).files.map(f => `${f.catalog.locale}/${f.catalog.namespace}`),
    ['en/a', 'en/b', 'en/z', 'ko/a', 'ko/b', 'ko/z']);
});

test('emission is stable across text/order edits and preserves base argument contracts', () => {
  const source = renderTypes([fixtureSchema]);
  assert.ok(source.includes('"cart:amount": { "count": number; };'));
  assert.ok(source.includes('"cart:when": { "at": Date | number; };'));
  assert.ok(source.includes('"cart:greeting": { "name": number | string; };'));
  assert.ok(source.includes('"cart:choice": { "extra": number | string; "mode": string; };'));
  assert.ok(source.includes('"cart:__proto__": { "constructor": number | string; };'));
  assert.equal(renderTypes([schema({ b: '{count, number}', a: 'Old' })]), renderTypes([schema({ a: 'New', b: '{count, number} things' })]));
  const escaped = renderTypes([schema({ 'quote"\\\n\u2028': 'Text' })]);
  assert.ok(escaped.includes('\\u2028'));
  assert.ok(!escaped.includes('\u2028'));
});

test('atomic writer skips unchanged content and obsolete work, then cleans temporary files', async t => {
  const root = await directory(t);
  const out = path.join(root, 'generated.d.ts');
  assert.equal(await writeGenerated(out, 'old'), 'written');
  await utimes(out, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
  const before = (await stat(out)).mtimeMs;
  assert.equal(await writeGenerated(out, 'old'), 'unchanged');
  assert.equal((await stat(out)).mtimeMs, before);
  assert.equal(await writeGenerated(out, 'obsolete', () => false), 'cancelled');
  assert.equal(await readFile(out, 'utf8'), 'old');
  assert.equal(await writeGenerated(out, 'latest'), 'written');
  assert.deepEqual(await readdir(root), ['generated.d.ts']);
  assert.equal(isGeneratedFile(out, path.join(root, '.generated.d.ts.saylo-typegen-example.tmp')), true);
  assert.equal(isGeneratedFile(out, path.join(root, 'unrelated.tmp')), false);
});

test('background worker coalesces burst generations to the latest schema and skips text-only edits', async t => {
  const root = await directory(t);
  const out = path.join(root, 'generated.d.ts');
  const generator = new TypeGenerator(out);
  t.after(() => generator.stop());
  const first = generator.update([schema({ old: 'Old' })]);
  const intermediate = generator.update([schema({ middle: 'Middle' })]);
  const latest = generator.update([schema({ latest: '{count, number}' })]);
  await Promise.all([first, intermediate, latest]);
  const source = await readFile(out, 'utf8');
  assert.ok(source.includes('demo:latest'));
  assert.ok(!source.includes('demo:old') && !source.includes('demo:middle'));
  await utimes(out, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
  const before = (await stat(out)).mtimeMs;
  await generator.update([schema({ latest: '{count, number} changed text' })]);
  assert.equal((await stat(out)).mtimeMs, before);
  await generator.stop(); await generator.stop();
  await assert.rejects(generator.update([schema({ ignored: 'Text' })]), /stopped/);
  assert.deepEqual(await readdir(root), ['generated.d.ts']);
});

test('unchanged schemas restore deleted or overwritten output without changing the declaration', async t => {
  const root = await directory(t);
  const out = path.join(root, 'generated.d.ts');
  const generator = new TypeGenerator(out);
  t.after(() => generator.stop());
  const schemas = [schema({ greeting: 'Hello {name}' })];
  await generator.update(schemas);
  const original = await readFile(out, 'utf8');
  await rm(out);
  await generator.update([schema({ greeting: 'Changed text {name}' })]);
  assert.equal(await readFile(out, 'utf8'), original);
  await writeFile(out, 'overwritten declaration');
  await generator.update(schemas);
  assert.equal(await readFile(out, 'utf8'), original);
  await rm(out);
  await Promise.all([generator.update(schemas), generator.update([schema({ temporary: 'Temporary' })]), generator.update(schemas)]);
  assert.equal(await readFile(out, 'utf8'), original, 'Returning to the cached schema still finishes file recovery');
  await generator.stop();
  assert.deepEqual(await readdir(root), ['generated.d.ts']);
});

test('a newer schema supersedes cached-output recovery and stop cancels outstanding recovery', async t => {
  const root = await directory(t);
  const out = path.join(root, 'generated.d.ts');
  const generator = new TypeGenerator(out);
  t.after(() => generator.stop());
  const schemas = [schema({ old: 'Old' })];
  await generator.update(schemas);
  await rm(out);
  await Promise.all([generator.update(schemas), generator.update([schema({ latest: '{count, number}' })])]);
  const latest = await readFile(out, 'utf8');
  assert.ok(latest.includes('demo:latest') && !latest.includes('demo:old'));
  await rm(out);
  const recovery = generator.update([schema({ latest: '{count, number} edited' })]);
  const rejected = assert.rejects(recovery, /stopped/);
  await generator.stop();
  await rejected;
  assert.deepEqual(await readdir(root), []);
});

test('worker failures retain the previous declaration and allow retry', async t => {
  const root = await directory(t);
  const out = path.join(root, 'generated.d.ts');
  const generator = new TypeGenerator(out);
  t.after(() => generator.stop());
  await generator.update([schema({ good: 'Text' })]);
  const previous = await readFile(out, 'utf8');
  await assert.rejects(generator.update([schema({ a: 'A' }), schema({ b: 'B' })]), /Duplicate namespace/);
  assert.equal(await readFile(out, 'utf8'), previous);
  await generator.update([schema({ recovered: 'Text' })]);
  assert.ok((await readFile(out, 'utf8')).includes('demo:recovered'));
});

test('CLI validates fresh disk catalogs before changing output', async t => {
  const root = await directory(t);
  const locales = path.join(root, 'locales');
  const out = path.join(root, 'generated.d.ts');
  for (const locale of ['ko', 'en']) await mkdir(path.join(locales, locale), { recursive: true });
  await writeFile(path.join(locales, 'ko', 'demo.json'), '{"title":"기준"}');
  await writeFile(path.join(locales, 'en', 'demo.json'), '{"title":"Translation"}');
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const run = () => spawnSync(process.execPath, [cli, '--locales-dir', locales, '--base-locale', 'ko', '--out-file', out], { encoding: 'utf8' });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const before = await readFile(out, 'utf8');
  await writeFile(path.join(locales, 'en', 'demo.json'), '{"unknown":"Wrong"}');
  assert.equal(run().status, 1);
  assert.equal(await readFile(out, 'utf8'), before);
});

test('CLI help works without reading catalogs or writing an output', async t => {
  const root = await directory(t);
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  for (const help of ['--help', '-h']) {
    const result = spawnSync(process.execPath, [cli, help, '--locales-dir', path.join(root, 'missing')], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /--out-file.*\.d\.ts/);
    assert.match(result.stdout, /--help, -h/);
    assert.match(result.stdout, /Example:/);
    assert.deepEqual(await readdir(root), []);
  }
});

test('CLI validates options before disk reads and preserves existing files on usage errors', async t => {
  const root = await directory(t);
  const missing = path.join(root, 'missing');
  const output = path.join(root, 'generated.d.ts');
  const catalog = path.join(root, 'demo.json');
  await writeFile(output, 'Existing declaration');
  await writeFile(catalog, '{"title":"Untouched"}');
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const cases = [
    { args: [], message: /required/ },
    { args: ['--unknown'], message: /Unknown option/ },
    { args: ['--locales-dir', missing, '--base-locale', 'ko', '--out-file', catalog], message: /--out-file must end in \.d\.ts/ },
    { args: ['--locales-dir', missing, '--base-locale', 'not_a_locale', '--out-file', output], message: /--base-locale.*BCP.?47/ },
  ];
  for (const { args, message } of cases) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, message);
    assert.match(result.stderr, /saylo-typegen --help/);
    assert.doesNotMatch(result.stderr, /ENOENT|at file:\/\//);
    assert.equal(await readFile(output, 'utf8'), 'Existing declaration');
    assert.equal(await readFile(catalog, 'utf8'), '{"title":"Untouched"}');
    assert.deepEqual((await readdir(root)).sort(), ['demo.json', 'generated.d.ts']);
  }
});
