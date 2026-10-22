import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inspectProject } from '../dist/catalog-audit.js';
import { createReviewBaseline, compareReviewBaseline } from '../dist/catalog-review.js';
import { applyReviewApprovals, parseReviewApprovals, translationHash } from '../dist/catalog-approvals.js';

const cli = fileURLToPath(new URL('../dist/catalog-cli.js', import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-approvals-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('saylo-approvals-'));
    await rm(root, { recursive: true, force: true });
  });
  const config = { localesDir: path.join(root, 'locales'), baseLocale: 'ko', checkLocales: ['en', 'fr'] };
  const write = async (locale, messages) => {
    await mkdir(path.join(config.localesDir, locale), { recursive: true });
    await writeFile(path.join(config.localesDir, locale, 'common.json'), JSON.stringify(messages));
  };
  await write('ko', { title: '원문', same: '동일' });
  for (const locale of ['en', 'fr']) await write(locale, { title: `${locale} title`, same: `${locale} same` });
  const inspected = await inspectProject(config);
  const baseline = createReviewBaseline(inspected.inspection, 'ko');
  const entry = (locale, id = 'title', inspection = inspected.inspection) => ({ locale, namespace: 'common', id,
    sourceHash: createReviewBaseline(inspection, 'ko').messages[`common:${id}`],
    translationHash: translationHash(inspection.files.find(file => file.catalog.locale === locale).catalog.messages[id]) });
  const ledger = entries => ({ format: 'saylo-review-approvals/v1', baseLocale: 'ko', entries });
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  await writeFile(path.join(root, 'saylo.config.json'), JSON.stringify(config));
  return { root, config, inspected, baseline, write, entry, ledger, run };
}

test('approvals remain per locale/key after a global baseline refresh and re-open on translation changes', async t => {
  const f = await fixture(t);
  await f.write('ko', { title: '수정된 원문', same: '동일' });
  let current = await inspectProject(f.config);
  const approvals = f.ledger([f.entry('en', 'title', current.inspection), f.entry('en', 'same'), f.entry('fr', 'same')]);
  let report = applyReviewApprovals(current.inspection, compareReviewBaseline(current.inspection, current.report, f.baseline), approvals);
  assert.deepEqual(report.diagnostics.map(issue => [issue.locale, issue.id, issue.code]), [['fr', 'title', 'SOURCE_CHANGED']]);
  const refreshed = createReviewBaseline(current.inspection, 'ko');
  report = applyReviewApprovals(current.inspection, compareReviewBaseline(current.inspection, current.report, refreshed), approvals);
  assert.deepEqual(report.diagnostics.map(issue => [issue.locale, issue.id, issue.code]), [['fr', 'title', 'REVIEW_REQUIRED']]);
  await f.write('en', { title: 'Edited English', same: 'en same' });
  current = await inspectProject(f.config);
  report = applyReviewApprovals(current.inspection, current.report, approvals);
  assert.ok(report.diagnostics.some(issue => issue.locale === 'en' && issue.id === 'title' && issue.code === 'TRANSLATION_CHANGED'));
  await f.write('ko', { title: '원문 다시 수정', same: '동일' });
  current = await inspectProject(f.config);
  report = applyReviewApprovals(current.inspection, current.report, approvals);
  assert.ok(report.diagnostics.some(issue => issue.locale === 'en' && issue.id === 'title' && issue.code === 'SOURCE_CHANGED'));
});

test('configured approvals feed check, sync and export without mutating the ledger or catalogs', async t => {
  const f = await fixture(t);
  const approvals = f.ledger([f.entry('en'), f.entry('en', 'same'), f.entry('fr', 'same')]);
  const filename = path.join(f.root, 'reviews.json');
  const original = JSON.stringify(approvals);
  await writeFile(filename, original);
  const check = f.run(['check', '--reviews', 'reviews.json', '--json']);
  assert.equal(check.status, 1, check.stdout + check.stderr);
  const report = JSON.parse(check.stdout);
  assert.equal(report.reviewTracking, 'approvals');
  assert.deepEqual(report.diagnostics.map(issue => [issue.locale, issue.id]), [['fr', 'title']]);
  const work = f.run(['export', '--reviews', 'reviews.json']);
  assert.equal(work.status, 0, work.stdout);
  assert.deepEqual(JSON.parse(work.stdout).entries.map(entry => [entry.locale, entry.id, entry.reason]), [['fr', 'title', 'review']]);
  const sync = f.run(['sync', '--dry-run', '--reviews', 'reviews.json', '--json']);
  assert.equal(sync.status, 0); assert.equal(JSON.parse(sync.stdout).changes[0].action, 'review');
  assert.equal(await readFile(filename, 'utf8'), original);
  assert.equal(f.run(['check', '--json']).status, 0); // No opt-in: historical baseline-only behavior stays intact.
  assert.equal(f.run(['check', '--reviews', 'missing.json', '--json']).status, 2);
  const bootstrap = f.run(['export', '--reviews', 'new-reviews.json']);
  assert.equal(bootstrap.status, 0); assert.equal(JSON.parse(bootstrap.stdout).entries.length, 4);
  await assert.rejects(readFile(path.join(f.root, 'new-reviews.json')), { code: 'ENOENT' });
});

test('approval documents reject duplicate or malformed identities, locale mismatches and invalid hashes', async t => {
  const f = await fixture(t), original = f.ledger([f.entry('en')]);
  assert.deepEqual(parseReviewApprovals(JSON.stringify(original), 'ko'), original);
  for (const alter of [value => { value.entries.push({ ...value.entries[0] }); },
    value => { value.baseLocale = 'en'; }, value => { value.entries[0].namespace = '../escape'; },
    value => { value.entries[0].locale = 'ko'; }, value => { value.entries[0].translationHash = 'bad'; },
    value => { value.entries[0].file = 'path.json'; }]) {
    const value = structuredClone(original); alter(value);
    assert.throws(() => parseReviewApprovals(JSON.stringify(value), 'ko'));
  }
});

test('explicit approval accepts unchanged translations, preserves other records, and never changes catalogs or baseline', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'baseline.json'), JSON.stringify(f.baseline));
  const oldBaseline = await readFile(path.join(f.root, 'baseline.json'), 'utf8');
  const reviews = path.join(f.root, 'reviews.json');
  const work = f.run(['export', '--reviews', 'reviews.json', '--locales', 'en']);
  assert.equal(work.status, 0, work.stdout);
  await writeFile(path.join(f.root, 'work.json'), work.stdout);
  const before = await readFile(path.join(f.config.localesDir, 'en/common.json'), 'utf8');
  const args = ['approve', '--reviews', 'reviews.json', '--file', 'work.json'];
  const preview = f.run([...args, '--dry-run', '--json']);
  assert.equal(preview.status, 0, preview.stdout); assert.equal(JSON.parse(preview.stdout).changes.length, 2);
  await assert.rejects(readFile(reviews), { code: 'ENOENT' });
  const applied = f.run([...args, '--apply', '--json']);
  assert.equal(applied.status, 0, applied.stdout); assert.equal(JSON.parse(applied.stdout).writtenFiles.length, 1);
  assert.equal(await readFile(path.join(f.config.localesDir, 'en/common.json'), 'utf8'), before);
  assert.equal(await readFile(path.join(f.root, 'baseline.json'), 'utf8'), oldBaseline);
  const ledger = JSON.parse(await readFile(reviews, 'utf8'));
  assert.equal(ledger.entries.length, 2); assert.ok(ledger.entries.every(entry => entry.locale === 'en'));
  const remaining = JSON.parse(f.run(['export', '--reviews', 'reviews.json']).stdout);
  assert.ok(remaining.entries.every(entry => entry.locale === 'fr'));
  remaining.entries.find(entry => entry.id === 'same').translation = null;
  await writeFile(path.join(f.root, 'fr-work.json'), JSON.stringify(remaining));
  assert.equal(f.run(['approve', '--reviews', 'reviews.json', '--file', 'fr-work.json', '--apply', '--json']).status, 0);
  const merged = JSON.parse(await readFile(reviews, 'utf8'));
  assert.equal(merged.entries.length, 3); assert.deepEqual(merged.entries.filter(entry => entry.locale === 'en'), ledger.entries);
  assert.equal(f.run([...args, '--apply', '--json']).status, 0);
  assert.deepEqual(JSON.parse(f.run([...args, '--apply', '--json']).stdout).writtenFiles, []);
});

test('approval rejects stale reviewed text, missing translations and unsafe usage before changing a ledger', async t => {
  const f = await fixture(t);
  const work = JSON.parse(f.run(['export', '--reviews', 'reviews.json', '--locales', 'en']).stdout);
  await writeFile(path.join(f.root, 'work.json'), JSON.stringify(work));
  const args = ['approve', '--reviews', 'reviews.json', '--file', 'work.json', '--apply', '--json'];
  await f.write('en', { title: 'Concurrent translation', same: 'en same' });
  let result = f.run(args);
  assert.equal(result.status, 1, result.stdout);
  assert.ok(JSON.parse(result.stdout).diagnostics.some(issue => issue.code === 'TRANSLATION_CONFLICT'));
  await assert.rejects(readFile(path.join(f.root, 'reviews.json')), { code: 'ENOENT' });
  await f.write('en', { title: 'en title', same: 'en same' });
  await f.write('ko', { title: 'Changed source', same: '동일' });
  result = f.run(args); assert.equal(result.status, 1);
  assert.ok(JSON.parse(result.stdout).diagnostics.some(issue => issue.code === 'SOURCE_CONFLICT'));
  await f.write('ko', { title: '원문', same: '동일' });
  await f.write('en', { same: 'en same' });
  result = f.run(args); assert.equal(result.status, 1);
  assert.ok(JSON.parse(result.stdout).diagnostics.some(issue => issue.code === 'TRANSLATION_CONFLICT'));
  for (const invalid of [['approve', '--file', 'work.json', '--apply'], ['approve', '--reviews', 'reviews.json', '--file', 'work.json'],
    ['approve', '--reviews', 'reviews.json', '--file', 'work.json', '--apply', '--dry-run'], ['import', '--reviews', 'reviews.json', '--file', 'work.json', '--apply']])
    assert.equal(f.run([...invalid, '--json']).status, 2);
  result = f.run(['approve', '--reviews', 'locales/.reviews.json', '--file', 'work.json', '--dry-run', '--json']);
  assert.equal(result.status, 1); assert.ok(JSON.parse(result.stdout).diagnostics.some(issue => issue.code === 'INVALID_REVIEW_PATH'));
});

test('configured reviews resolve relative to config and do not make import approve or erase stale records', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'saylo.config.json'), JSON.stringify({ ...f.config, reviews: 'reviews.json' }));
  const work = f.run(['export', '--locales', 'en']); assert.equal(work.status, 0);
  const completed = JSON.parse(work.stdout);
  completed.entries.find(entry => entry.id === 'title').translation = 'Revised en title';
  await writeFile(path.join(f.root, 'work.json'), JSON.stringify(completed));
  const imported = f.run(['import', '--file', 'work.json', '--apply', '--json']);
  assert.equal(imported.status, 0, imported.stdout);
  assert.equal(JSON.parse(await readFile(path.join(f.config.localesDir, 'en/common.json'), 'utf8')).title, 'Revised en title');
  await assert.rejects(readFile(path.join(f.root, 'reviews.json')), { code: 'ENOENT' });
  const approved = f.run(['approve', '--file', 'work.json', '--apply', '--json']);
  assert.equal(approved.status, 0, approved.stdout);
  assert.equal(JSON.parse(await readFile(path.join(f.root, 'reviews.json'), 'utf8')).entries.length, 2);
});
