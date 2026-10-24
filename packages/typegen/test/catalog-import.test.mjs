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
import { editCatalogJson } from '../dist/catalog-json-edit.js';
import { createReviewBaseline } from '../dist/catalog-review.js';

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

for (const [name, source, patch, expected] of [
  ['spaces and raw escapes', String.raw`{ "\u0074itle" : "Old", "orphan": "\uD55C\uAE00", "quote": "a\"b\\c" }`,
    { title: 'New "quote" \\ path', added: '' },
    String.raw`{ "\u0074itle" : "New \"quote\" \\ path", "orphan": "\uD55C\uAE00", "quote": "a\"b\\c", "added" : "" }`],
  ['two spaces', '{\n  "title": "Old",\n  "orphan": "한글"\n}\n', { title: 'New', added: 'Added' },
    '{\n  "title": "New",\n  "orphan": "한글",\n  "added": "Added"\n}\n'],
  ['tabs and CRLF without a final newline', '{\r\n\t"title" : "Old"\r\n}', { title: '', added: 'Added' },
    '{\r\n\t"title" : "",\r\n\t"added" : "Added"\r\n}'],
  ['compact JSON and special IDs', '{"10":"Ten","2":"Two","title":"Old"}',
    JSON.parse('{"title":"New","__proto__":"Prototype","a.b":"Dotted"}'),
    '{"10":"Ten","2":"Two","title":"New","__proto__":"Prototype","a.b":"Dotted"}'],
  ['empty compact object', '{}', { title: 'New' }, '{"title":"New"}'],
  ['empty spaced object', '{ }\n', { title: 'New' }, '{ "title": "New" }\n'],
  ['empty multiline object', '{\r\n}\r\n', { title: 'New', added: '' },
    '{\r\n  "title": "New",\r\n  "added": ""\r\n}\r\n'],
  ['value-only change keeps all whitespace', ' \t{\n    "title"\t:\t"Old"  \n}\n\t', { title: 'New' },
    ' \t{\n    "title"\t:\t"New"  \n}\n\t'],
  ['unchanged escaped values', String.raw`{"title":"\uD55C\uAE00"}`, { title: '한글' }, String.raw`{"title":"\uD55C\uAE00"}`],
]) {
  test(`catalog JSON edit preserves ${name}`, () => {
    const before = JSON.stringify(patch);
    const edited = editCatalogJson(source, patch);
    assert.equal(edited, expected);
    assert.deepEqual(JSON.parse(edited), { ...JSON.parse(source), ...patch });
    assert.equal(JSON.stringify(patch), before);
    assert.equal(editCatalogJson(edited, patch), edited);
  });
}

async function formattedPlan(t) {
  const f = await fixture(t);
  await mkdir(path.join(f.root, 'en'));
  const target = path.join(f.root, 'en/common.json');
  const original = '{\r\n\t"title" : "Old",\r\n\t"orphan": "\\uD55C\\uAE00"\r\n}';
  await writeFile(f.base, '{"title":"원문","added":"추가"}');
  await writeFile(target, original);
  const { inspection, report } = await inspectProject(f.config);
  const hashes = createReviewBaseline(inspection, 'ko').messages;
  const work = { format: 'saylo-translation-work/v1', baseLocale: 'ko', entries: [
    { locale: 'en', namespace: 'common', id: 'title', reason: 'review', source: '원문',
      sourceHash: hashes['common:title'], originalTranslation: 'Old', translation: 'New' },
    { locale: 'en', namespace: 'common', id: 'added', reason: 'add', source: '추가',
      sourceHash: hashes['common:added'], originalTranslation: null, translation: '' },
  ] };
  return { ...f, target, original, inspection, report, work,
    plan: planTranslationImport(inspection, report, f.config, work) };
}

test('import preserves formatting when changing and adding messages, including on disk and reimport', async t => {
  const f = await formattedPlan(t);
  const expected = '{\r\n\t"title" : "New",\r\n\t"orphan": "\\uD55C\\uAE00",\r\n\t"added" : ""\r\n}';
  assert.equal(f.plan.report.blocked, false);
  assert.equal(f.plan.files[0].nextSource, expected);
  assert.equal(await readFile(f.target, 'utf8'), f.original); // Planning is read-only.
  await applyTranslationImport(f.plan);
  assert.equal(await readFile(f.target, 'utf8'), expected);
  const { inspection, report } = await inspectProject(f.config);
  const again = planTranslationImport(inspection, report, f.config, f.work);
  assert.equal(again.report.blocked, false);
  assert.deepEqual(again.files, []);
  await f.assertClean();
});

test('formatting-only concurrent edits still block import without overwriting the target', async t => {
  const f = await formattedPlan(t);
  const concurrent = f.original + '\n';
  await writeFile(f.target, concurrent);
  await assert.rejects(applyTranslationImport(f.plan), /Catalog changed during import/);
  assert.equal(await readFile(f.target, 'utf8'), concurrent);
  await f.assertClean();
});

test('a JSON edit whose decoded values differ from the planned merge blocks every write', async t => {
  const f = await formattedPlan(t);
  const inspection = { ...f.inspection, files: f.inspection.files.map(file => file.file === f.target
    ? { ...file, source: file.source.replace('\\uD55C\\uAE00', 'Different orphan') } : file) };
  const plan = planTranslationImport(inspection, f.report, f.config, f.work);
  assert.equal(plan.report.blocked, true);
  assert.ok(plan.report.diagnostics.some(issue => issue.code === 'INVALID_CATALOG'));
  await assert.rejects(applyTranslationImport(plan), /Cannot apply a blocked translation import/);
  assert.equal(await readFile(f.target, 'utf8'), f.original);
  await f.assertClean();
});

test('new catalogs retain the default two-space LF output with final newline', async t => {
  const f = await fixture(t);
  assert.equal(f.plan.files[0].nextSource, '{\n  "title": "en title"\n}\n');
});

async function contractPlan(t, patch) {
  const f = await fixture(t);
  const base = JSON.parse('{"title":"Hello {value}","rich":"<link>Terms {name}</link>","__proto__":"Base","constructor":"Base constructor","empty":"Base","2":"Two"}');
  const original = JSON.stringify({ ...base, title: 'Old', orphan: 'Keep me' }, null, 2);
  const target = path.join(f.root, 'en/common.json');
  await writeFile(f.base, JSON.stringify(base, null, 2));
  await mkdir(path.dirname(target));
  await writeFile(target, original);
  const config = { ...f.config, richText: { common: { rich: ['link'] } } };
  const { inspection, report } = await inspectProject(config);
  const hashes = createReviewBaseline(inspection, 'ko').messages;
  const previous = JSON.parse(original);
  const work = { format: 'saylo-translation-work/v1', baseLocale: 'ko', entries: patch.map(([id, translation]) => ({
    locale: 'en', namespace: 'common', id, reason: 'review', source: base[id], sourceHash: hashes[`common:${id}`],
    originalTranslation: previous[id], translation,
  })) };
  return { ...f, target, original, plan: planTranslationImport(inspection, report, config, work) };
}

test('partial import validates merged messages without rejecting retained orphans or prototype-like IDs', async t => {
  const patch = [['title', 'New {value}'], ['rich', '<link>New {name}</link>'],
    ['__proto__', 'Prototype'], ['constructor', 'Constructor'], ['empty', '']];
  const f = await contractPlan(t, patch);
  assert.equal(f.plan.report.blocked, false);
  assert.deepEqual(JSON.parse(f.plan.files[0].nextSource), { ...JSON.parse(f.original), ...Object.fromEntries(patch) });
  await applyTranslationImport(f.plan);
  assert.equal(await readFile(f.target, 'utf8'), f.plan.files[0].nextSource);
  await f.assertClean();
});

for (const [id, translation, code] of [
  ['title', '{extra}', 'UNKNOWN_ARGUMENT'],
  ['title', '{value, number}', 'ARGUMENT_TYPE_NARROWING'],
  ['title', '{', 'INVALID_ICU'],
  ['rich', '{name, select, ok {<link>Good</link>} other {<bad>Bad</bad>}}', 'INVALID_RICH_TEXT'],
]) test(`partial import rejects ${code} without changing the target`, async t => {
  const f = await contractPlan(t, [[id, translation]]);
  assert.equal(f.plan.report.blocked, true);
  assert.ok(f.plan.report.diagnostics.some(issue => issue.id === id && issue.code === code));
  await assert.rejects(applyTranslationImport(f.plan), /Cannot apply a blocked translation import/);
  assert.equal(await readFile(f.target, 'utf8'), f.original);
  await f.assertClean();
});
