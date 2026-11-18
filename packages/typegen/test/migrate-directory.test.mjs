import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { writeCatalogOutput } from '../dist/catalog-output.js';
import { planCallRewrite } from '../dist/migrate-calls.js';
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

test('call rewrite rejects pre-aborted plans before loading the source tree', async t => {
  const { root } = await fixture(t);
  const reason = new Error('already cancelled');
  const reads = [];
  await assert.rejects(planCallRewrite({ sourceDir: path.join(root, 'src'), namespace: 'shop', targets: [],
    signal: AbortSignal.abort(reason),
    async readDirectory(directory) { reads.push(directory); return []; },
  }), error => error === reason);
  assert.deepEqual(reads, []);
});

test('call rewrite stops before descending if cancelled during root enumeration', async t => {
  const { root } = await fixture(t);
  const sourceDir = path.join(root, 'src');
  for (const name of ['first', 'second']) await mkdir(path.join(sourceDir, name));
  const controller = new AbortController(), reason = new Error('scan cancelled');
  const reads = [];
  const result = await planCallRewrite({ sourceDir, namespace: 'shop', targets: [], signal: controller.signal,
    async readDirectory(directory) {
      reads.push(directory);
      const entries = await readdir(directory, { withFileTypes: true });
      if (directory === sourceDir) controller.abort(reason);
      return entries;
    },
  }).then(() => undefined, error => error);
  assert.deepEqual(reads, [sourceDir]);
  assert.equal(result, reason);
});

test('call rewrite checks cancellation again after the final source read', async t => {
  const { root } = await fixture(t);
  const sourceDir = path.join(root, 'src');
  const file = path.join(sourceDir, 'shop.ts');
  const source = "import { useTranslation } from 'react-i18next';\n" +
    "export function Shop() { const { t } = useTranslation('shop'); return t('title'); }\n";
  await writeFile(file, source);
  const controller = new AbortController(), reason = new Error('source read cancelled');
  const readError = Object.assign(new Error('source read failed'), { code: 'EIO' });
  const options = { sourceDir, namespace: 'shop', targets: ['title'], signal: controller.signal };
  const ready = await planCallRewrite(options);
  assert.equal(ready.changes.length, 1);
  await assert.rejects(planCallRewrite({ ...options, async readSource() { throw readError; } }), error => error === readError);

  const reads = [];
  await assert.rejects(planCallRewrite({ ...options,
    async readSource(current, signal) {
      reads.push(current);
      assert.equal(signal, controller.signal);
      controller.abort(reason);
      return source;
    },
  }), error => error === reason);
  assert.deepEqual(reads, [file]);
});

const directoryArgs = [
  '--from', 'i18next', '--from-dir', 'locales', '--out-dir', 'output',
  '--escape-value', 'false', '--json',
];

test('directory planning stops enumeration at the cancellation boundary', async t => {
  for (const phase of ['before root listing', 'after root listing']) await t.test(phase, async t => {
    const { root } = await fixture(t);
    const fromDir = path.join(root, 'locales'), outDir = path.join(root, 'output');
    const controller = new AbortController(), reason = new Error('migration cancelled');
    const visited = [];
    if (phase === 'before root listing') controller.abort(reason);
    await assert.rejects(planDirectoryMigration({ fromDir, outDir, signal: controller.signal,
      async readDirectory(directory) {
        visited.push(directory);
        const entries = await readdir(directory, { withFileTypes: true });
        if (directory === fromDir) controller.abort(reason);
        return entries;
      },
      readSource: () => assert.fail('cancelled enumeration must not read a source'),
    }), error => error === reason);
    assert.deepEqual(visited, phase === 'before root listing' ? [] : [fromDir]);
  });
});

test('directory planning distinguishes cancellation during the last source read from I/O failure', async t => {
  const { root } = await fixture(t);
  const fromDir = path.join(root, 'locales'), outDir = path.join(root, 'output');
  const lastSource = path.join(fromDir, 'ko', 'shop.json');
  const ioError = Object.assign(new Error('catalog device unavailable'), { code: 'EIO' });
  for (const outcome of ['read failure', 'abort before returning bytes', 'abort and reject']) {
    await t.test(outcome, async () => {
      const controller = new AbortController(), reason = new Error('migration cancelled');
      const pending = planDirectoryMigration({ fromDir, outDir, escapeValue: false, signal: controller.signal,
        async readSource(file, signal) {
          assert.equal(signal, controller.signal);
          if (file !== lastSource) return readFile(file, 'utf8');
          if (outcome !== 'read failure') controller.abort(reason);
          if (outcome === 'abort before returning bytes') return readFile(file, 'utf8');
          throw ioError;
        },
      });
      if (outcome !== 'read failure') await assert.rejects(pending, error => error === reason);
      else {
        const report = await pending;
        assert.equal(report.blocked, true);
        assert.deepEqual(report.issues.map(issue => [issue.code, issue.file]), [['READ_FAILED', lastSource]]);
        assert.deepEqual(report.checkpoint.entries.map(entry => entry.status), ['ready', 'blocked']);
      }
      assert.deepEqual(await readdir(outDir), []);
    });
  }
});

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

test('private method parameter shadowing blocks CLI apply without changing unrelated calls', async t => {
  const f = await fixture(t);
  const sources = new Map([
    ['parser.js', `import { t } from 'i18next';
export class Parser {
  #format(t) { return t('header.title'); }
  run() { return this.#format(key => key); }
}
export const translated = t('header.title');\n`],
    ['hook.tsx', `import { useTranslation } from 'react-i18next';
class Parser {
  #format(useTranslation) {
    const { t } = useTranslation('shop');
    return t('header.title');
  }
}\n`],
    ['translation.js', "import { t } from 'i18next';\nexport const translated = t('header.title');\n"],
  ]);
  for (const [name, source] of sources) await writeFile(path.join(f.root, 'src', name), source);
  const result = f.run([...directoryArgs, '--apply', '--rewrite-calls', '--source-dir', 'src', '--namespace', 'shop']);
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.blocked, true);
  assert.ok(report.calls.issues.some(issue => issue.code === 'CALL_BINDING_SHADOWED' && issue.file.endsWith('parser.js')));
  assert.ok(report.calls.issues.some(issue => issue.code === 'CALL_USE_TRANSLATION_SHADOWED' && issue.file.endsWith('hook.tsx')));
  assert.deepEqual(await filesBelow(path.join(f.root, 'output')), []);
  for (const [name, source] of sources) assert.equal(await readFile(path.join(f.root, 'src', name), 'utf8'), source);
});

test('successful CLI apply changes translation keys while private callbacks keep their runtime results', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'package.json'), '{"type":"module"}');
  // A local identity stub isolates source rewriting from i18next's runtime setup.
  const stub = path.join(f.root, 'node_modules', 'i18next');
  await mkdir(stub, { recursive: true });
  await writeFile(path.join(stub, 'package.json'), '{"type":"module","exports":"./index.js"}');
  await writeFile(path.join(stub, 'index.js'), 'export const t = key => key;');
  const sourceFile = path.join(f.root, 'src', 'parser.js');
  const source = `import { t } from 'i18next';
export class Parser {
  #format(format) { return format('header.title'); }
  run() { return this.#format(key => key); }
}
export const translated = t('header.title');\n`;
  const unrelatedFile = path.join(f.root, 'src', 'unrelated.js');
  const unrelated = `export class Parser {
  #format(t) { return t('header.title'); }
  run() { return this.#format(key => key); }
}\n`;
  await writeFile(sourceFile, source);
  await writeFile(unrelatedFile, unrelated);
  const before = await import(pathToFileURL(sourceFile).href + '?before');
  assert.equal(new before.Parser().run(), 'header.title');
  assert.equal(before.translated, 'header.title');
  const result = f.run([...directoryArgs, '--apply', '--rewrite-calls', '--source-dir', 'src', '--namespace', 'shop']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.blocked, false);
  assert.equal(report.calls.changes.length, 1);
  assert.equal(await readFile(sourceFile, 'utf8'), source.replace("= t('header.title');", '= t("shop:header.title");'));
  assert.equal(await readFile(unrelatedFile, 'utf8'), unrelated);
  const after = await import(pathToFileURL(sourceFile).href + '?after');
  const plain = await import(pathToFileURL(unrelatedFile));
  assert.equal(after.translated, 'shop:header.title');
  assert.equal(new after.Parser().run(), 'header.title');
  assert.equal(new plain.Parser().run(), 'header.title');
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

for (const scenario of ['first mkdir fails', 'second mkdir fails', 'cancel after first mkdir']) {
  test(`output directory setup stops cleanly when ${scenario}`, async t => {
    const f = await fixture(t);
    const outDir = path.join(f.root, 'output');
    const plan = await planDirectoryMigration({ fromDir: path.join(f.root, 'locales'), outDir, escapeValue: false });
    const controller = new AbortController();
    const cause = scenario === 'cancel after first mkdir' ? new Error('cancelled by caller')
      : Object.assign(new Error('could not create output directory'), { code: 'EACCES' });
    const attempts = [];
    await assert.rejects(applyDirectoryMigration(plan, {
      signal: controller.signal,
      async createDirectory(directory) {
        attempts.push(path.basename(directory));
        if (scenario === 'first mkdir fails' || (scenario === 'second mkdir fails' && attempts.length === 2)) throw cause;
        await mkdir(directory);
        if (scenario === 'cancel after first mkdir') controller.abort(cause);
      },
      write: () => assert.fail('catalog writes must not start after setup fails'),
    }), error => error instanceof DirectoryMigrationApplyError && error.cause === cause &&
      error.writtenFiles.length === 0 && error.report.checkpoint.entries.every(entry => entry.status === 'ready'));
    assert.deepEqual(attempts, scenario === 'second mkdir fails' ? ['en', 'ko'] : ['en']);
    assert.deepEqual(await readdir(outDir), []);
  });
}

test('directory apply publishes only files whose source still matches at publication', async t => {
  for (const changed of ['already published', 'about to publish']) await t.test(changed, async t => {
    const f = await fixture(t);
    const outDir = path.join(f.root, 'output');
    const plan = await planDirectoryMigration({ fromDir: path.join(f.root, 'locales'), outDir, escapeValue: false });
    const [first, second] = plan.files;
    const edited = changed === 'already published' ? first : second;
    const pending = applyDirectoryMigration(plan, {
      async write(file, value, options) {
        if (file === second.targetFile) await writeFile(edited.sourceFile, '{"title":"Changed after preflight"}');
        return writeCatalogOutput(file, value, options);
      },
    });

    if (edited === first) {
      assert.deepEqual((await pending).writtenFiles, [first.targetFile, second.targetFile]);
    } else {
      await assert.rejects(pending, error => {
        assert.ok(error instanceof DirectoryMigrationApplyError);
        assert.match(error.message, /Input changed after preflight/);
        assert.deepEqual(error.writtenFiles, [first.targetFile]);
        assert.deepEqual(error.report.checkpoint.entries.map(entry => entry.status), ['written', 'ready']);
        return true;
      });
    }
    const expected = edited === first ? [first, second] : [first];
    assert.deepEqual(await filesBelow(outDir), expected.map(file => path.relative(outDir, file.targetFile)).sort());
    assert.deepEqual(JSON.parse(await readFile(first.targetFile, 'utf8')), { ...first.catalog });
  });
});

test('directory apply cleans the staged output on a publish-time read error or cancellation', async t => {
  for (const cancelled of [false, true]) await t.test(cancelled ? 'abort' : 'read error', async t => {
    const f = await fixture(t);
    const outDir = path.join(f.root, 'output');
    const plan = await planDirectoryMigration({ fromDir: path.join(f.root, 'locales'), outDir, escapeValue: false });
    const [first, second] = plan.files;
    const controller = new AbortController();
    const cause = Object.assign(new Error(cancelled ? 'cancelled by caller' : 'read failed'), { code: 'EIO' });
    let secondReads = 0;
    await assert.rejects(applyDirectoryMigration(plan, {
      signal: controller.signal,
      async readSource(file, signal) {
        assert.equal(signal, controller.signal);
        if (file === second.sourceFile && ++secondReads === 2) {
          assert.ok((await filesBelow(outDir)).some(name => name.endsWith('.tmp')));
          if (!cancelled) throw cause;
          controller.abort(cause);
        }
        return readFile(file, 'utf8');
      },
    }), error => error instanceof DirectoryMigrationApplyError &&
      error.cause?.cause === cause && error.writtenFiles.length === 1 && error.writtenFiles[0] === first.targetFile);
    assert.deepEqual(await filesBelow(outDir), [path.relative(outDir, first.targetFile)]);
    assert.equal(secondReads, 2);
  });
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
