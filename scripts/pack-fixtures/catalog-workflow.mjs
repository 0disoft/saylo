import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

// Run only against the consumer's installed package and synthetic catalogs.
const installed = path.resolve('node_modules/@0disoft/saylo-typegen');
const manifest = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
const cli = path.resolve(installed, manifest.bin.saylo);
const typegen = path.resolve(installed, manifest.bin['saylo-typegen']);
const root = await mkdtemp(path.join(process.cwd(), '.catalog-workflow-'));
const exec = promisify(execFile);
async function run(args, expected = 0, entry = cli) {
  let result;
  try {
    result = await exec(process.execPath, [entry, ...args], {
      cwd: root, windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024,
    });
    assert.equal(expected, 0, `Expected exit ${expected}: ${args.join(' ')}`);
  } catch (error) {
    assert.equal(error.code, expected, `${args.join(' ')}: ${error.stdout ?? ''}\n${error.stderr ?? error.message}`);
    result = error;
  }
  assert.equal(result.stderr, '', `${args.join(' ')} wrote stderr`);
  return result.stdout;
}
const json = async (args, expected = 0) => JSON.parse(await run([...args, '--json'], expected));
const read = file => readFile(path.join(root, file), 'utf8');
const write = (file, value) => writeFile(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
async function snapshot() {
  const files = (await readdir(root, { recursive: true, withFileTypes: true })).filter(file => file.isFile())
    .map(file => path.join(file.parentPath, file.name)).sort();
  return Promise.all(files.map(async absolute => {
    return [path.relative(root, absolute), (await readFile(absolute)).toString('base64')];
  }));
}
try {
  await mkdir(path.join(root, 'locales/ko'), { recursive: true });
  await mkdir(path.join(root, 'locales/en'), { recursive: true });
  await write('saylo.config.json', { localesDir: 'locales', baseLocale: 'ko', checkLocales: ['en'] });
  const base = { title: '원문', greeting: '안녕 {name}', empty: '' };
  await write('locales/ko/common.json', base);
  await write('locales/en/common.json', '{\r\n\t"empty": ""\r\n}\r\n');
  const before = await snapshot();
  console.log('[pack] Catalog workflow: starting read-only check, sync and context export.');
  const checked = await json(['check'], 1);
  assert.ok(checked.diagnostics.some(issue => issue.code === 'MISSING_MESSAGE'));
  const sync = await json(['sync', '--dry-run']);
  assert.equal(sync.blocked, false); assert.equal(sync.changes.length, 2);
  assert.deepEqual(await snapshot(), before);

  const exported = await json(['export', '--with-context', '--out-file', 'work.json']);
  assert.equal(exported.writtenFiles.length, 1);
  const work = JSON.parse(await read('work.json'));
  assert.equal(work.format, 'saylo-translation-work/v2');
  assert.deepEqual(work.entries.find(entry => entry.id === 'greeting').context.arguments.name, ['number', 'string']);
  for (const entry of work.entries) entry.translation = entry.id === 'title' ? 'Title' : 'Hello {name}';
  await write('work.json', work);
  console.log('[pack] Catalog workflow: starting import diff, validation and format-preserving apply.');
  const staged = await snapshot();
  const preview = await json(['import', '--file', 'work.json', '--dry-run', '--diff']);
  assert.equal(preview.blocked, false); assert.equal(preview.changes.length, 2);
  assert.match(preview.diff, /--- a\/en\/common.json/);
  assert.match(preview.diff, /\+\t"greeting": "Hello \{name\}"/);
  assert.deepEqual(await snapshot(), staged);

  const invalid = structuredClone(work);
  invalid.entries.find(entry => entry.id === 'greeting').translation = 'Hello {wrong}';
  await write('invalid.json', invalid);
  const invalidBefore = await snapshot();
  assert.equal((await json(['import', '--file', 'invalid.json', '--apply'], 1)).blocked, true);
  assert.deepEqual(await snapshot(), invalidBefore);
  const applied = await json(['import', '--file', 'work.json', '--apply']);
  assert.deepEqual(applied.writtenFiles, ['en/common.json']);
  const english = await read('locales/en/common.json');
  assert.match(english, /^\{\r\n\t"empty": "",\r\n/);
  assert.ok(english.endsWith('\r\n')); assert.ok(!/(?<!\r)\n/.test(english));
  assert.deepEqual(JSON.parse(english), { empty: '', greeting: 'Hello {name}', title: 'Title' });
  assert.deepEqual((await json(['import', '--file', 'work.json', '--apply'])).writtenFiles, []);
  await json(['check']);
  await json(['snapshot', '--out-file', 'baseline.json']);
  const baseline = await read('baseline.json');
  console.log('[pack] Catalog workflow: starting stale source rejection and refresh.');

  await write('locales/ko/common.json', { ...base, title: '새 원문' });
  const staleBefore = await snapshot();
  const stale = await json(['import', '--file', 'work.json', '--apply'], 1);
  assert.ok(stale.diagnostics.some(issue => issue.code === 'SOURCE_CONFLICT'));
  const refreshed = await json(['refresh', '--file', 'work.json', '--baseline', 'baseline.json', '--with-context'], 1);
  assert.equal(refreshed.blocked, true);
  const conflict = refreshed.conflicts.find(item => item.previous.id === 'title');
  assert.equal(conflict.code, 'SOURCE_CONFLICT'); assert.equal(conflict.previous.translation, 'Title');
  assert.equal(conflict.current.source, '새 원문');
  assert.ok(!refreshed.workfile.entries.some(entry => entry.id === 'title'));
  assert.deepEqual(await snapshot(), staleBefore);
  refreshed.workfile.entries.push({ ...conflict.current, translation: 'Revised title' });
  await write('resolved.json', refreshed.workfile);
  await json(['import', '--file', 'resolved.json', '--apply']);
  const unapproved = await json(['check', '--baseline', 'baseline.json'], 1);
  assert.ok(unapproved.diagnostics.some(issue => issue.code === 'SOURCE_CHANGED'));
  console.log('[pack] Catalog workflow: starting explicit approval, reopening and declaration generation.');

  const reviewWork = await json(['export', '--reviews', 'reviews.json']);
  await write('review-work.json', reviewWork);
  const approvalArgs = ['approve', '--file', 'review-work.json', '--reviews', 'reviews.json'];
  const reviewBefore = await snapshot();
  assert.equal((await json([...approvalArgs, '--dry-run'])).changes.length, 3);
  assert.deepEqual(await snapshot(), reviewBefore);
  assert.equal((await json([...approvalArgs, '--apply'])).writtenFiles.length, 1);
  const approved = await read('locales/en/common.json');
  await json(['check', '--baseline', 'baseline.json', '--reviews', 'reviews.json']);
  assert.deepEqual((await json([...approvalArgs, '--apply'])).writtenFiles, []);
  assert.equal(await read('locales/en/common.json'), approved);
  assert.equal(await read('baseline.json'), baseline);
  await write('locales/en/common.json', { ...JSON.parse(approved), title: 'Unreviewed edit' });
  const reopened = await json(['check', '--reviews', 'reviews.json'], 1);
  assert.ok(reopened.diagnostics.some(issue => issue.code === 'TRANSLATION_CHANGED'));
  await run(['--config', 'saylo.config.json', '--out-file', 'generated.d.ts'], 0, typegen);
  assert.match(await read('generated.d.ts'), /common:greeting/);
  console.log('[pack] Installed catalog CLI: check/sync, v2 export, import diff/apply, CRLF preservation, stale conflict/refresh, explicit approval/reopening and typegen passed.');
} finally {
  assert.equal(path.dirname(root), process.cwd());
  assert.ok(path.basename(root).startsWith('.catalog-workflow-'));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
