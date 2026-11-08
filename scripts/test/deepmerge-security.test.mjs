import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import merge from '../../vendor/deepmerge/index.cjs';

test('Svelte Vite plugin resolves the development security patch', () => {
  const require = createRequire(import.meta.url);
  const pluginRequire = createRequire(require.resolve('@sveltejs/vite-plugin-svelte'));
  assert.equal(pluginRequire.resolve('deepmerge'),
    fileURLToPath(new URL('../../vendor/deepmerge/index.cjs', import.meta.url)));
  assert.equal(pluginRequire('deepmerge'), merge);
});

test('own prototype keys cannot poison merge results from either input', () => {
  const malicious = JSON.parse('{"__proto__":{"sayloPoisoned":true}}');
  for (const [target, source] of [
    [malicious, {}], [malicious, malicious], [Object.create(null), malicious],
    [{ nested: malicious }, { nested: malicious }],
  ]) {
    for (const clone of [true, false]) {
      const result = merge(target, source, { clone });
      const object = result.nested ?? result;
      assert.equal(Object.getPrototypeOf(object), Object.prototype);
      assert.equal(object.sayloPoisoned, undefined);
      assert.equal({}.sayloPoisoned, undefined);
      if (Object.hasOwn(object, '__proto__')) {
        assert.equal(Object.getOwnPropertyDescriptor(object, '__proto__').value.sayloPoisoned, true);
      }
    }
  }
  assert.equal(Object.getPrototypeOf(malicious), Object.prototype);
});

test('normal Svelte option merging retains array replacement, functions and symbols', () => {
  const marker = Symbol('config');
  const transform = value => value;
  const options = { arrayMerge: (_target, source) => source };
  const target = { compilerOptions: { dev: true }, preprocess: ['first'], [marker]: { a: 1 } };
  const source = { compilerOptions: { customElement: true }, preprocess: [transform], [marker]: { b: 2 } };
  const result = merge(target, source, options);
  assert.deepEqual(result.compilerOptions, { dev: true, customElement: true });
  assert.deepEqual(result.preprocess, [transform]);
  assert.deepEqual(result[marker], { a: 1, b: 2 });
  assert.deepEqual(target.preprocess, ['first']);
  assert.deepEqual(merge.all([{ a: 1 }, { b: 2 }]), { a: 1, b: 2 });
});
