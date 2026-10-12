import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'vite';
import demoConfig from '../examples/react/vite.config.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const parent = path.join(repository, '.release');
await mkdir(parent, { recursive: true });
const reportPath = path.join(parent, 'react-selected-report.json');
await rm(reportPath, { force: true });
const root = await mkdtemp(path.join(parent, 'react-selected-'));
const app = path.join(root, 'examples/react');
const exec = promisify(execFile);
const marker = 'SAYLO_SELECTED_UNUSED_MESSAGE';
const contract = `import type { Translator } from '@0disoft/saylo-core';
import type { AppSchema } from './generated';
import type { DemoSchema } from './selected-keys.mjs';
import type { store, useI18n } from './i18n';

function contract(full: Translator<AppSchema>, selected: Translator<DemoSchema>,
  snapshot: ReturnType<typeof store.getSnapshot>, hook: ReturnType<typeof useI18n>,
  dynamic: 'demo:heading' | 'demo:description') {
  full.t('demo:unused'); // The real generated schema still contains this key.
  selected.t(dynamic);
  selected.t('demo:summary', { count: 2 });
  snapshot.t('demo:heading');
  hook.t('demo:summary', { count: 2 });
  // @ts-expect-error excluded from the selected translator
  selected.t('demo:unused');
  // @ts-expect-error the actual application store also rejects excluded keys
  snapshot.t('demo:unused');
  // @ts-expect-error the actual React hook also rejects excluded keys
  hook.t('demo:unused');
  // @ts-expect-error argument types survive Pick
  hook.t('demo:summary', { count: 'wrong' });
  // @ts-expect-error required arguments survive Pick
  selected.t('demo:summary');
  // @ts-expect-error plain strings are not a bounded dynamic key
  selected.t('demo:heading' as string);
}
// @ts-expect-error the list cannot contain an unknown source key
const invalid = ['demo:missing'] as const satisfies readonly (keyof AppSchema)[];
`;
async function node(args, env = process.env) {
  try {
    const result = await exec(process.execPath, args, { cwd: repository, env, windowsHide: true, maxBuffer: 1024 * 1024 });
    if (result.stdout) process.stdout.write(result.stdout);
  } catch (error) {
    throw new Error(`Selected React verification command failed\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, { cause: error });
  }
}
try {
  await cp(path.join(repository, 'examples/react'), app, { recursive: true,
    filter: source => !['dist', 'dist-selected'].includes(path.basename(source)) });
  for (const name of ['vanilla/locales', 'vanilla/style.css', 'shared'])
    await cp(path.join(repository, 'examples', name), path.join(root, 'examples', name), { recursive: true });
  for (const locale of ['ko', 'en']) {
    const file = path.join(root, `examples/vanilla/locales/${locale}/demo.json`);
    const catalog = JSON.parse(await readFile(file, 'utf8'));
    catalog.unused = `${marker} ${locale}`;
    await writeFile(file, JSON.stringify(catalog));
  }
  await node([path.join(repository, 'packages/typegen/dist/cli.js'), '--locales-dir', path.join(root, 'examples/vanilla/locales'),
    '--base-locale', 'ko', '--out-file', path.join(app, 'generated.d.ts')]);
  const generated = await readFile(path.join(app, 'generated.d.ts'), 'utf8');
  assert.ok(generated.includes('"demo:unused"'));
  await writeFile(path.join(app, 'selected-contract.ts'), contract);
  const tsManifestUrl = import.meta.resolve('typescript/package.json');
  const tsManifest = JSON.parse(await readFile(fileURLToPath(tsManifestUrl), 'utf8'));
  await node([fileURLToPath(new URL(tsManifest.bin.tsc, tsManifestUrl)), '-p', path.join(app, 'tsconfig.json')]);
  console.log('[react-selected] Full generated schema, selected translator/store/hook and argument type contracts passed');
  const config = demoConfig({ mode: 'selected' });
  const result = await build({ ...config, configFile: false, root: app, logLevel: 'warn' });
  const chunks = result.output.filter(chunk => chunk.type === 'chunk');
  assert.ok(chunks.some(chunk => chunk.isDynamicEntry), 'English must still be lazy loaded');
  assert.ok(chunks.every(chunk => !chunk.code.includes(marker)), 'Unused text leaked into selected chunks');
  assert.equal(await readFile(path.join(app, 'generated.d.ts'), 'utf8'), generated, 'Build must retain full typegen');
  await node(['--experimental-vm-modules', '--test', path.join(repository, 'scripts/test/react-demo-lifecycle.test.mjs')],
    { ...process.env, SAYLO_REACT_TEST_DIST: path.join(app, config.build.outDir) });
  const inputs = {};
  for (const name of ['examples/react/selected-keys.mts', 'examples/react/i18n.ts', 'examples/react/vite.config.mjs',
    'scripts/verify-react-selected.mjs', 'scripts/test/react-demo-lifecycle.test.mjs'])
    inputs[name] = createHash('sha256').update(await readFile(path.join(repository, name))).digest('hex');
  await writeFile(reportPath, JSON.stringify({ ok: true, observedAt: new Date().toISOString(), node: process.version,
    fixture: 'copied React example with one known unused message per locale', inputs,
    checks: ['full-and-selected-type-contracts', 'retained-full-typegen', 'selected-lazy-production-chunks',
      'production-bundle-jsdom-lifecycle'], browser: false }, null, 2) + '\n');
  console.log(`[react-selected] Report: ${reportPath}`);
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(parent));
  assert.ok(path.basename(root).startsWith('react-selected-'));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
