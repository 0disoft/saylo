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
    ['check', '--locales-dir', 'missing', '--json'], ['other', '--json']]) {
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
