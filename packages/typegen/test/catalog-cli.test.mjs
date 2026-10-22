import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../dist/catalog-cli.js', import.meta.url));
async function fixture(t, settings = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-audit-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('saylo-audit-'));
    await rm(root, { recursive: true, force: true });
  });
  const config = { localesDir: 'locales', baseLocale: 'ko', ...settings };
  await mkdir(path.join(root, 'locales/ko'), { recursive: true });
  await writeFile(path.join(root, 'saylo.config.json'), JSON.stringify(config));
  const write = async (locale, namespace, source) => {
    await mkdir(path.join(root, 'locales', locale), { recursive: true });
    await writeFile(path.join(root, 'locales', locale, namespace + '.json'), typeof source === 'string' ? source : JSON.stringify(source));
  };
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  const snapshot = async () => {
    const files = (await readdir(root, { recursive: true, withFileTypes: true })).filter(item => item.isFile())
      .map(item => path.join(item.parentPath, item.name)).sort();
    return Promise.all(files.map(async file => [path.relative(root, file), (await readFile(file)).toString('base64')]));
  };
  return { root, config, write, run, snapshot };
}

test('export emits deterministic missing/review work with original values and source hashes without writing', async t => {
  const f = await fixture(t, { checkLocales: ['en-US', 'fr'] });
  await f.write('ko', 'common', { title: 'Old', empty: '', added: 'New' });
  await f.write('en-us', 'common', { title: 'English', empty: '' });
  const baseline = f.run(['snapshot']);
  await writeFile(path.join(f.root, 'review.json'), baseline.stdout);
  await f.write('ko', 'common', { title: 'Changed', empty: '', added: 'New' });
  const before = await f.snapshot();
  const result = f.run(['export', '--baseline', 'review.json']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const work = JSON.parse(result.stdout);
  assert.equal(work.format, 'saylo-translation-work/v1');
  const review = work.entries.find(entry => entry.locale === 'en-US' && entry.id === 'title');
  assert.equal(review.source, 'Changed'); assert.equal(review.originalTranslation, 'English');
  assert.equal(review.translation, 'English'); assert.equal(review.reason, 'review');
  assert.match(review.sourceHash, /^[a-f0-9]{64}$/);
  assert.ok(work.entries.some(entry => entry.id === 'added' && entry.translation === null));
  assert.ok(work.entries.some(entry => entry.locale === 'fr' && entry.id === 'empty'));
  assert.ok(!work.entries.some(entry => entry.locale === 'en-US' && entry.id === 'empty'));
  assert.equal(f.run(['export', '--baseline', 'review.json']).stdout, result.stdout);
  assert.deepEqual(await f.snapshot(), before);
  await f.write('en-us', 'common', '{');
  const broken = f.run(['export']);
  assert.equal(broken.status, 1); assert.equal(JSON.parse(broken.stdout).format, 'saylo-check/v1');
});

test('check aggregates parse, rich, argument, unknown-key and completeness issues without changing any files', async t => {
  const f = await fixture(t, { checkLocales: ['en', 'fr'], richText: { rich: { terms: ['link'] } } });
  await f.write('ko', 'common', { hello: '{name}', empty: '' });
  await f.write('ko', 'rich', { terms: '<link>약관</link>' });
  await f.write('en', 'common', { hello: '{count}', extra: 'orphan' });
  await f.write('en', 'rich', { terms: '<lnik>Terms</lnik>' });
  await f.write('en', 'broken', '{');
  await mkdir(path.join(f.root, 'locales/fr'));
  await writeFile(path.join(f.root, 'generated.d.ts'), '// unchanged');
  const before = await f.snapshot();
  const result = f.run(['check', '--json']);
  assert.equal(result.status, 1, result.stderr); assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.format, 'saylo-check/v1');
  const codes = new Set(report.diagnostics.map(issue => issue.code));
  for (const code of ['INVALID_JSON', 'INVALID_RICH_TEXT', 'UNKNOWN_ARGUMENT', 'UNKNOWN_MESSAGE', 'MISSING_MESSAGE', 'MISSING_NAMESPACE'])
    assert.ok(codes.has(code), code);
  assert.ok(report.diagnostics.some(issue => issue.locale === 'fr' && issue.code === 'MISSING_NAMESPACE'));
  assert.ok(!report.diagnostics.some(issue => issue.locale === 'en' && issue.namespace === 'rich' && issue.code.startsWith('MISSING_')));
  assert.equal(report.summary.errors, report.diagnostics.length);
  assert.deepEqual(await f.snapshot(), before);
  assert.equal(f.run(['check', '--json']).stdout, result.stdout);
});

test('check respects canonical physical directory names, empty translations and explicit absent locale targets', async t => {
  const f = await fixture(t);
  await f.write('ko', 'common', { empty: '' });
  await f.write('en-us', 'common', { empty: '' });
  const clean = f.run(['check', '--json']);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.deepEqual(JSON.parse(clean.stdout).locales, ['ko', 'en-US']);
  const missing = f.run(['check', '--locales', 'en-US,fr', '--json']);
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).diagnostics[0].sourceName, 'fr/common.json');
});

test('usage, config and filesystem errors return a JSON failure, never a clean audit', async t => {
  const f = await fixture(t);
  for (const args of [['check', '--unknown', '--json'], ['check', '--config', 'missing.json', '--json'],
    ['check', '--locales-dir', 'missing', '--json'], ['other', '--json'], ['check', '--config', '', '--json'],
    ['check', '--locales-dir', '', '--json'], ['check', '--baseline', '', '--json']]) {
    const result = f.run(args);
    assert.equal(result.status, 2); assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).format, 'saylo-command-error/v1');
  }
  const before = await f.snapshot();
  const help = f.run(['--help', '--config', 'missing.json']);
  assert.equal(help.status, 0); assert.match(help.stdout, /Exit codes/);
  assert.deepEqual(await f.snapshot(), before);
  const empty = f.run(['check', '--json']);
  assert.equal(empty.status, 1);
  assert.equal(JSON.parse(empty.stdout).diagnostics[0].code, 'MISSING_BASE_CATALOG');
});

test('inspection rejects duplicate canonical locale directories', async t => {
  const f = await fixture(t);
  await f.write('ko', 'common', { title: '기준' });
  await f.write('en-US', 'common', { title: 'A' });
  await f.write('en-us', 'common', { title: 'B' });
  // Case-insensitive filesystems may merge these two names; canonical aliases remain distinct.
  await f.write('iw', 'common', { title: 'A' });
  await f.write('he', 'common', { title: 'B' });
  const result = f.run(['check', '--json']);
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).error.message, /Duplicate canonical locale/);
});

test('inspection rejects a locale junction or symlink outside the catalog root', async t => {
  const f = await fixture(t);
  await f.write('ko', 'common', { title: '기준' });
  const outside = path.join(f.root, 'outside'); await mkdir(outside);
  await writeFile(path.join(outside, 'common.json'), '{"title":"must not be read"}');
  await symlink(outside, path.join(f.root, 'locales/en'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = f.run(['check', '--json']);
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).error.message, /escapes locales root/);
});

test('sync previews untranslated additions, preserves orphans and never edits catalogs or declarations', async t => {
  const f = await fixture(t, { checkLocales: ['en-US', 'fr'] });
  await f.write('ko', 'common', { title: '기준', added: '추가', empty: '' });
  await f.write('ko', 'help', { title: '도움말' });
  await f.write('en-us', 'common', { title: 'Existing', empty: '', extra: 'keep me' });
  await f.write('en-us', 'old', { legacy: 'keep namespace' });
  await writeFile(path.join(f.root, 'generated.d.ts'), '// keep types');
  const before = await f.snapshot();
  const result = f.run(['sync', '--dry-run', '--json']);
  assert.equal(result.status, 1); // Schema errors mark the preview blocked; the plan remains inspectable.
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.format, 'saylo-sync-plan/v1'); assert.equal(plan.dryRun, true); assert.equal(plan.blocked, true);
  assert.equal(plan.report.reviewTracking, 'not-configured');
  const addition = plan.changes.find(change => change.locale === 'en-US' && change.id === 'added');
  assert.equal(addition.sourceName, 'en-us/common.json');
  assert.equal(addition.translation, null); assert.equal(addition.baseSource, '추가');
  assert.ok(plan.changes.some(change => change.action === 'retain' && change.translation === 'keep me'));
  assert.ok(plan.changes.some(change => change.action === 'retain' && change.translation === 'keep namespace'));
  assert.ok(plan.changes.some(change => change.locale === 'fr' && change.sourceName === 'fr/help.json' && change.action === 'add'));
  assert.ok(!plan.changes.some(change => change.locale === 'en-US' && change.id === 'empty'));
  assert.deepEqual(await f.snapshot(), before);
  assert.equal(f.run(['sync', '--dry-run', '--json']).stdout, result.stdout);
});

test('source checkpoints detect changed and added sources without treating a snapshot as translation approval', async t => {
  const f = await fixture(t, { checkLocales: ['en'] });
  await f.write('ko', 'common', { title: 'old' });
  await f.write('en', 'common', { title: 'English' });
  const saved = f.run(['snapshot']);
  assert.equal(saved.status, 0, saved.stdout + saved.stderr);
  const baseline = JSON.parse(saved.stdout);
  assert.equal(baseline.format, 'saylo-review-baseline/v1');
  assert.match(baseline.messages['common:title'], /^[a-f0-9]{64}$/);
  await writeFile(path.join(f.root, 'review.json'), saved.stdout);
  assert.equal(f.run(['check', '--baseline', 'review.json', '--json']).status, 0);
  await f.write('ko', 'common', { title: 'new', imported: 'new base', missing: 'needs translation' });
  await f.write('en', 'common', { title: 'English', imported: 'already imported' });
  const before = await f.snapshot();
  const checked = f.run(['check', '--baseline', 'review.json', '--json']);
  assert.equal(checked.status, 1);
  const report = JSON.parse(checked.stdout);
  assert.equal(report.reviewTracking, 'baseline');
  assert.ok(report.diagnostics.some(issue => issue.id === 'title' && issue.code === 'SOURCE_CHANGED'));
  assert.ok(report.diagnostics.some(issue => issue.id === 'imported' && issue.code === 'SOURCE_ADDED'));
  const result = f.run(['sync', '--dry-run', '--baseline', 'review.json', '--json']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.blocked, false);
  assert.equal(plan.changes.filter(change => change.action === 'review').length, 2);
  assert.equal(plan.changes.filter(change => change.action === 'add').length, 1);
  assert.deepEqual(await f.snapshot(), before);
});

test('review hashing ignores source positions and policy ordering but catches rich-contract-only changes', async t => {
  const f = await fixture(t, { richText: { common: { title: ['link', 'strong'] } } });
  await f.write('ko', 'common', { title: '<link>약관</link>', other: '다른 문구' });
  await f.write('en', 'common', { title: '<link>Terms</link>', other: 'Other' });
  const snapshot = f.run(['snapshot']); assert.equal(snapshot.status, 0);
  await writeFile(path.join(f.root, 'review.json'), snapshot.stdout);
  await f.write('ko', 'common', '{\n "other": "다른 문구",\n "title": "<link>약관</link>"\n}');
  assert.equal(f.run(['check', '--baseline', 'review.json', '--json']).status, 0);
  f.config.richText.common.title = ['strong', 'link'];
  f.config.baseline = 'review.json';
  await writeFile(path.join(f.root, 'saylo.config.json'), JSON.stringify(f.config));
  assert.equal(f.run(['check', '--json']).status, 0);
  f.config.richText.common.title.push('em');
  await writeFile(path.join(f.root, 'saylo.config.json'), JSON.stringify(f.config));
  const changed = f.run(['check', '--json']);
  assert.equal(changed.status, 1);
  assert.deepEqual(JSON.parse(changed.stdout).diagnostics.map(issue => issue.code), ['SOURCE_CHANGED']);
});

test('invalid catalogs block snapshots and sync never proposes replacement for a broken file', async t => {
  const f = await fixture(t, { checkLocales: ['en'] });
  await f.write('ko', 'common', { title: '기준' });
  await f.write('en', 'common', '{');
  const before = await f.snapshot();
  const result = f.run(['sync', '--dry-run', '--json']);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).blocked, true);
  assert.deepEqual(JSON.parse(result.stdout).changes, []);
  const saved = f.run(['snapshot']);
  assert.equal(saved.status, 1);
  assert.equal(JSON.parse(saved.stdout).format, 'saylo-check/v1');
  assert.deepEqual(await f.snapshot(), before);
});

test('sync requires dry-run and baseline input errors never pass silently', async t => {
  const f = await fixture(t);
  await f.write('ko', 'common', { title: '기준' });
  for (const args of [['sync', '--json'], ['sync', '--apply', '--json'], ['check', '--dry-run', '--json'],
    ['check', '--baseline', 'missing.json', '--json'], ['snapshot', '--baseline', 'review.json', '--json']])
    assert.equal(f.run(args).status, 2);
  const file = path.join(f.root, 'review.json');
  for (const baseline of [{}, { format: 'saylo-review-baseline/v1', baseLocale: 'en', messages: {} },
    { format: 'saylo-review-baseline/v1', baseLocale: 'ko', messages: { 'common:title': 'bad hash' } }]) {
    await writeFile(file, JSON.stringify(baseline));
    const result = f.run(['check', '--baseline', 'review.json', '--json']);
    assert.equal(result.status, 2); assert.equal(JSON.parse(result.stdout).format, 'saylo-command-error/v1');
  }
});
