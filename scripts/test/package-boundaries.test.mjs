import assert from 'node:assert/strict';
import test from 'node:test';
import { checkBoundaries, moduleReferences } from '../check-package-boundaries.mjs';

function fixture() {
  const manifests = {};
  const sources = new Map();
  for (const id of ['core', 'react', 'svelte', 'vue', 'typegen', 'vite']) {
    manifests[id] = { name: `@0disoft/saylo-${id}`, dependencies: id === 'core' ? {}
      : { '@0disoft/saylo-core': 'test', ...(id === 'vite' ? { '@0disoft/saylo-typegen': 'test' } : {}) },
    exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' } } };
    sources.set(`packages/${id}/src/index.ts`, 'export {};');
  }
  manifests.vite.exports['./client'] = { import: './dist/client.js', types: './dist/client.d.ts' };
  sources.set('packages/vite/src/client.ts', 'export {};');
  return { manifests, sources, run() { return checkBoundaries(manifests, sources); } };
}
const codes = result => result.violations.map(item => item.code);

test('Vue adapter permits its declared peer and core types but rejects Node runtime imports', () => {
  const f = fixture();
  f.manifests.vue.peerDependencies = { vue: '3' };
  f.sources.set('packages/vue/src/index.ts', "import { shallowRef } from 'vue'; export type { Schema } from '@0disoft/saylo-core';");
  assert.deepEqual(f.run().violations, []);
  f.sources.set('packages/vue/src/index.ts', "import 'node:fs';");
  assert.deepEqual(codes(f.run()), ['BROWSER_NODE']);
});

test('parses import/export syntax and TS import types, ignoring comments and generated source strings', () => {
  const refs = moduleReferences(`
// import 'node:fs';
const generated = "import 'node:path'";
import { type Schema } from '@0disoft/saylo-core';
import { type Schema as Other, createStore } from '@0disoft/saylo-core';
export type { Schema as Public } from '@0disoft/saylo-core';
type T = import('@0disoft/saylo-core').Schema;
const load = () => import('node:fs');
`, 'packages/vite/src/client.ts');
  assert.deepEqual(refs.map(ref => [ref.specifier, ref.typeOnly]), [
    ['@0disoft/saylo-core', true], ['@0disoft/saylo-core', false],
    ['@0disoft/saylo-core', true], ['@0disoft/saylo-core', true], ['node:fs', false],
  ]);
  assert.equal(refs[4].line, 8);
});

test('allows declared peers, dependency direction, public entries and Node runtime in typegen', () => {
  const f = fixture();
  f.manifests.react.peerDependencies = { react: '19' };
  f.sources.set('packages/react/src/index.ts', "import { createElement } from 'react'; export type { Schema } from '@0disoft/saylo-core';");
  f.sources.set('packages/typegen/src/index.ts', "import { readFile } from 'node:fs/promises'; export type T = import('@0disoft/saylo-core').Schema;");
  assert.deepEqual(f.run().violations, []);
  f.manifests.react.peerDependencies = { react: '19' };
  f.sources.set('packages/react/src/index.ts', "export * from './view.js';");
  f.sources.set('packages/react/src/view.tsx', "import { createElement } from 'react'; export const View = () => <div />;");
  assert.deepEqual(f.run().violations, []);
});

test('rejects reverse dependencies in both manifest and type-only source references', () => {
  const f = fixture();
  f.manifests.core.dependencies['@0disoft/saylo-vite'] = 'test';
  f.sources.set('packages/core/src/index.ts', "export type T = import('@0disoft/saylo-vite').Options;");
  assert.equal(f.run().violations.filter(item => item.code === 'DIRECTION').length, 2);
});

test('rejects undeclared imports, nonexported subpaths and relative package bypasses', () => {
  const f = fixture();
  f.sources.set('packages/react/src/index.ts', "import 'undeclared'; export type { Hidden } from '@0disoft/saylo-core/dist/private.js'; export * from '../../core/src/index.js';");
  assert.deepEqual(codes(f.run()), ['UNDECLARED', 'PRIVATE_EXPORT', 'PRIVATE_PATH']);
});

test('follows runtime reexports and dynamic imports from Vite client; type-only Node references stay erased', () => {
  const f = fixture();
  f.sources.set('packages/vite/src/client.ts', "export * from './bridge.js'; import type { Stats } from 'node:fs';");
  f.sources.set('packages/vite/src/bridge.ts', "const load = () => import('./server-only.js'); export { load };");
  f.sources.set('packages/vite/src/server-only.ts', "import 'fs'; export {};");
  assert.deepEqual(codes(f.run()), ['BROWSER_NODE']);
  assert.equal(f.run().violations[0].file, 'packages/vite/src/server-only.ts');
  assert.match(f.run().violations[0].message, /client\.ts/);
});

test('checks require and rejects computed imports or missing local sources with file coordinates', () => {
  const f = fixture();
  f.sources.set('packages/core/src/index.ts', "require('node:fs');\nconst load = (name: string) => import(name);\nexport * from './missing.js';");
  assert.deepEqual(codes(f.run()).sort(), ['BROWSER_NODE', 'COMPUTED_IMPORT', 'MISSING_SOURCE']);
  assert.equal(f.run().violations.find(item => item.code === 'COMPUTED_IMPORT').line, 2);
});

test('syntax errors and a runtime use of a type-only export fail the check', () => {
  const f = fixture();
  f.manifests.core.exports['./types'] = { types: './dist/virtual.d.ts' };
  f.sources.set('packages/core/src/virtual.d.ts', 'export interface T {}');
  f.sources.set('packages/react/src/index.ts', "import '@0disoft/saylo-core/types';");
  f.sources.set('packages/svelte/src/index.ts', 'export const = ;');
  assert.deepEqual(codes(f.run()), ['NO_RUNTIME_EXPORT', 'SYNTAX']);
  f.sources.set('packages/react/src/index.ts', "export type { T } from '@0disoft/saylo-core/types';");
  f.sources.set('packages/svelte/src/index.ts', 'export {};');
  assert.deepEqual(f.run().violations, []);
});
