import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createCliCancellation, CommandInterruptedError } from '../dist/cli-cancellation.js';
import { inspectProject } from '../dist/catalog-audit.js';
import { applyReviewApprovals } from '../dist/catalog-approvals.js';
import { createTranslationWorkfile } from '../dist/catalog-workfile.js';

const cli = fileURLToPath(new URL('../dist/catalog-cli.js', import.meta.url));
const preload = new URL('./helpers/cli-cancellation-preload.mjs', import.meta.url).href;
async function fixture(t, command) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-cli-cancel-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('saylo-cli-cancel-'));
    await rm(root, { recursive: true, force: true });
  });
  const config = { localesDir: path.join(root, 'locales'), baseLocale: 'ko', checkLocales: command === 'import' ? ['en', 'fr'] : ['en'] };
  const write = async locale => {
    await mkdir(path.join(config.localesDir, locale), { recursive: true });
    await writeFile(path.join(config.localesDir, locale, 'common.json'), JSON.stringify({ title: `${locale} title` }));
  };
  await write('ko');
  if (command === 'approve') await write('en');
  const checked = await inspectProject(config);
  const report = applyReviewApprovals(checked.inspection, checked.report, { format: 'saylo-review-approvals/v1', baseLocale: 'ko', entries: [] });
  const work = createTranslationWorkfile(checked.inspection, report);
  for (const entry of work.entries) entry.translation = `${entry.locale} title`;
  await writeFile(path.join(root, 'work.json'), JSON.stringify(work));
  await writeFile(path.join(root, 'saylo.config.json'), JSON.stringify(config));
  const args = [command, '--file', 'work.json', '--apply', '--json', ...(command === 'approve' ? ['--reviews', 'reviews.json'] : [])];
  const run = (phase, signal = 'SIGINT', extra = {}, override = args) => spawnSync(process.execPath, ['--import', preload, cli, ...override], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000,
    env: { ...process.env, SAYLO_CANCEL_PHASE: phase, SAYLO_CANCEL_SIGNAL: signal, ...extra },
  });
  const clean = async () => assert.ok(!(await readdir(root, { recursive: true })).some(name => /\.saylo-(?:import|review)/.test(name)));
  return { root, config, run, clean };
}
function cancelled(result, signal, writtenFiles) {
  assert.equal(result.status, signal === 'SIGINT' ? 130 : 143, result.stdout + result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout); // Exactly one JSON output, after cleanup.
  assert.equal(report.format, 'saylo-command-error/v1');
  assert.equal(report.error.cancelled, true);
  assert.equal(report.error.signal, signal);
  assert.deepEqual(report.error.writtenFiles, writtenFiles);
}

test('CLI cancellation owns only its listeners, preserves the first signal and carries committed files', () => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const source = new EventEmitter(), unrelated = () => {};
    source.on('SIGINT', unrelated);
    const cancellation = createCliCancellation(source);
    cancellation.throwIfCancelled();
    source.emit(signal); const reason = cancellation.signal.reason;
    source.emit(signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT');
    assert.equal(cancellation.signal.reason, reason);
    assert.throws(() => cancellation.throwIfCancelled(['committed.json']), error => error instanceof CommandInterruptedError &&
      error.signalName === signal && error.exitCode === (signal === 'SIGINT' ? 130 : 143) && error.cause === reason && error.writtenFiles[0] === 'committed.json');
    cancellation.dispose(); cancellation.dispose();
    assert.deepEqual(source.listeners('SIGINT'), [unrelated]);
    assert.equal(source.listenerCount('SIGTERM'), 0);
  }
});

test('both apply commands clean owned locks/handles/temps when interrupted before writing or after staging opens', async t => {
  for (const command of ['import', 'approve']) for (const phase of ['workfile', 'lock', 'stage']) {
    const f = await fixture(t, command);
    cancelled(f.run(phase, 'SIGINT', { SAYLO_CANCEL_REPEAT: 'true' }), 'SIGINT', []);
    if (command === 'import') {
      for (const locale of ['en', 'fr']) await assert.rejects(readFile(path.join(f.config.localesDir, locale, 'common.json')), { code: 'ENOENT' });
    } else await assert.rejects(readFile(path.join(f.root, 'reviews.json')), { code: 'ENOENT' });
    await f.clean();
  }
});

test('SIGTERM between import commits reports the committed file and leaves the remaining locale untouched', async t => {
  const f = await fixture(t, 'import');
  cancelled(f.run('rename', 'SIGTERM'), 'SIGTERM', ['en/common.json']);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.config.localesDir, 'en/common.json'), 'utf8')), { title: 'en title' });
  await assert.rejects(readFile(path.join(f.config.localesDir, 'fr/common.json')), { code: 'ENOENT' });
  await f.clean();
});

test('a signal arriving after the last rename reports all committed files after cleanup instead of losing their status', async t => {
  const imported = await fixture(t, 'import');
  cancelled(imported.run('rename', 'SIGINT', { SAYLO_CANCEL_RENAME: '2' }), 'SIGINT', ['en/common.json', 'fr/common.json']);
  for (const locale of ['en', 'fr']) assert.equal(JSON.parse(await readFile(path.join(imported.config.localesDir, locale, 'common.json'), 'utf8')).title, `${locale} title`);
  await imported.clean();
  const approved = await fixture(t, 'approve');
  cancelled(approved.run('rename', 'SIGTERM'), 'SIGTERM', [path.join(approved.root, 'reviews.json')]);
  assert.equal(JSON.parse(await readFile(path.join(approved.root, 'reviews.json'), 'utf8')).entries.length, 1);
  await approved.clean();
});

test('success, filesystem errors and help release CLI listeners and retain their ordinary exit codes', async t => {
  for (const command of ['import', 'approve']) {
    const f = await fixture(t, command);
    const failed = f.run('none', 'SIGINT', {}, [command, '--file', 'missing.json', '--apply', '--json', ...(command === 'approve' ? ['--reviews', 'reviews.json'] : [])]);
    assert.equal(failed.status, 2, failed.stdout + failed.stderr);
    assert.equal(JSON.parse(failed.stdout).error.cancelled, undefined);
    const passed = f.run('none');
    assert.equal(passed.status, 0, passed.stdout + passed.stderr);
    assert.equal(JSON.parse(passed.stdout).dryRun, false);
    assert.equal(f.run('none', 'SIGINT', {}, ['--help']).status, 0);
    await f.clean();
  }
});
