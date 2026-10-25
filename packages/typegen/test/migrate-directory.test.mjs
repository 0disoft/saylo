import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { writeCatalogOutput } from '../dist/catalog-output.js';
import {
  DirectoryMigrationApplyError, applyDirectoryMigration, planDirectoryMigration,
} from '../dist/migrate-directory.js';

const cli = fileURLToPath(new URL('../dist/catalog-cli.js', import.meta.url));

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-migrate-directory-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('saylo-migrate-directory-'));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'locales', 'en'), { recursive: true });
  await mkdir(path.join(root, 'locales', 'ko'), { recursive: true });
  await mkdir(path.join(root, 'output'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'locales', 'en', 'shop.json'),
    JSON.stringify({ header: { title: 'Shop' }, count_one: '{{count}} item', count_other: '{{count}} items' }));
  await writeFile(path.join(root, 'locales', 'ko', 'shop.json'),
    JSON.stringify({ header: { title: '상점' }, count_one: '{{count}}개', count_other: '{{count}}개' }));
  const run = args => spawnSync(process.execPath, [cli, 'migrate', ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000,
  });
  return { root, run };
}

async function filesBelow(root) {
  return (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)))
    .sort();
}

const directoryArgs = [
  '--from', 'i18next', '--from-dir', 'locales', '--out-dir', 'output',
  '--escape-value', 'false', '--json',
];

test('directory CLI previews without writes, then applies every catalog with mappings and a checkpoint', async t => {
  const f = await fixture(t);
  const preview = f.run([...directoryArgs, '--dry-run']);
  assert.equal(preview.status, 0, preview.stderr + preview.stdout);
  const plan = JSON.parse(preview.stdout);
  assert.equal(plan.format, 'saylo-directory-migration/v1');
  assert.equal(plan.dryRun, true);
  assert.equal(plan.blocked, false);
  assert.equal(plan.files.length, 2);
  assert.deepEqual(plan.files.find(file => file.localeDirectory === 'en').mappings
    .find(mapping => mapping.targetKey === 'shop:header.title').sourceKeys, ['header.title']);
  assert.ok(plan.checkpoint.entries.every(entry => entry.status === 'ready'));
  assert.deepEqual(await filesBelow(path.join(f.root, 'output')), []);

  const applied = f.run([...directoryArgs, '--apply']);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  const report = JSON.parse(applied.stdout);
  assert.equal(report.dryRun, false);
  assert.equal(report.writtenFiles.length, 2);
  assert.ok(report.checkpoint.entries.every(entry => entry.status === 'written'));
  assert.deepEqual(JSON.parse(await readFile(path.join(f.root, 'output', 'en', 'shop.json'), 'utf8')), {
    'header.title': 'Shop',
    count: '{count, plural, one {{count} item} other {{count} items}}',
  });
  assert.deepEqual(await filesBelow(path.join(f.root, 'output')),
    [path.join('en', 'shop.json'), path.join('ko', 'shop.json')]);
  assert.ok(!(await filesBelow(f.root)).some(file => file.endsWith('.saylo-migrate.lock')));
});

test('directory apply preflights every target and writes nothing when one output already exists', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, 'output', 'en'));
  await writeFile(path.join(f.root, 'output', 'en', 'shop.json'), 'keep');
  const result = f.run([...directoryArgs, '--apply']);
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.blocked, true);
  assert.ok(report.issues.some(issue => issue.code === 'TARGET_EXISTS'));
  assert.equal(await readFile(path.join(f.root, 'output', 'en', 'shop.json'), 'utf8'), 'keep');
  await assert.rejects(readFile(path.join(f.root, 'output', 'ko', 'shop.json')), { code: 'ENOENT' });
});

test('directory input symlinks are rejected before output', async t => {
  const f = await fixture(t);
  await rm(path.join(f.root, 'locales', 'en'), { recursive: true });
  const target = path.join(f.root, 'real-en');
  await mkdir(target);
  await writeFile(path.join(target, 'shop.json'), JSON.stringify({ title: 'Linked' }));
  await symlink(target, path.join(f.root, 'locales', 'en'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = f.run([...directoryArgs, '--apply']);
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout);
  assert.ok(report.issues.some(issue => issue.code === 'UNSAFE_SYMLINK'));
  assert.deepEqual(await filesBelow(path.join(f.root, 'output')), []);
});

test('opt-in call rewrite changes literal keys only and leaves hook wiring intact', async t => {
  const f = await fixture(t);
  const source = path.join(f.root, 'src', 'shop.tsx');
  const original = [
    "import { useTranslation } from 'react-i18next';",
    'export function Shop() {',
    "  const { t } = useTranslation('shop');",
    "  const known = t('shop:header.title');",
    "  return t('header.title', { name: 'Ada' });",
    '}',
    '',
  ].join('\n');
  await writeFile(source, original);
  const result = f.run([...directoryArgs, '--apply', '--rewrite-calls', '--source-dir', 'src', '--namespace', 'shop']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.calls.changes.length, 1);
  assert.equal(report.calls.changes[0].before, 'header.title');
  assert.equal(report.calls.changes[0].after, 'shop:header.title');
  assert.equal(report.calls.changes.length, 1);
  const rewritten = await readFile(source, 'utf8');
  assert.match(rewritten, /useTranslation\('shop'\)/);
  assert.match(rewritten, /t\("shop:header\.title", \{ name: 'Ada' \}\)/);
  assert.match(rewritten, /const known = t\('shop:header\.title'\)/);
  assert.ok(report.writtenFiles.some(file => file.endsWith('shop.tsx')));
});

test('unsafe t() options and unknown prefixed keys block every rewrite', async t => {
  const f = await fixture(t);
  const options = path.join(f.root, 'src', 'options.ts');
  const prefixed = path.join(f.root, 'src', 'prefixed.ts');
  const optionsSource = [
    "import { t } from 'i18next';",
    "export const otherNamespace = t('header.title', { ns: 'other' });",
    "export const prefixedKey = t('header.title', { keyPrefix: 'header' });",
    "export const defaultValue = t('header.title', 'Fallback', { ns: 'other' });",
    '',
  ].join('\n');
  const prefixedSource = [
    "import { t } from 'i18next';",
    "export const missing = t('shop:not-real');",
    '',
  ].join('\n');
  await writeFile(options, optionsSource);
  await writeFile(prefixed, prefixedSource);
  const result = f.run([...directoryArgs, '--apply', '--rewrite-calls', '--source-dir', 'src', '--namespace', 'shop']);
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout);
  assert.ok(report.calls.issues.filter(issue => issue.code === 'CALL_ARGUMENTS_UNSUPPORTED').length >= 3);
  assert.ok(report.calls.issues.some(issue => issue.code === 'CALL_KEY_UNMAPPED' && issue.file.endsWith('prefixed.ts')));
  assert.deepEqual(await filesBelow(path.join(f.root, 'output')), []);
  assert.equal(await readFile(options, 'utf8'), optionsSource);
  assert.equal(await readFile(prefixed, 'utf8'), prefixedSource);
});

test('hook shadowing, reassignment and named class expressions block call rewrite', async t => {
  const f = await fixture(t);
  const hook = path.join(f.root, 'src', 'hook.tsx');
  const klass = path.join(f.root, 'src', 'class.ts');
  const hookSource = [
    "import { useTranslation } from 'react-i18next';",
    'export function C(useTranslation) {',
    "  const { t } = useTranslation('shop');",
    "  return t('header.title');",
    '}',
    'useTranslation = () => ({ t: (key) => key });',
    '',
  ].join('\n');
  const classSource = [
    "import { t } from 'i18next';",
    "const Thing = class t { value = t('header.title'); };",
    '',
  ].join('\n');
  await writeFile(hook, hookSource);
  await writeFile(klass, classSource);
  const result = f.run([...directoryArgs, '--apply', '--rewrite-calls', '--source-dir', 'src', '--namespace', 'shop']);
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout);
  const codes = new Set(report.calls.issues.map(issue => issue.code));
  assert.ok(codes.has('CALL_USE_TRANSLATION_SHADOWED'));
  assert.ok(codes.has('CALL_BINDING_SHADOWED'));
  assert.deepEqual(await filesBelow(path.join(f.root, 'output')), []);
  assert.equal(await readFile(hook, 'utf8'), hookSource);
  assert.equal(await readFile(klass, 'utf8'), classSource);
});

test('call rewrite requires the namespace to exist in every locale with identical keys', async t => {
  const f = await fixture(t);
  const source = path.join(f.root, 'src', 'shop.ts');
  const original = "import { t } from 'i18next';\nexport const title = t('header.title');\n";
  await writeFile(source, original);
  await writeFile(path.join(f.root, 'locales', 'ko', 'shop.json'),
    JSON.stringify({ header: { title: '상점' }, extra: '추가' }));
  const layout = f.run([...directoryArgs, '--apply', '--rewrite-calls', '--source-dir', 'src', '--namespace', 'shop']);
  assert.equal(layout.status, 1, layout.stderr + layout.stdout);
  assert.ok(JSON.parse(layout.stdout).issues.some(issue => issue.code === 'CALL_NAMESPACE_LAYOUT'));
  assert.equal(await readFile(source, 'utf8'), original);
  assert.deepEqual(await filesBelow(path.join(f.root, 'output')), []);

  await rm(path.join(f.root, 'locales', 'ko', 'shop.json'));
  await writeFile(path.join(f.root, 'locales', 'ko', 'common.json'), JSON.stringify({ title: '제목' }));
  const missing = f.run([...directoryArgs, '--apply', '--rewrite-calls', '--source-dir', 'src', '--namespace', 'shop']);
  assert.equal(missing.status, 1, missing.stderr + missing.stdout);
  assert.ok(JSON.parse(missing.stdout).issues.some(issue => issue.code === 'CALL_NAMESPACE_MISSING'));
  assert.equal(await readFile(source, 'utf8'), original);
});

test('dynamic, aliased and unmapped calls block call rewrite and preserve every file', async t => {
  const f = await fixture(t);
  const dynamic = path.join(f.root, 'src', 'dynamic.ts');
  const alias = path.join(f.root, 'src', 'alias.ts');
  const dynamicSource = [
    "import { useTranslation } from 'react-i18next';",
    'export function Shop() {',
    "  const { t } = useTranslation('shop');",
    "  const key = 'header.title';",
    '  return t(key);',
    '}',
    '',
  ].join('\n');
  const aliasSource = [
    "import { t as translate } from 'i18next';",
    "export const title = () => translate('header.title');",
    '',
  ].join('\n');
  await writeFile(dynamic, dynamicSource);
  await writeFile(alias, aliasSource);
  const blocked = f.run([...directoryArgs, '--apply', '--rewrite-calls', '--source-dir', 'src', '--namespace', 'shop']);
  assert.equal(blocked.status, 1, blocked.stderr + blocked.stdout);
  const report = JSON.parse(blocked.stdout);
  const codes = new Set(report.calls.issues.map(issue => issue.code));
  assert.ok(codes.has('CALL_KEY_DYNAMIC'));
  assert.ok(codes.has('CALL_IMPORT_ALIAS'));
  assert.deepEqual(await filesBelow(path.join(f.root, 'output')), []);
  assert.equal(await readFile(dynamic, 'utf8'), dynamicSource);
  assert.equal(await readFile(alias, 'utf8'), aliasSource);

  const optOut = f.run([...directoryArgs, '--apply']);
  assert.equal(optOut.status, 0, optOut.stderr + optOut.stdout);
  assert.equal(await readFile(dynamic, 'utf8'), dynamicSource);
  assert.equal(await readFile(alias, 'utf8'), aliasSource);
});

test('an injected later-file failure reports the completed checkpoint and removes locks and staging files', async t => {
  const f = await fixture(t);
  const plan = await planDirectoryMigration({
    fromDir: path.join(f.root, 'locales'), outDir: path.join(f.root, 'output'), escapeValue: false,
  });
  let writes = 0;
  await assert.rejects(applyDirectoryMigration(plan, {
    write: async (file, value, options) => {
      writes += 1;
      if (writes === 2) throw new Error('injected second-file failure');
      return writeCatalogOutput(file, value, options);
    },
  }), error => {
    assert.ok(error instanceof DirectoryMigrationApplyError);
    assert.equal(error.writtenFiles.length, 1);
    assert.equal(error.report.checkpoint.entries.filter(entry => entry.status === 'written').length, 1);
    return true;
  });
  assert.equal((await filesBelow(path.join(f.root, 'output'))).length, 1);
  assert.ok(!(await filesBelow(f.root)).some(file => file.endsWith('.saylo-migrate.lock')));
});
