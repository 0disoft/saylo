import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectProject } from '../dist/catalog-audit.js';
import { createTranslationWorkfile } from '../dist/catalog-workfile.js';
import { planTranslationImport } from '../dist/catalog-import.js';
import { applyTranslationImport } from '../dist/catalog-apply.js';
import { replaceGenerated } from '../dist/replace.js';

async function fixture(t, locales = ['en']) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-import-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('saylo-import-'));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'ko'));
  const base = path.join(root, 'ko/common.json');
  await writeFile(base, '{"title":"원문"}');
  const config = { localesDir: root, baseLocale: 'ko', checkLocales: locales };
  const inspected = await inspectProject(config);
  const work = createTranslationWorkfile(inspected.inspection, inspected.report);
  for (const entry of work.entries) entry.translation = `${entry.locale} title`;
  const plan = planTranslationImport(inspected.inspection, inspected.report, config, work);
  const assertClean = async () => {
    const names = await readdir(root, { recursive: true });
    assert.ok(!names.some(name => name.includes('.saylo-import')));
  };
  return { root, base, config, plan, assertClean };
}

test('an external edit between planning and rename blocks replacement and cleans owned resources', async t => {
  const f = await fixture(t);
  await assert.rejects(applyTranslationImport(f.plan, { replace: async (...args) => {
    await writeFile(f.base, '{"title":"Concurrent source edit"}');
    return replaceGenerated(...args);
  } }), error => error.writtenFiles.length === 0 && /Catalog changed during import/.test(error.message));
  await assert.rejects(readFile(path.join(f.root, 'en/common.json')), { code: 'ENOENT' });
  assert.match(await readFile(f.base, 'utf8'), /Concurrent source edit/);
  await f.assertClean();
});

test('a late I/O failure reports committed files and preserves their successful translations', async t => {
  const f = await fixture(t, ['en', 'fr']);
  const failure = new Error('Disk replacement failed');
  let replacements = 0;
  await assert.rejects(applyTranslationImport(f.plan, { replace: async (...args) => {
    if (++replacements === 2) throw failure;
    return replaceGenerated(...args);
  } }), error => error.cause === failure && JSON.stringify(error.writtenFiles) === JSON.stringify(['en/common.json']));
  assert.deepEqual(JSON.parse(await readFile(path.join(f.root, 'en/common.json'), 'utf8')), { title: 'en title' });
  await assert.rejects(readFile(path.join(f.root, 'fr/common.json')), { code: 'ENOENT' });
  await f.assertClean();
});

test('the root lock excludes concurrent Saylo imports without deleting the active owners lock', async t => {
  const f = await fixture(t);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  const first = applyTranslationImport(f.plan, { replace: async (...args) => {
    entered(); await resume; return replaceGenerated(...args);
  } });
  try {
    await started;
    await assert.rejects(applyTranslationImport(f.plan), /Cannot acquire import lock/);
    assert.equal(JSON.parse(await readFile(path.join(f.root, '.saylo-import.lock'), 'utf8')).pid, process.pid);
  } finally { release(); await first; }
  await f.assertClean();
});

test('cancellation after staging keeps catalogs unchanged and releases handles, temps and new directories', async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  await assert.rejects(applyTranslationImport(f.plan, { signal: controller.signal, replace: async (...args) => {
    controller.abort(new Error('Cancelled import')); return replaceGenerated(...args);
  } }), error => error.writtenFiles.length === 0);
  await assert.rejects(readFile(path.join(f.root, 'en/common.json')), { code: 'ENOENT' });
  assert.deepEqual((await readdir(f.root)).sort(), ['ko']);
  await f.assertClean();
});
