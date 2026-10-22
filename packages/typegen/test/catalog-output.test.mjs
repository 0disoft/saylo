import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { link, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CatalogOutputError, writeCatalogOutput } from '../dist/catalog-output.js';
import { inspectProject } from '../dist/catalog-audit.js';
import { createTranslationWorkfile } from '../dist/catalog-workfile.js';

const cli = fileURLToPath(new URL('../dist/catalog-cli.js', import.meta.url));
const preload = new URL('./helpers/cli-cancellation-preload.mjs', import.meta.url).href;
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-output-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('saylo-output-'));
    await rm(root, { recursive: true, force: true });
  });
  const config = { localesDir: path.join(root, 'locales'), baseLocale: 'ko', checkLocales: ['en'] };
  await mkdir(path.join(config.localesDir, 'ko'), { recursive: true });
  await writeFile(path.join(config.localesDir, 'ko/common.json'), '{"title":"Source"}');
  const checked = await inspectProject(config);
  const work = createTranslationWorkfile(checked.inspection, checked.report);
  work.entries[0].translation = 'Draft';
  await writeFile(path.join(root, 'work.json'), JSON.stringify(work));
  await writeFile(path.join(root, 'saylo.config.json'), JSON.stringify(config));
  const run = (args, phase) => spawnSync(process.execPath,
    [...(phase ? ['--import', preload] : []), cli, ...args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000,
      env: { ...process.env, SAYLO_CANCEL_PHASE: phase ?? 'none', SAYLO_CANCEL_SIGNAL: 'SIGINT' } });
  const target = path.join(root, 'output.json');
  const clean = async () => assert.ok(!(await readdir(root, { recursive: true })).some(name => name.includes('.saylo-output-')));
  return { root, config, work, run, target, options: { localesDir: config.localesDir }, clean };
}

test('new artifacts are complete before publication and a racing target is never overwritten', async t => {
  const f = await fixture(t), value = { format: 'test/v1', messages: ['한글', ''] };
  const files = await writeCatalogOutput(f.target, value, { ...f.options, publish: async (temp, target) => {
    assert.deepEqual(JSON.parse(await readFile(temp, 'utf8')), value);
    await assert.rejects(readFile(target), { code: 'ENOENT' });
    await link(temp, target);
  } });
  assert.deepEqual(files, [f.target]);
  assert.deepEqual(JSON.parse(await readFile(f.target, 'utf8')), value);
  await f.clean();
  const race = path.join(f.root, 'race.json');
  await assert.rejects(writeCatalogOutput(race, value, { ...f.options, publish: async (temp, target) => {
    await writeFile(target, 'concurrent owner', { flag: 'wx' }); await link(temp, target);
  } }), error => error instanceof CatalogOutputError && error.writtenFiles.length === 0 && error.cause.code === 'EEXIST');
  assert.equal(await readFile(race, 'utf8'), 'concurrent owner');
  await f.clean();
});

test('existing outputs, protected inputs, catalog paths, missing parents and symlinks are refused unchanged', async t => {
  const f = await fixture(t);
  await writeFile(f.target, 'keep original');
  for (const target of [f.target, path.join(f.config.localesDir, 'new.json'), path.join(f.root, 'missing/new.json'), path.join(f.root, 'new.txt')])
    await assert.rejects(writeCatalogOutput(target, {}, f.options));
  const reserved = path.join(f.root, 'reserved.json');
  await assert.rejects(writeCatalogOutput(reserved, {}, { ...f.options, protectedFiles: [reserved] }), /input file/);
  assert.equal(await readFile(f.target, 'utf8'), 'keep original');
  const alias = path.join(f.root, 'alias');
  await symlink(f.config.localesDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(writeCatalogOutput(path.join(alias, 'new.json'), {}, f.options), /non-symlink/);
  const fileLink = path.join(f.root, 'alias.json');
  await symlink(f.target, fileLink);
  await assert.rejects(writeCatalogOutput(fileLink, {}, f.options), /symlink/);
  await f.clean();
});

test('publish failure or cancellation before publication cleans temps, while cancellation after publication keeps the complete result', async t => {
  const f = await fixture(t), controller = new AbortController(), failure = new Error('no hard-link support');
  await assert.rejects(writeCatalogOutput(f.target, {}, { ...f.options, publish: async () => { throw failure; } }),
    error => error.cause === failure && error.writtenFiles.length === 0);
  await f.clean();
  controller.abort(new Error('cancel before start'));
  await assert.rejects(writeCatalogOutput(f.target, {}, { ...f.options, signal: controller.signal }), error => error.cause === controller.signal.reason);
  await assert.rejects(readFile(f.target), { code: 'ENOENT' });
  const late = new AbortController();
  const files = await writeCatalogOutput(f.target, { complete: true }, { ...f.options, signal: late.signal, publish: async (...args) => {
    await link(...args); late.abort();
  } });
  assert.deepEqual(files, [f.target]);
  assert.deepEqual(JSON.parse(await readFile(f.target, 'utf8')), { complete: true });
  await f.clean();
});

test('all three commands save their original payload and return a single machine-readable receipt', async t => {
  const f = await fixture(t);
  for (const command of ['export', 'snapshot', 'refresh']) {
    const args = [command, ...(command === 'refresh' ? ['--file', 'work.json'] : [])];
    const original = f.run(args);
    assert.equal(original.status, 0, original.stdout);
    const filename = `${command}.json`, saved = f.run([...args, '--out-file', filename]);
    assert.equal(saved.status, 0, saved.stdout + saved.stderr);
    assert.deepEqual(JSON.parse(saved.stdout), { format: 'saylo-file-output/v1', command, writtenFiles: [path.join(f.root, filename)], blocked: false });
    assert.deepEqual(JSON.parse(await readFile(path.join(f.root, filename), 'utf8')), JSON.parse(original.stdout));
    const before = await readFile(path.join(f.root, filename), 'utf8');
    assert.equal(f.run([...args, '--out-file', filename]).status, 2);
    assert.equal(await readFile(path.join(f.root, filename), 'utf8'), before);
  }
  const contextual = f.run(['export', '--with-context', '--out-file', 'context.json']);
  assert.equal(contextual.status, 0, contextual.stdout);
  assert.equal(JSON.parse(await readFile(path.join(f.root, 'context.json'), 'utf8')).format, 'saylo-translation-work/v2');
  await f.clean();
});

test('validation failures never create outputs, but refresh conflicts can be saved without overwriting the input', async t => {
  const f = await fixture(t);
  const input = await readFile(path.join(f.root, 'work.json'), 'utf8');
  await writeFile(path.join(f.config.localesDir, 'ko/common.json'), '{"title":"Changed source"}');
  const conflict = f.run(['refresh', '--file', 'work.json', '--out-file', 'conflicts.json']);
  assert.equal(conflict.status, 1, conflict.stdout);
  assert.equal(JSON.parse(conflict.stdout).blocked, true);
  assert.equal(JSON.parse(await readFile(path.join(f.root, 'conflicts.json'), 'utf8')).conflicts[0].code, 'SOURCE_CONFLICT');
  assert.equal(await readFile(path.join(f.root, 'work.json'), 'utf8'), input);
  assert.equal(f.run(['refresh', '--file', 'work.json', '--out-file', 'work.json']).status, 2);
  await writeFile(path.join(f.config.localesDir, 'ko/common.json'), '{broken');
  for (const command of ['export', 'snapshot', 'refresh']) {
    const filename = `bad-${command}.json`;
    const result = f.run([command, ...(command === 'refresh' ? ['--file', 'work.json'] : []), '--out-file', filename]);
    assert.equal(result.status, 1, result.stdout);
    await assert.rejects(readFile(path.join(f.root, filename)), { code: 'ENOENT' });
  }
  await f.clean();
});

test('snapshot can initialize its configured baseline, and invalid output flags fail without reading disk', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'saylo.config.json'), JSON.stringify({ ...f.config, baseline: 'baseline.json' }));
  assert.equal(f.run(['snapshot', '--out-file', 'baseline.json']).status, 0);
  assert.equal(JSON.parse(await readFile(path.join(f.root, 'baseline.json'), 'utf8')).format, 'saylo-review-baseline/v1');
  for (const args of [['check'], ['sync', '--dry-run'], ['import', '--file', 'work.json', '--apply'], ['approve', '--file', 'work.json', '--apply']])
    assert.equal(f.run([...args, '--out-file', 'new.json', '--config', 'absent.json', '--json']).status, 2);
  const invalid = f.run(['export', '--out-file', 'new.txt', '--config', 'absent.json', '--json']);
  assert.match(JSON.parse(invalid.stdout).error.message, /new .json/);
  assert.equal(f.run(['export', '--out-file', 'new.json', '--config', 'absent.json', '--help']).status, 0);
});

test('CLI output cancellation cleans staged files and reports already-published artifacts accurately', async t => {
  for (const phase of ['stage', 'publish']) {
    const f = await fixture(t), filename = `cancel-${phase}.json`;
    const result = f.run(['export', '--out-file', filename], phase);
    assert.equal(result.status, 130, result.stdout + result.stderr);
    const error = JSON.parse(result.stdout).error;
    assert.equal(error.cancelled, true);
    assert.deepEqual(error.writtenFiles, phase === 'publish' ? [path.join(f.root, filename)] : []);
    if (phase === 'stage') await assert.rejects(readFile(path.join(f.root, filename)), { code: 'ENOENT' });
    else assert.equal(JSON.parse(await readFile(path.join(f.root, filename), 'utf8')).format, 'saylo-translation-work/v1');
    await f.clean();
  }
});
