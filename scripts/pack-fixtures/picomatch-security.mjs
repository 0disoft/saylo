import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

export function registerPicomatchSecurityTests(require) {
  const expected = readFileSync(new URL('../../vendor/picomatch/lib/parse.js', import.meta.url), 'utf8');
  const pm = require('picomatch');
  test('Vite, tinyglobby and fdir resolve the maintained picomatch security fork', () => {
    for (const consumer of ['vite', 'tinyglobby', 'fdir']) {
      const consumerRequire = createRequire(require.resolve(consumer));
      const manifest = consumerRequire('picomatch/package.json');
      assert.equal(manifest.name, '@saylo-internal/picomatch');
      assert.equal(readFileSync(consumerRequire.resolve('picomatch/lib/parse'), 'utf8'), expected);
      assert.equal(consumerRequire('picomatch'), pm);
    }
  });
  test('single-branch repeated wildcards compile to literals and cannot backtrack', () => {
    // A regressed matcher must not hang the test process.
    const result = spawnSync(process.execPath, ['--input-type=commonjs', '-e', String.raw`
      const assert = require('node:assert/strict');
      const pm = require(process.argv[1]);
      for (const pattern of ['+(*)', '*(*)', '+(*a)', '*(a*)', '+(a*b)', '+([ab]*)', '+(@(*a))']) {
        const escaped = pattern.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
        const re = pm.makeRe(pattern);
        assert.equal(re.source, '^(?:' + escaped + ')$');
        assert.equal(re.test(pattern), true);
        assert.equal(re.test('a'.repeat(128) + '!'), false);
      }
    `, require.resolve('picomatch')], { timeout: 5000, windowsHide: true, encoding: 'utf8' });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
  });
  test('ordinary file globs, bounded repetition and literal stars keep their meaning', () => {
    for (const [value, pattern, matches] of [
      ['src/a.ts', '**/*.ts', true], ['src/a.js', '**/*.ts', false],
      ['enkoen', '+(en|ko)', true], ['fr', '+(en|ko)', false],
      ['***', '+(\\*)', true], ['***', '+([*])', true], ['***', '+("*")', true],
      ['abba', '+(*(a)|*(b))', true], ['abca', '+(*(a)|*(b))', false],
    ]) assert.equal(pm.isMatch(value, pattern), matches, `${value} / ${pattern}`);
  });
}
