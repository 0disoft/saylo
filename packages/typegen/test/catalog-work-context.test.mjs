import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inspectProject } from '../dist/catalog-audit.js';
import { createTranslationWorkfile, parseTranslationWorkfile } from '../dist/catalog-workfile.js';
import { refreshTranslationWorkfile } from '../dist/catalog-refresh.js';
import { planTranslationImport } from '../dist/catalog-import.js';
import { planReviewApproval } from '../dist/catalog-approve.js';
import { parseTranslationMetadata } from '../dist/translation-metadata.js';
import { parseReviewApprovals } from '../dist/catalog-approvals.js';
import { parseTranslationPo, serializeTranslationPo } from '../dist/catalog-po.js';

const cli = fileURLToPath(new URL('../dist/catalog-cli.js', import.meta.url));
const find = (work, id) => work.entries.find(entry => entry.id === id);

test('CLI PO export is exclusive and edited work returns through the same validated import path', async t => {
  const f = await fixture(t);
  const saved = f.run(['export', '--with-context', '--format', 'po', '--out-file', 'work.po', '--json']);
  assert.equal(saved.status, 0, saved.stderr + saved.stdout);
  const po = await readFile(path.join(f.root, 'work.po'), 'utf8');
  const parsed = parseTranslationPo(po, 'ko');
  find(parsed, 'plain').translation = 'Welcome {name}';
  await writeFile(path.join(f.root, 'work.po'), serializeTranslationPo(parsed));
  const preview = f.run(['import', '--file', 'work.po', '--dry-run', '--json']);
  assert.equal(preview.status, 0, preview.stderr + preview.stdout);
  assert.equal(JSON.parse(preview.stdout).changes.length, 1);
  assert.equal(f.run(['export', '--format', 'po', '--out-file', 'work.po']).status, 2);
  find(parsed, 'numeric').translation = '{count, select, x {bad} other {bad}}';
  await writeFile(path.join(f.root, 'work.po'), serializeTranslationPo(parsed));
  assert.equal(f.run(['import', '--file', 'work.po', '--dry-run', '--json']).status, 1);
});

test('v3 advisory metadata roundtrips, refreshes and never relaxes the current catalog contract', async t => {
  const f = await fixture(t);
  const metadata = parseTranslationMetadata(JSON.stringify({ format: 'saylo-translation-metadata/v1', messages: {
    'common:numeric': { description: 'Checkout total', maxLength: 20, screenshots: ['https://example.test/cart'], glossary: { total: 'Amount due' } } } }));
  const work = createTranslationWorkfile(f.checked.inspection, f.checked.report, { metadata });
  assert.equal(work.format, 'saylo-translation-work/v3');
  const parsed = parseTranslationWorkfile(JSON.stringify(work), 'ko');
  assert.deepEqual(find(parsed, 'numeric').context.metadata, metadata.messages['common:numeric']);
  find(parsed, 'numeric').context.metadata.description = 'Edited translator note';
  assert.equal(metadata.messages['common:numeric'].description, 'Checkout total');
  const refreshed = refreshTranslationWorkfile(f.checked.inspection, f.checked.report, parsed);
  assert.equal(find(refreshed.workfile, 'numeric').context.metadata.description, 'Edited translator note');
  const updated = refreshTranslationWorkfile(f.checked.inspection, f.checked.report, parsed, { metadata });
  assert.equal(find(updated.workfile, 'numeric').context.metadata.description, 'Checkout total');
  find(parsed, 'numeric').translation = '{count, select, foo {x} other {y}}';
  assert.equal(planTranslationImport(f.checked.inspection, f.checked.report, f.config, parsed).report.blocked, true);
  for (const notes of [{ maxLength: 0 }, { screenshots: ['javascript:alert(1)'] }, { glossary: [] }])
    assert.throws(() => parseTranslationMetadata(JSON.stringify({ format: 'saylo-translation-metadata/v1', messages: { 'common:numeric': notes } })));
  await writeFile(path.join(f.root, 'metadata.json'), JSON.stringify(metadata));
  const result = f.run(['export', '--metadata', 'metadata.json', '--json']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(JSON.parse(result.stdout).format, 'saylo-translation-work/v3');
});

test('review attribution is optional audit context and does not bypass approval checkpoints', async t => {
  const f = await fixture(t);
  await f.write('en', { numeric: '{count, number}' });
  const current = await inspectProject(f.config);
  const work = structuredClone(f.work);
  work.entries = [find(work, 'numeric')]; work.entries[0].translation = '{count, number}';
  const ledger = { file: path.join(f.root, 'reviews.json'), source: null,
    approvals: { format: 'saylo-review-approvals/v1', baseLocale: 'ko', entries: [] } };
  const attribution = { reviewer: 'Translator', reviewedAt: '2026-10-25T00:00:00.000Z' };
  const plan = planReviewApproval(current.inspection, current.report, work, ledger, attribution);
  assert.equal(plan.report.blocked, false);
  assert.equal(plan.approvals.entries[0].reviewer, 'Translator');
  assert.deepEqual(parseReviewApprovals(JSON.stringify(plan.approvals), 'ko'), plan.approvals);
  assert.throws(() => planReviewApproval(current.inspection, current.report, work, ledger, { reviewer: 'x' }));
  work.entries[0].source = 'Stale source';
  assert.equal(planReviewApproval(current.inspection, current.report, work, ledger, attribution).report.blocked, true);
});
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-work-context-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('saylo-work-context-'));
    await rm(root, { recursive: true, force: true });
  });
  const config = { localesDir: path.join(root, 'locales'), baseLocale: 'ko', checkLocales: ['en'],
    richText: { common: { rich: ['link'], restricted: [] } } };
  const messages = Object.fromEntries(Object.entries({ plain: 'Hello {name}', numeric: '{count, number}',
    date: '{at, date, short}', plural: '{count, plural, one {{name}} other {#}}',
    mixed: '{n} {n, number}', rich: '<link>{name}</link>', restricted: 'No tags', literal: '<b>Literal</b>' })
    .concat([['__proto__', '{constructor}']]));
  const write = async (locale, values) => {
    await mkdir(path.join(config.localesDir, locale), { recursive: true });
    await writeFile(path.join(config.localesDir, locale, 'common.json'), JSON.stringify(values));
  };
  await write('ko', messages);
  await writeFile(path.join(root, 'saylo.config.json'), JSON.stringify(config));
  const checked = await inspectProject(config);
  const work = createTranslationWorkfile(checked.inspection, checked.report, { withContext: true });
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  return { root, config, messages, write, checked, work, run };
}

test('v2 context describes real base argument types and distinct literal/empty/tagged policies without retaining parser arrays', async t => {
  const f = await fixture(t);
  const legacy = createTranslationWorkfile(f.checked.inspection, f.checked.report);
  assert.equal(legacy.format, 'saylo-translation-work/v1');
  assert.ok(legacy.entries.every(entry => !Object.hasOwn(entry, 'context')));
  assert.equal(f.work.format, 'saylo-translation-work/v2');
  assert.deepEqual(parseTranslationWorkfile(JSON.stringify(f.work), 'ko'), f.work);
  assert.deepEqual(find(f.work, 'plain').context, { arguments: { name: ['number', 'string'] }, richTextTags: null });
  assert.deepEqual(find(f.work, 'numeric').context.arguments, { count: ['number'] });
  assert.deepEqual(find(f.work, 'date').context.arguments, { at: ['date', 'number'] });
  assert.deepEqual(find(f.work, 'plural').context.arguments, { count: ['number'], name: ['number', 'string'] });
  assert.deepEqual(find(f.work, 'mixed').context.arguments, { n: ['number'] });
  assert.deepEqual(find(f.work, 'rich').context.richTextTags, ['link']);
  assert.deepEqual(find(f.work, 'restricted').context.richTextTags, []);
  assert.equal(find(f.work, 'literal').context.richTextTags, null);
  assert.deepEqual(find(f.work, '__proto__').context.arguments, { constructor: ['number', 'string'] });
  find(f.work, 'plain').context.arguments.name.push('date');
  find(f.work, 'rich').context.richTextTags.push('edited');
  assert.deepEqual(createTranslationWorkfile(f.checked.inspection, f.checked.report), legacy);
  const fresh = createTranslationWorkfile(f.checked.inspection, f.checked.report, { withContext: true });
  assert.deepEqual(find(fresh, 'plain').context.arguments.name, ['number', 'string']);
  assert.deepEqual(find(fresh, 'rich').context.richTextTags, ['link']);
});

test('v1/v2 readers reject invalid versions, missing or malformed guidance, unknown fields and non-string reasons', async t => {
  const f = await fixture(t);
  for (const alter of [work => { work.format = ['saylo-translation-work/v2']; }, work => { work.format = 'saylo-translation-work/v3'; },
    work => { delete work.entries[0].context; }, work => { work.entries[0].context = null; },
    work => { work.entries[0].context.arguments = []; }, work => { work.entries[0].context.arguments = { n: [] }; },
    work => { work.entries[0].context.arguments = { n: ['boolean'] }; }, work => { work.entries[0].context.arguments = { n: ['number', 'number'] }; },
    work => { work.entries[0].context.richTextTags = ['link', 'link']; }, work => { work.entries[0].context.richTextTags = ['bad tag']; },
    work => { work.entries[0].context.extra = true; }, work => { work.entries[0].reason = ['add']; },
    work => { work.entries[0].file = '../outside'; }, work => { work.entries.push(work.entries[0]); }]) {
    const work = structuredClone(f.work); alter(work);
    assert.throws(() => parseTranslationWorkfile(JSON.stringify(work), 'ko'), TypeError);
  }
  const legacy = structuredClone(f.work); legacy.format = 'saylo-translation-work/v1';
  assert.throws(() => parseTranslationWorkfile(JSON.stringify(legacy), 'ko')); // v1 must not silently accept guidance.
  for (const entry of legacy.entries) delete entry.context;
  assert.deepEqual(parseTranslationWorkfile(JSON.stringify(legacy), 'ko'), legacy);
});

test('edited guidance cannot relax current import contracts, require omitted arguments or change approval hashes', async t => {
  const f = await fixture(t);
  find(f.work, 'numeric').context.arguments = { count: ['string'] };
  find(f.work, 'numeric').translation = '{count, select, one {One} other {Other}}';
  find(f.work, 'rich').context.richTextTags = ['script'];
  const parsed = parseTranslationWorkfile(JSON.stringify(f.work), 'ko');
  const denied = planTranslationImport(f.checked.inspection, f.checked.report, f.config, parsed);
  assert.equal(denied.report.blocked, true);
  assert.ok(denied.report.diagnostics.some(issue => issue.code === 'ARGUMENT_TYPE_NARROWING'));
  find(parsed, 'numeric').translation = 'Translated without count'; // Omitting a base argument remains permitted.
  find(parsed, 'rich').translation = '<script>{name}</script>';
  const deniedTag = planTranslationImport(f.checked.inspection, f.checked.report, f.config, parsed);
  assert.equal(deniedTag.report.blocked, true);
  assert.ok(deniedTag.report.diagnostics.some(issue => issue.code === 'INVALID_RICH_TEXT'));
  find(parsed, 'rich').translation = '<link>Translated</link>';
  const accepted = planTranslationImport(f.checked.inspection, f.checked.report, f.config, parsed);
  assert.equal(accepted.report.blocked, false);
  assert.equal(accepted.report.changes.length, 2);
  await f.write('en', { numeric: 'Translated without count', rich: '<link>Translated</link>' });
  const current = await inspectProject(f.config);
  const ledger = { file: path.join(f.root, 'reviews.json'), source: null,
    approvals: { format: 'saylo-review-approvals/v1', baseLocale: 'ko', entries: [] } };
  const approved = planReviewApproval(current.inspection, current.report, parsed, ledger);
  const legacy = { ...parsed, format: 'saylo-translation-work/v1', entries: parsed.entries.map(({ context, ...entry }) => entry) };
  assert.equal(approved.report.blocked, false);
  assert.deepEqual(approved.approvals, planReviewApproval(current.inspection, current.report, legacy, ledger).approvals);
  await f.write('ko', { ...f.messages, numeric: 'Changed {count, number}' });
  const changed = await inspectProject(f.config);
  assert.ok(planReviewApproval(changed.inspection, changed.report, parsed, ledger).report.diagnostics.some(issue => issue.code === 'SOURCE_CONFLICT'));
});

test('refresh preserves the version, upgrades v1 explicitly and recalculates every current context while keeping old conflict snapshots', async t => {
  const f = await fixture(t);
  find(f.work, 'plain').translation = 'Draft';
  find(f.work, 'plain').context.arguments = { forged: ['date'] };
  const previous = structuredClone(f.work);
  const again = refreshTranslationWorkfile(f.checked.inspection, f.checked.report, f.work);
  assert.equal(again.workfile.format, 'saylo-translation-work/v2');
  assert.equal(find(again.workfile, 'plain').translation, 'Draft');
  assert.deepEqual(find(again.workfile, 'plain').context.arguments, { name: ['number', 'string'] });
  assert.deepEqual(f.work, previous);
  const legacy = createTranslationWorkfile(f.checked.inspection, f.checked.report);
  assert.equal(refreshTranslationWorkfile(f.checked.inspection, f.checked.report, legacy).workfile.format, 'saylo-translation-work/v1');
  const upgraded = refreshTranslationWorkfile(f.checked.inspection, f.checked.report, legacy, { withContext: true });
  assert.equal(upgraded.workfile.format, 'saylo-translation-work/v2');
  assert.ok(upgraded.workfile.entries.every(entry => entry.context));
  await f.write('ko', { ...f.messages, added: '{newCount, number}' });
  const changedConfig = { ...f.config, richText: { ...f.config.richText, common: { ...f.config.richText.common, rich: ['link', 'strong'] } } };
  const checked = await inspectProject(changedConfig);
  const result = refreshTranslationWorkfile(checked.inspection, checked.report, f.work);
  const conflict = result.conflicts.find(item => item.previous.id === 'rich');
  assert.equal(conflict.code, 'SOURCE_CONFLICT');
  assert.deepEqual(conflict.previous.context.richTextTags, ['link']);
  assert.deepEqual(conflict.current.context.richTextTags, ['link', 'strong']);
  assert.deepEqual(find(result.workfile, 'added').context.arguments, { newCount: ['number'] });
  assert.deepEqual(parseTranslationWorkfile(JSON.stringify(result.workfile), 'ko'), result.workfile);
  conflict.previous.context.richTextTags.push('output-edit');
  assert.deepEqual(find(f.work, 'rich').context.richTextTags, ['link']);
  await f.write('en', { plain: 'Draft' });
  const applied = await inspectProject(f.config);
  const appliedReport = refreshTranslationWorkfile(applied.inspection, applied.report, f.work);
  appliedReport.alreadyApplied.find(entry => entry.id === 'plain').context.arguments.forged.push('number');
  assert.deepEqual(find(f.work, 'plain').context.arguments, { forged: ['date'] });
});

test('CLI v2 export/import/approve/refresh works without enabling guidance on other commands or changing files', async t => {
  const f = await fixture(t);
  const exported = f.run(['export', '--with-context']);
  assert.equal(exported.status, 0, exported.stdout + exported.stderr);
  const work = JSON.parse(exported.stdout);
  assert.equal(work.format, 'saylo-translation-work/v2');
  assert.equal(JSON.parse(f.run(['export']).stdout).format, 'saylo-translation-work/v1');
  find(work, 'plain').translation = 'Hello';
  const input = JSON.stringify(work);
  await writeFile(path.join(f.root, 'work.json'), input);
  const imported = f.run(['import', '--file', 'work.json', '--apply', '--json']);
  assert.equal(imported.status, 0, imported.stdout);
  const approved = f.run(['approve', '--file', 'work.json', '--reviews', 'reviews.json', '--apply', '--json']);
  assert.equal(approved.status, 0, approved.stdout);
  const refresh = f.run(['refresh', '--file', 'work.json']);
  assert.equal(refresh.status, 0, refresh.stdout);
  const report = JSON.parse(refresh.stdout);
  assert.equal(report.workfile.format, 'saylo-translation-work/v2');
  assert.equal(report.alreadyApplied[0].id, 'plain');
  assert.deepEqual(find(report.workfile, 'plain').context, find(work, 'plain').context);
  assert.equal(await readFile(path.join(f.root, 'work.json'), 'utf8'), input);
  const legacy = { ...work, format: 'saylo-translation-work/v1', entries: work.entries.map(({ context, ...entry }) => entry) };
  await writeFile(path.join(f.root, 'legacy.json'), JSON.stringify(legacy));
  const upgraded = f.run(['refresh', '--file', 'legacy.json', '--with-context']);
  assert.equal(upgraded.status, 0, upgraded.stdout);
  assert.equal(JSON.parse(upgraded.stdout).workfile.format, 'saylo-translation-work/v2');
  for (const command of ['check', 'sync', 'snapshot', 'import', 'approve']) {
    const failed = f.run([command, ...(command === 'sync' ? ['--dry-run'] : []), '--with-context', '--json']);
    assert.equal(failed.status, 2);
    assert.match(JSON.parse(failed.stdout).error.message, /only supported with export or refresh/);
  }
});
