import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inspectProject } from '../dist/catalog-audit.js';
import { applyReviewApprovals } from '../dist/catalog-approvals.js';
import { createReviewBaseline, compareReviewBaseline } from '../dist/catalog-review.js';
import { createTranslationWorkfile, parseTranslationWorkfile } from '../dist/catalog-workfile.js';
import { refreshTranslationWorkfile } from '../dist/catalog-refresh.js';
import { planTranslationImport } from '../dist/catalog-import.js';
import { planReviewApproval } from '../dist/catalog-approve.js';

const cli = fileURLToPath(new URL('../dist/catalog-cli.js', import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-refresh-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('saylo-refresh-'));
    await rm(root, { recursive: true, force: true });
  });
  const config = { localesDir: path.join(root, 'locales'), baseLocale: 'ko', checkLocales: ['en', 'fr'] };
  const write = async (locale, messages, namespace = 'common') => {
    await mkdir(path.join(config.localesDir, locale), { recursive: true });
    await writeFile(path.join(config.localesDir, locale, `${namespace}.json`), JSON.stringify(messages));
  };
  await write('ko', { title: '원문', empty: '빈 값', pending: '진행 중' });
  await write('en', { title: 'English', empty: '', pending: 'Pending' });
  const ledger = { format: 'saylo-review-approvals/v1', baseLocale: 'ko', entries: [] };
  const inspect = async (extra = {}) => {
    const checked = await inspectProject({ ...config, ...extra });
    return { ...checked, report: applyReviewApprovals(checked.inspection, checked.report, ledger) };
  };
  const initial = await inspect();
  const work = createTranslationWorkfile(initial.inspection, initial.report);
  const refresh = async (previous = work, extra = {}) => {
    const current = await inspect(extra);
    return refreshTranslationWorkfile(current.inspection, current.report, previous);
  };
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  await writeFile(path.join(root, 'saylo.config.json'), JSON.stringify(config));
  return { root, config, write, initial, work, ledger, inspect, refresh, run };
}
const key = entry => `${entry.locale}/${entry.namespace}/${entry.id}`;
const find = (work, locale, id) => work.entries.find(entry => entry.locale === locale && entry.id === id);
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('refresh preserves drafts, null and empty strings, adds fresh tasks, and never mutates its input', async t => {
  const f = await fixture(t);
  find(f.work, 'en', 'title').translation = 'My draft';
  find(f.work, 'en', 'empty').translation = null;
  find(f.work, 'fr', 'empty').translation = '';
  const saved = JSON.stringify(f.work);
  freeze(f.work);
  await f.write('ko', { title: '원문', empty: '빈 값', pending: '진행 중', added: '새 항목' });
  const result = await f.refresh();
  assert.equal(result.blocked, false);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.workfile.entries.length, 8);
  assert.equal(find(result.workfile, 'en', 'title').translation, 'My draft');
  assert.equal(find(result.workfile, 'en', 'empty').translation, null);
  assert.equal(find(result.workfile, 'fr', 'empty').translation, '');
  assert.equal(find(result.workfile, 'en', 'added').translation, null);
  assert.equal(JSON.stringify(f.work), saved);
  assert.deepEqual(parseTranslationWorkfile(JSON.stringify(result.workfile), 'ko'), result.workfile);
  const again = await f.refresh(result.workfile);
  assert.deepEqual(again.workfile, result.workfile);
  const reversed = await f.refresh({ ...f.work, entries: [...f.work.entries].reverse() });
  assert.deepEqual(reversed, result);
});

test('refresh preserves drafts even when a refreshed baseline produces no new export task', async t => {
  const f = await fixture(t);
  const work = { ...f.work, entries: f.work.entries.filter(entry => entry.locale === 'en') };
  find(work, 'en', 'title').translation = 'Draft after baseline refresh';
  const current = await inspectProject(f.config);
  const baseline = createReviewBaseline(current.inspection, 'ko');
  const report = compareReviewBaseline(current.inspection, current.report, baseline);
  const result = refreshTranslationWorkfile(current.inspection, report, work);
  assert.equal(result.blocked, false);
  assert.equal(find(result.workfile, 'en', 'title').translation, 'Draft after baseline refresh');
});

test('changed/deleted sources and competing translations are preserved only as explicit conflicts', async t => {
  const f = await fixture(t);
  find(f.work, 'en', 'title').translation = 'Draft title';
  find(f.work, 'en', 'empty').translation = 'Draft deleted source';
  find(f.work, 'en', 'pending').translation = 'Draft pending';
  await f.write('ko', { title: 'Changed source', pending: '진행 중' });
  await f.write('en', { title: 'Draft title', empty: '', pending: 'Concurrent translation' });
  const result = await f.refresh();
  assert.equal(result.blocked, true);
  assert.equal(result.conflicts.find(conflict => key(conflict.previous) === 'en/common/title').code, 'SOURCE_CONFLICT');
  assert.equal(result.conflicts.find(conflict => key(conflict.previous) === 'en/common/empty').code, 'SOURCE_REMOVED');
  const competing = result.conflicts.find(conflict => key(conflict.previous) === 'en/common/pending');
  assert.equal(competing.code, 'TRANSLATION_CONFLICT');
  assert.equal(competing.previous.translation, 'Draft pending');
  assert.equal(competing.current.originalTranslation, 'Concurrent translation');
  assert.equal(competing.current.translation, null);
  for (const conflict of result.conflicts) {
    assert.ok(!result.workfile.entries.some(entry => key(entry) === key(conflict.previous)));
    assert.deepEqual(conflict.previous, f.work.entries.find(entry => key(entry) === key(conflict.previous)));
    if (conflict.code === 'SOURCE_REMOVED') assert.equal(conflict.current, null);
  }
  assert.equal(result.alreadyApplied.length, 0); // A matching translation cannot hide a changed source.
  assert.ok(result.report.diagnostics.some(issue => issue.code === 'UNKNOWN_MESSAGE'));
});

test('a removed source namespace leaves drafts in removal conflicts and orphan catalogs untouched', async t => {
  const f = await fixture(t);
  await rm(path.join(f.config.localesDir, 'ko/common.json'));
  await f.write('ko', { next: 'New namespace' }, 'next');
  const result = await f.refresh();
  assert.equal(result.blocked, true);
  assert.equal(result.conflicts.length, 6);
  assert.ok(result.conflicts.every(conflict => conflict.code === 'SOURCE_REMOVED' && conflict.current === null));
  assert.ok(result.workfile.entries.every(entry => entry.namespace === 'next'));
  assert.ok(result.report.diagnostics.some(issue => issue.code === 'NAMESPACE_MISMATCH'));
  assert.equal(JSON.parse(await readFile(path.join(f.config.localesDir, 'en/common.json'), 'utf8')).title, 'English');
});

test('rich-only source changes, translation deletions and removed targets also conflict', async t => {
  const f = await fixture(t);
  const rich = await f.refresh(f.work, { richText: { common: { title: ['link'] } } });
  assert.ok(rich.conflicts.some(conflict => conflict.code === 'SOURCE_CONFLICT' && conflict.previous.id === 'title'));
  await f.write('en', { empty: '', pending: 'Pending' });
  const deleted = await f.refresh();
  assert.ok(deleted.conflicts.some(conflict => conflict.code === 'TRANSLATION_CONFLICT' && conflict.previous.locale === 'en' && conflict.previous.id === 'title'));
  const restricted = await f.refresh(f.work, { checkLocales: ['en'] });
  const conflicts = restricted.conflicts.filter(conflict => conflict.previous.locale === 'fr');
  assert.equal(conflicts.length, 3);
  assert.ok(conflicts.every(conflict => conflict.code === 'UNKNOWN_TARGET' && conflict.current === null));
});

test('already imported drafts stay usable for explicit approval and are no-ops for import', async t => {
  const f = await fixture(t);
  find(f.work, 'en', 'title').translation = 'Applied title';
  find(f.work, 'fr', 'empty').translation = '';
  await f.write('en', { title: 'Applied title', empty: '', pending: 'Pending' });
  await f.write('fr', { empty: '' });
  const result = await f.refresh();
  assert.equal(result.blocked, false);
  assert.deepEqual(result.alreadyApplied.map(key), ['en/common/title', 'fr/common/empty']);
  assert.equal(find(result.workfile, 'en', 'title').originalTranslation, 'Applied title');
  assert.equal(find(result.workfile, 'fr', 'empty').originalTranslation, '');
  const current = await f.inspect();
  const plan = planTranslationImport(current.inspection, current.report, f.config, result.workfile);
  assert.equal(plan.report.blocked, false);
  assert.equal(plan.files.length, 0);
  const approval = planReviewApproval(current.inspection, current.report, result.workfile,
    { file: path.join(f.root, 'reviews.json'), source: null, approvals: f.ledger });
  assert.equal(approval.report.blocked, false);
  assert.ok(approval.report.changes.some(entry => entry.locale === 'en' && entry.id === 'title'));
});

test('invalid catalogs produce a blocked report without a seemingly importable workfile', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.config.localesDir, 'en/common.json'), '{broken');
  const result = await f.refresh();
  assert.equal(result.blocked, true);
  assert.equal(result.workfile, null);
  assert.ok(result.report.diagnostics.some(issue => issue.severity === 'error'));
});

test('refresh CLI emits one JSON report and leaves work, catalogs, approvals, baseline and types untouched', async t => {
  const f = await fixture(t);
  find(f.work, 'en', 'title').translation = 'CLI draft';
  await writeFile(path.join(f.root, 'work.json'), JSON.stringify(f.work));
  await writeFile(path.join(f.root, 'reviews.json'), JSON.stringify(f.ledger));
  await writeFile(path.join(f.root, 'baseline.json'), JSON.stringify(createReviewBaseline(f.initial.inspection, 'ko')));
  await writeFile(path.join(f.root, 'generated.d.ts'), '// Keep types');
  const snapshot = async () => {
    const names = (await readdir(f.root, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile());
    return Promise.all(names.map(async entry => {
      const filename = path.join(entry.parentPath, entry.name);
      return [path.relative(f.root, filename), await readFile(filename, 'utf8')];
    }));
  };
  const before = await snapshot();
  const result = f.run(['refresh', '--file', 'work.json', '--reviews', 'reviews.json', '--baseline', 'baseline.json']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.format, 'saylo-translation-refresh/v1');
  assert.equal(find(report.workfile, 'en', 'title').translation, 'CLI draft');
  await writeFile(path.join(f.root, 'candidate.json'), JSON.stringify(report.workfile));
  const preview = f.run(['import', '--file', 'candidate.json', '--dry-run', '--json']);
  assert.equal(preview.status, 0, preview.stdout);
  await rm(path.join(f.root, 'candidate.json'));
  assert.deepEqual(await snapshot(), before);
  await f.write('ko', { title: 'Changed source', empty: '빈 값', pending: '진행 중' });
  const conflict = f.run(['refresh', '--file', 'work.json', '--reviews', 'reviews.json']);
  assert.equal(conflict.status, 1, conflict.stdout);
  assert.ok(JSON.parse(conflict.stdout).conflicts.some(entry => entry.code === 'SOURCE_CONFLICT'));
  await writeFile(path.join(f.config.localesDir, 'en/common.json'), '{broken');
  const blocked = f.run(['refresh', '--file', 'work.json']);
  assert.equal(blocked.status, 1);
  assert.equal(JSON.parse(blocked.stdout).workfile, null);
});

test('refresh validates usage/workfile errors and bootstraps missing approvals without creating a ledger', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'work.json'), JSON.stringify(f.work));
  const result = f.run(['refresh', '--file', 'work.json', '--reviews', 'new-reviews.json']);
  assert.equal(result.status, 0, result.stdout);
  await assert.rejects(readFile(path.join(f.root, 'new-reviews.json')), { code: 'ENOENT' });
  for (const args of [['refresh'], ['refresh', '--file', 'work.json', '--apply'], ['refresh', '--file', 'work.json', '--dry-run'],
    ['refresh', '--file', 'absent.json'], ['refresh', '--file', 'work.json', '--baseline', 'absent.json']]) {
    const failed = f.run([...args, '--json']);
    assert.equal(failed.status, 2, failed.stdout + failed.stderr);
    assert.equal(JSON.parse(failed.stdout).format, 'saylo-command-error/v1');
  }
  await writeFile(path.join(f.root, 'bad.json'), JSON.stringify({ ...f.work, entries: [f.work.entries[0], f.work.entries[0]] }));
  assert.equal(f.run(['refresh', '--file', 'bad.json']).status, 2);
  assert.equal(f.run(['refresh', '--config', 'absent.json', '--help']).status, 0);
});
