import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTranslator, parseCatalog } from '@0disoft/saylo-core';
import { migrateI18next } from '../dist/migrate-i18next.js';

const options = { locale: 'en', namespace: 'shop', escapeValue: false };
function translator(resource, settings = options) {
  const result = migrateI18next(JSON.stringify(resource), settings);
  assert.equal(result.blocked, false, JSON.stringify(result.issues));
  const catalog = parseCatalog(JSON.stringify(result.catalog), settings);
  return { ...result, t: createTranslator({ locale: settings.locale, baseCatalogs: [catalog] }).t };
}

test('migration flattens nested keys, preserves prototype names, empty strings, apostrophes and literal ICU syntax', () => {
  const resource = JSON.parse('{"nested":{"hello":"Hello {{name}}"},"__proto__":"Safe","empty":""}');
  for (const text of ["don't", '{}', '#', "'{#}'", "a'{{name}}'{x}#", "{{name}}{'#'}{{name}}", 'a}}b']) {
    const result = migrateI18next(JSON.stringify({ text }), options);
    if (text === 'a}}b') { assert.equal(result.blocked, true); continue; }
    const { t } = translator({ text });
    assert.equal(t('shop:text', text.includes('{{name}}') ? { name: 'N' } : undefined), text.replaceAll('{{name}}', 'N'));
  }
  const { t, mappings } = translator(resource);
  assert.equal(t('shop:nested.hello', { name: '<b>A</b>' }), 'Hello <b>A</b>');
  assert.equal(t('shop:__proto__'), 'Safe');
  assert.equal(t('shop:empty'), '');
  assert.ok(mappings.some(item => item.targetKey === 'shop:nested.hello'));
  assert.equal(Object.getPrototypeOf(resource), Object.prototype);
});

test('migration combines cardinal plurals with exact-zero overrides, raw count interpolation and literal #', () => {
  const { t } = translator({ cart_zero: 'Empty', cart_one: '{{count}} item #', cart_other: '{{count}} items #' });
  for (const [count, expected] of [[0, 'Empty'], [1, '1 item #'], [2, '2 items #'], [1000, '1000 items #'], [-1, '-1 item #'], [1.5, '1.5 items #']])
    assert.equal(t('shop:cart', { count }), expected);
  const arabic = translator(Object.fromEntries(['zero', 'one', 'two', 'few', 'many', 'other'].map(category => [`n_${category}`, category])),
    { ...options, locale: 'ar' });
  for (const [count, expected] of [[0, 'zero'], [1, 'one'], [2, 'two'], [3, 'few'], [11, 'many'], [100, 'other']])
    assert.equal(arabic.t('shop:n', { count }), expected);
  const latvian = translator({ n_zero: 'zero', n_one: 'one', n_other: 'other' }, { ...options, locale: 'lv' });
  assert.equal(latvian.t('shop:n', { count: 10 }), 'zero');
});

test('ambiguous or unsupported resource behavior blocks the whole output instead of dropping messages', () => {
  const samples = [
    [{ nested: { x: 'one' }, 'nested.x': 'two' }, 'KEY_COLLISION'],
    [{ x: ['a'] }, 'UNSUPPORTED_VALUE'], [{ x: {} }, 'UNSUPPORTED_VALUE'], [{ x: null }, 'UNSUPPORTED_VALUE'],
    [{ x: '{{model.name}}' }, 'UNSUPPORTED_INTERPOLATION'], [{ x: '{{n, currency}}' }, 'UNSUPPORTED_INTERPOLATION'],
    [{ x: '$t(other)' }, 'UNSUPPORTED_SYNTAX'], [{ x_ordinal_one: 'a', x_ordinal_other: 'b' }, 'UNSUPPORTED_SYNTAX'],
    [{ x_one: 'a' }, 'PLURAL_CONFLICT'], [{ x: 'a', x_one: 'b', x_other: 'c' }, 'PLURAL_CONFLICT'],
    [{ x: '{{name}}' }, 'ESCAPING_POLICY'],
  ];
  for (const [resource, code] of samples) {
    const result = migrateI18next(JSON.stringify(resource), { locale: 'en', namespace: 'shop' });
    assert.equal(result.blocked, true);
    assert.equal(result.catalog, null);
    assert.ok(result.issues.some(issue => issue.code === code), JSON.stringify(result.issues));
  }
  assert.throws(() => migrateI18next('{"x":"a","\\u0078":"b"}', options), /Duplicate/);
  assert.throws(() => migrateI18next('{"x":{"a":"1","a":"2"}}', options), /Duplicate/);
  assert.equal(migrateI18next('{"x":"{{- name}}"}', { locale: 'en', namespace: 'shop' }).blocked, false);
});

test('translation migration validates the existing base argument contract', () => {
  const baseCatalog = parseCatalog('{"hello":"Hello {name}"}', { locale: 'en', namespace: 'shop' });
  assert.equal(migrateI18next('{"hello":"Bonjour {{name}}"}', { ...options, locale: 'fr', baseCatalog }).blocked, false);
  assert.equal(migrateI18next('{"hello":"Bonjour {{other}}"}', { ...options, locale: 'fr', baseCatalog }).issues[0].code, 'CATALOG_CONTRACT');
});

test('migration CLI previews, writes an exclusive catalog, refuses overwrite and preserves inputs on blocked conversion', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-migrate-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('saylo-migrate-'));
    await rm(root, { recursive: true, force: true });
  });
  const cli = fileURLToPath(new URL('../dist/catalog-cli.js', import.meta.url));
  const input = '{"greeting":"Hi {{name}}"}';
  await writeFile(path.join(root, 'source.json'), input);
  const args = ['migrate', '--from', 'i18next', '--file', 'source.json', '--locale', 'en', '--namespace', 'shop', '--json'];
  const run = extra => spawnSync(process.execPath, [cli, ...args, ...extra], { cwd: root, encoding: 'utf8', timeout: 20000, windowsHide: true });
  const blocked = run(['--out-file', 'target.json']);
  assert.equal(blocked.status, 1, blocked.stderr);
  assert.deepEqual(await readdir(root), ['source.json']);
  const preview = run(['--escape-value', 'false']);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).catalog.greeting, 'Hi {name}');
  assert.deepEqual(await readdir(root), ['source.json']);
  const applied = run(['--escape-value', 'false', '--out-file', 'target.json']);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'target.json'), 'utf8')), { greeting: 'Hi {name}' });
  assert.equal(run(['--escape-value', 'false', '--out-file', 'target.json']).status, 2);
  assert.equal(run(['--escape-value', 'false', '--out-file', 'source.json']).status, 2);
  assert.equal(await readFile(path.join(root, 'source.json'), 'utf8'), input);
});
