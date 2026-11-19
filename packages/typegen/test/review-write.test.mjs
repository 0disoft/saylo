import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectProject } from '../dist/catalog-audit.js';
import { applyReviewApprovals, readReviewApprovals } from '../dist/catalog-approvals.js';
import { createTranslationWorkfile } from '../dist/catalog-workfile.js';
import { planReviewApproval } from '../dist/catalog-approve.js';
import { writeReviewApproval } from '../dist/review-write.js';
import { replaceGenerated } from '../dist/replace.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-review-write-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('saylo-review-write-'));
    await rm(root, { recursive: true, force: true });
  });
  for (const locale of ['ko', 'en']) {
    await mkdir(path.join(root, 'locales', locale), { recursive: true });
    await writeFile(path.join(root, 'locales', locale, 'common.json'), JSON.stringify({ title: `${locale} title` }));
  }
  const config = { localesDir: path.join(root, 'locales'), baseLocale: 'ko' };
  const inspected = await inspectProject(config);
  const ledger = await readReviewApprovals(path.join(root, 'reviews.json'), 'ko', true);
  const report = applyReviewApprovals(inspected.inspection, inspected.report, ledger.approvals);
  const work = createTranslationWorkfile(inspected.inspection, report);
  const plan = planReviewApproval(inspected.inspection, inspected.report, work, ledger);
  const clean = async () => assert.ok(!(await readdir(root)).some(name => name.includes('.saylo-review')));
  return { root, plan, ledger, clean, inspection: inspected.inspection, report: inspected.report, work };
}

test('approval plans read only the relevant source hashes and keep conflict precedence', async t => {
  const f = await fixture(t);
  const base = f.inspection.files.find(file => file.catalog.locale === 'ko');
  const message = base.catalog.messages.title;
  let unrelatedReads = 0;
  const unrelated = Object.freeze({ ...message,
    get richTextTags() { unrelatedReads++; return message.richTextTags; } });
  const extra = Object.freeze({ ...base, catalog: Object.freeze({ ...base.catalog, namespace: 'unrelated',
    messages: Object.freeze({ title: unrelated }) }) });
  const inspection = Object.freeze({ ...f.inspection, files: Object.freeze([...f.inspection.files, extra]) });
  const draft = f.work.entries[0];
  const entries = Object.freeze([
    Object.freeze({ ...draft, locale: 'unknown', sourceHash: 'stale', translation: 'stale' }),
    Object.freeze({ ...draft, sourceHash: 'stale', translation: 'stale' }),
    Object.freeze({ ...draft, translation: 'stale' }),
    Object.freeze({ ...draft }),
  ]);
  const ledger = Object.freeze({ ...f.ledger, approvals: Object.freeze({ ...f.ledger.approvals, entries: Object.freeze([]) }) });
  const plan = planReviewApproval(inspection, f.report, Object.freeze({ ...f.work, entries }), ledger);
  assert.deepEqual(plan.report.diagnostics.map(issue => issue.code), ['UNKNOWN_TARGET', 'SOURCE_CONFLICT', 'TRANSLATION_CONFLICT']);
  assert.equal(plan.report.blocked, true);
  assert.deepEqual(plan.approvals, f.plan.approvals);
  assert.deepEqual(plan.guards, f.plan.guards);
  assert.equal(unrelatedReads, 0);
});

test('source or translation edits during approval staging cannot commit a stale approval', async t => {
  for (const locale of ['ko', 'en']) {
    const f = await fixture(t);
    await assert.rejects(writeReviewApproval(f.plan, { replace: async (...args) => {
      await writeFile(path.join(f.root, 'locales', locale, 'common.json'), '{"title":"Edited while approving"}');
      return replaceGenerated(...args);
    } }), error => error.writtenFiles.length === 0 && /changed during import/.test(error.message));
    await assert.rejects(readFile(f.ledger.file), { code: 'ENOENT' });
    await f.clean();
  }
});

test('a concurrently changed approval file is preserved instead of being overwritten', async t => {
  const f = await fixture(t), concurrent = JSON.stringify(f.ledger.approvals);
  await assert.rejects(writeReviewApproval(f.plan, { replace: async (...args) => {
    await writeFile(f.ledger.file, concurrent); return replaceGenerated(...args);
  } }), error => error.writtenFiles.length === 0);
  assert.equal(await readFile(f.ledger.file, 'utf8'), concurrent);
  await f.clean();
});

test('per-file review locks exclude a concurrent approval without removing the active owners lock', async t => {
  const f = await fixture(t);
  let enter, release;
  const started = new Promise(resolve => { enter = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  const first = writeReviewApproval(f.plan, { replace: async (...args) => {
    enter(); await resume; return replaceGenerated(...args);
  } });
  try {
    await started;
    await assert.rejects(writeReviewApproval(f.plan), /Cannot acquire review lock/);
    assert.equal(JSON.parse(await readFile(path.join(f.root, '.reviews.json.saylo-review.lock'), 'utf8')).pid, process.pid);
  } finally { release(); await first; }
  assert.equal(JSON.parse(await readFile(f.ledger.file, 'utf8')).entries.length, 1);
  await f.clean();
});

test('cancellation after staging leaves the review file absent and removes owned handles and temporary files', async t => {
  const f = await fixture(t), controller = new AbortController();
  await assert.rejects(writeReviewApproval(f.plan, { signal: controller.signal, replace: async (...args) => {
    controller.abort(); return replaceGenerated(...args);
  } }), error => error.writtenFiles.length === 0);
  await assert.rejects(readFile(f.ledger.file), { code: 'ENOENT' });
  await f.clean();
});
