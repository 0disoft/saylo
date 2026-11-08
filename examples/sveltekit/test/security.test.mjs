import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

test('the independently installed Svelte plugin uses the patched merge implementation', async () => {
  const require = createRequire(import.meta.url);
  const pluginRequire = createRequire(require.resolve('@sveltejs/vite-plugin-svelte'));
  const installed = pluginRequire.resolve('deepmerge');
  assert.equal(await readFile(installed, 'utf8'),
    await readFile(new URL('../../../vendor/deepmerge/index.cjs', import.meta.url), 'utf8'));
  const merge = pluginRequire('deepmerge');
  const malicious = JSON.parse('{"__proto__":{"sayloPoisoned":true}}');
  for (const [target, source] of [[malicious, {}], [malicious, malicious], [Object.create(null), malicious]]) {
    const result = merge(target, source);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(result.sayloPoisoned, undefined);
  }
  assert.equal({}.sayloPoisoned, undefined);
  assert.deepEqual(merge({ compilerOptions: { dev: true } }, { compilerOptions: { customElement: true } }),
    { compilerOptions: { dev: true, customElement: true } });
});
