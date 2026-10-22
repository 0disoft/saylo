import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createImportDiff } from '../dist/catalog-diff.js';

const plan = files => ({ files, report: { blocked: false } });
const file = (source, nextSource, sourceName = 'en/common.json') => ({ source, nextSource, sourceName });

test('unified diff has exact ranges, context, literal empty translations and missing-newline markers', () => {
  assert.equal(createImportDiff(plan([file('{\n  "title": "Old"\n}', '{\n  "title": ""\n}')])),
    '--- a/en/common.json\n+++ b/en/common.json\n@@ -1,3 +1,3 @@\n {\n-  "title": "Old"\n+  "title": ""\n }\n\\ No newline at end of file\n');
  assert.equal(createImportDiff(plan([file(null, '{}\n')])),
    '--- /dev/null\n+++ b/en/common.json\n@@ -0,0 +1,1 @@\n+{}\n');
  assert.equal(createImportDiff(plan([])), '');
  assert.equal(createImportDiff(plan([file('{}\n', '{}\n')])), '');
  assert.equal(createImportDiff({ ...plan([file('old', 'new')]), report: { blocked: true } }), null);
});

test('distant changes split hunks and near changes merge with three surrounding context lines', () => {
  const before = Array.from({ length: 30 }, (_, i) => `line ${i}\n`);
  const after = [...before]; after[4] = 'changed four\n'; after[24] = 'changed twenty-four\n';
  const diff = createImportDiff(plan([file(before.join(''), after.join(''))]));
  assert.deepEqual(diff.match(/^@@.*$/gm), ['@@ -2,7 +2,7 @@', '@@ -22,7 +22,7 @@']);
  after[8] = 'changed eight\n';
  const near = createImportDiff(plan([file(before.join(''), after.join(''))]));
  assert.deepEqual(near.match(/^@@.*$/gm), ['@@ -2,11 +2,11 @@', '@@ -22,7 +22,7 @@']);
});

test('generated patches apply to exact bytes for CRLF, additions, repeated lines and unusual paths', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-diff-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('saylo-diff-'));
    await rm(root, { recursive: true, force: true });
  });
  const cases = [
    file('{\r\n\t"title": "Old"\r\n}', '{\r\n\t"title": "New",\r\n\t"added": ""\r\n}'),
    file(null, '{\n  "new": "한글"\n}\n', 'fr/new.json'),
    file('a\na\na\nb\na\na\n', 'a\na\nx\na\nb\na\na', 'en/repeated.json'),
    file('a\nb\na\nc\n', 'c\na\nb\na\n', 'en/reordered.json'),
    file('one\ntwo\n', 'one\ntwo', 'en/no-newline.json'),
    file('one\ntwo', 'one\ntwo\n', 'en/add-newline.json'),
    file('', 'text', 'en/empty.json'),
    file('text', '', 'en/remove.json'),
    file('{"quote":"a\\\"b"}', '{"quote":"c"}', 'en/with space.json'),
  ];
  for (const current of cases) {
    const target = path.join(root, current.sourceName);
    await mkdir(path.dirname(target), { recursive: true });
    if (current.source !== null) await writeFile(target, current.source);
  }
  const diff = createImportDiff(plan(cases));
  assert.match(diff, /--- "a\/en\/with space.json"/);
  const applied = spawnSync('git', ['apply', '--whitespace=nowarn', '-'],
    { cwd: root, input: diff, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(applied.status, 0, applied.error?.message ?? applied.stderr);
  for (const current of cases) assert.equal(await readFile(path.join(root, current.sourceName), 'utf8'), current.nextSource);
});

test('large catalogs keep small edits local without a quadratic line table', () => {
  const before = Array.from({ length: 20000 }, (_, i) => `  "key${i}": "value${i}",\n`);
  const after = [...before]; after[10000] = '  "key10000": "changed",\n';
  const diff = createImportDiff(plan([file(before.join(''), after.join(''))]));
  assert.match(diff, /@@ -9998,7 \+9998,7 @@/);
  assert.ok(diff.length < 500);
});
