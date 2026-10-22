import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadProjectConfig, resolveProjectConfig } from '../dist/config.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-config-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('saylo-config-'));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test('shared JSON settings resolve paths from their own directory and copy nested caller values', async t => {
  const root = await fixture(t);
  const input = { format: 'saylo-project/v1', localesDir: 'locales', baseLocale: 'en-us',
    richText: { demo: { terms: ['strong', 'link'] } }, checkLocales: ['ko'], initialNamespaces: ['demo'],
    typegen: { outFile: 'generated.d.ts' }, baseline: 'review.json', timeZone: 'UTC',
    requireReviewedTranslations: true, reviews: 'approvals.json' };
  const file = path.join(root, 'saylo.config.json');
  await writeFile(file, '\uFEFF' + JSON.stringify(input));
  const loaded = loadProjectConfig(file);
  assert.equal(loaded.baseLocale, 'en-US');
  assert.equal(loaded.localesDir, path.join(root, 'locales'));
  assert.equal(loaded.typegen.outFile, path.join(root, 'generated.d.ts'));
  assert.equal(loaded.baseline, path.join(root, 'review.json'));
  assert.equal(loaded.requireReviewedTranslations, true);
  assert.equal(loaded.reviews, path.join(root, 'approvals.json'));
  const direct = resolveProjectConfig(input, root);
  input.richText.demo.terms.push('em'); input.checkLocales.push('fr');
  assert.deepEqual(direct, loaded);
  assert.equal(Object.isFrozen(input.richText.demo.terms), false);
  assert.ok(Object.isFrozen(loaded.richText.demo.terms));
});

test('config validation rejects misspelled fields and invalid domain policies', () => {
  const base = { localesDir: 'locales', baseLocale: 'ko' };
  for (const extra of [{ format: 'other' }, { localeDir: 'typo' }, { baseLocale: '' }, { timeZone: 'Invalid/Zone' },
    { checkLocales: ['en-us', 'en-US'] }, { initialNamespaces: ['../bad'] }, { typegen: { outFile: 'app.ts' } },
    { richText: { demo: { terms: ['bad tag'] } } }, { richText: { demo: { terms: ['link', 'link'] } } },
    { requireReviewedTranslations: 'true' }, { requireReviewedTranslations: true },
    { requireReviewedTranslations: true, reviews: '' }])
    assert.throws(() => resolveProjectConfig({ ...base, ...extra }));
});

test('legacy typegen CLI shares rich policy and keeps output intact on failure', async t => {
  const root = await fixture(t);
  for (const locale of ['ko', 'en']) await mkdir(path.join(root, 'locales', locale), { recursive: true });
  await writeFile(path.join(root, 'locales/ko/demo.json'), '{"terms":"<link>약관</link>"}');
  const translation = path.join(root, 'locales/en/demo.json');
  await writeFile(translation, '{"terms":"<lnik>Terms</lnik>"}');
  const config = path.join(root, 'saylo.config.json');
  await writeFile(config, JSON.stringify({ localesDir: 'locales', baseLocale: 'ko',
    richText: { demo: { terms: ['link'] } }, typegen: { outFile: 'generated.d.ts' } }));
  const out = path.join(root, 'generated.d.ts'); await writeFile(out, '// keep');
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const run = extra => spawnSync(process.execPath, [cli, '--config', config, ...extra], { encoding: 'utf8', windowsHide: true });
  const failed = run([]); assert.equal(failed.status, 1); assert.match(failed.stderr, /lnik/);
  assert.equal(await readFile(out, 'utf8'), '// keep');
  await writeFile(translation, '{"terms":"<link>Terms</link>"}');
  const passed = run([]); assert.equal(passed.status, 0, passed.stderr);
  assert.match(await readFile(out, 'utf8'), /demo:terms/);
  const explicit = path.join(root, 'explicit.d.ts');
  assert.equal(run(['--out-file', explicit]).status, 0);
  assert.match(await readFile(explicit, 'utf8'), /demo:terms/);
  assert.equal(run(['--help']).status, 0);
});
