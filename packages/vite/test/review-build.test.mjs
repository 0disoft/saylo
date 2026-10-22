import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'vite';
import saylo, { loadProjectConfig } from '../dist/index.js';
import { TranslationReviewError } from '@0disoft/saylo-typegen/review-check';
import { inspectProject } from '../../typegen/dist/catalog-audit.js';
import { applyReviewApprovals, readReviewApprovals } from '../../typegen/dist/catalog-approvals.js';
import { createTranslationWorkfile } from '../../typegen/dist/catalog-workfile.js';
import { planReviewApproval } from '../../typegen/dist/catalog-approve.js';
import { writeReviewApproval } from '../../typegen/dist/review-write.js';

async function replace(target, source) {
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.tmp`);
  await writeFile(temp, source); await rename(temp, target);
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-review-build-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('saylo-review-build-'));
    await rm(root, { recursive: true, force: true });
  });
  const config = { localesDir: path.join(root, 'locales'), baseLocale: 'ko' };
  const reviews = path.join(root, 'reviews.json');
  const write = async (locale, messages) => {
    await mkdir(path.join(config.localesDir, locale), { recursive: true });
    await writeFile(path.join(config.localesDir, locale, 'demo.json'), JSON.stringify(messages));
  };
  await write('ko', { title: 'ko title', hidden: 'ko hidden' });
  await write('en', { title: 'en title', hidden: 'en hidden' });
  await writeFile(path.join(root, 'main.js'), 'export const marker = "built";');
  const approve = async (filter = () => true, extra = {}) => {
    const inspected = await inspectProject({ ...config, ...extra });
    const ledger = await readReviewApprovals(reviews, 'ko', true);
    const report = applyReviewApprovals(inspected.inspection, inspected.report, ledger.approvals);
    const work = createTranslationWorkfile(inspected.inspection, report);
    await writeReviewApproval(planReviewApproval(inspected.inspection, inspected.report,
      { ...work, entries: work.entries.filter(filter) }, ledger));
  };
  const options = (extra = {}) => ({ configFile: false, root, logLevel: 'silent',
    plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', reviews: 'reviews.json',
      requireReviewedTranslations: true, typegen: { outFile: 'generated.d.ts' }, ...extra })],
    build: { write: false, rolldownOptions: { input: path.join(root, 'main.js') } },
  });
  return { root, reviews, config, write, approve, options };
}

test('review enforcement is opt-in and dev does not read the ledger', async t => {
  const f = await fixture(t);
  for (const requireReviewedTranslations of [undefined, false])
    await build(f.options({ requireReviewedTranslations })); // The configured ledger is absent.
  const plugin = saylo({ localesDir: 'locales', baseLocale: 'ko', reviews: 'absent.json', requireReviewedTranslations: true });
  try { await plugin.configResolved({ root: f.root, command: 'serve' }); }
  finally { await plugin.closeBundle(); }
  for (const extra of [{ requireReviewedTranslations: 'true' }, { requireReviewedTranslations: true },
    { reviews: '' }, { reviews: 42 }])
    assert.throws(() => saylo({ localesDir: 'locales', baseLocale: 'ko', ...extra }), TypeError);
});

test('builds reject unapproved pruned keys, preserve types, and recover after source/translation/rich reapproval', async t => {
  const f = await fixture(t);
  await f.approve(entry => entry.id === 'title');
  const out = path.join(f.root, 'generated.d.ts');
  await writeFile(out, '// last good types');
  await assert.rejects(build(f.options({ includeKeys: ['demo:title'] })), error => {
    assert.ok(error instanceof TranslationReviewError);
    assert.deepEqual(error.diagnostics.map(issue => [issue.code, issue.locale, issue.id]), [['REVIEW_REQUIRED', 'en', 'hidden']]);
    return true;
  });
  assert.equal(await readFile(out, 'utf8'), '// last good types');
  await f.approve();
  const ledger = await readFile(f.reviews, 'utf8');
  await build(f.options());
  assert.equal(await readFile(f.reviews, 'utf8'), ledger);
  await f.write('ko', { title: 'edited source', hidden: 'ko hidden' });
  await assert.rejects(build(f.options()), error => error.diagnostics?.some(issue => issue.code === 'SOURCE_CHANGED'));
  await f.approve(); await build(f.options());
  await f.write('en', { title: 'edited translation', hidden: 'en hidden' });
  await assert.rejects(build(f.options()), error => error.diagnostics?.some(issue => issue.code === 'TRANSLATION_CHANGED'));
  await f.approve(); await build(f.options());
  const richText = { demo: { title: ['link'] } };
  await assert.rejects(build(f.options({ richText })), error => error.diagnostics?.some(issue => issue.code === 'SOURCE_CHANGED'));
  await f.approve(undefined, { richText }); await build(f.options({ richText }));
});

test('strict review builds reject absent, malformed and wrong-base ledgers with their causes', async t => {
  const f = await fixture(t);
  await assert.rejects(build(f.options()), error => /Unable to read review approvals/.test(error.message) && error.cause?.code === 'ENOENT');
  for (const source of ['broken json', JSON.stringify({ format: 'saylo-review-approvals/v1', baseLocale: 'fr', entries: [] })]) {
    await writeFile(f.reviews, source);
    await assert.rejects(build(f.options()), error => /Invalid review approvals/.test(error.message) && error.cause instanceof Error);
  }
});

test('review enforcement requires completeness even when the completeness option is false', async t => {
  const f = await fixture(t);
  await f.approve();
  await f.write('en', { title: 'en title' });
  await assert.rejects(build(f.options({ requireCompleteTranslations: false, includeKeys: [] })),
    error => error.diagnostics?.some(issue => issue.code === 'MISSING_MESSAGE' && issue.id === 'hidden'));
  await f.write('en', { title: 'en title', hidden: 'en hidden' });
  await assert.rejects(build(f.options({ initialLocale: 'fr' })),
    error => error.diagnostics?.some(issue => issue.code === 'MISSING_NAMESPACE' && issue.locale === 'fr'));
});

test('shared review paths stay relative to the JSON config instead of Vite root', async t => {
  const f = await fixture(t);
  await f.approve();
  const file = path.join(f.root, 'saylo.config.json');
  await writeFile(file, JSON.stringify({ localesDir: 'locales', baseLocale: 'ko', reviews: 'reviews.json', requireReviewedTranslations: true }));
  const plugin = saylo(loadProjectConfig(file));
  try { await plugin.configResolved({ root: os.tmpdir(), command: 'build' }); }
  finally { await plugin.closeBundle(); }
});

test('watch builds reject ledger-only revocation and recover after approvals are restored', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  await f.approve();
  const ledger = await readFile(f.reviews, 'utf8');
  const config = f.options(); config.build.watch = {};
  const watcher = await build(config);
  let completed = 0;
  const errors = [];
  watcher.on('event', event => {
    if (event.code === 'ERROR') errors.push(event.error);
    if (event.code === 'BUNDLE_END') { completed++; void event.result.close(); }
  });
  async function until(predicate) {
    const deadline = Date.now() + 5000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(predicate(), `Watch state: ${completed} completed, ${errors.length} errors`);
  }
  try {
    await until(() => completed >= 1);
    await replace(f.reviews, JSON.stringify({ format: 'saylo-review-approvals/v1', baseLocale: 'ko', entries: [] }));
    await until(() => errors.length >= 1);
    assert.match(errors.at(-1).message, /REVIEW_REQUIRED/);
    const before = completed;
    await replace(f.reviews, ledger);
    await until(() => completed > before);
    await replace(path.join(f.config.localesDir, 'en', 'demo.json'), JSON.stringify({ title: 'watch changed', hidden: 'en hidden' }));
    await until(() => errors.some(error => /TRANSLATION_CHANGED/.test(error.message)));
    assert.match(errors.at(-1).message, /TRANSLATION_CHANGED/);
    const beforeApproval = completed;
    await f.approve();
    await until(() => completed > beforeApproval);
  } finally { await watcher.close(); }
});
