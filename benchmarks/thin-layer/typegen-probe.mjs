import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import saylo from '@0disoft/saylo-vite';
import { createI18n, createBaseSchema, parseCatalog } from '@0disoft/saylo-core';
import { renderTypes } from '@0disoft/saylo-typegen';
import { createLazyLayer } from './lazy-layer.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const repository = fileURLToPath(new URL('../..', import.meta.url));
const { values } = parseArgs({ options: { out: { type: 'string', default: 'benchmarks/results/thin-layer-typegen-current.json' } } });
const root = await mkdtemp(path.join(directory, '.typegen-probe-'));
const exec = promisify(execFile), observations = [], diagnostics = [], instances = [], bootRestorations = [];
const hash = value => createHash('sha256').update(value).digest('hex');
const base = JSON.parse('{"plain":"Plain","greeting":"Hello {name}","rows":"{count, plural, one {one row} other {# rows}}","when":"{at, date}","choice":"{mode, select, one {{extra}} other {Other}}","mixed":"{count} / {count, number}","literal.dot":"Literal","reserved":"{lng} / {ns}","__proto__":"{constructor}"}');
const schemas = new Map([['demo', base], ['help', { title: 'Help' }]]);
const generatedFile = path.join(root, 'generated.d.ts');
let vite, source, interrupted;
const interrupt = () => { interrupted = new Error('Typegen probe interrupted.'); };
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
async function until(read, accepts, label) {
  const deadline = Date.now() + 10000;
  let value;
  while (Date.now() < deadline) {
    if (interrupted) throw interrupted;
    value = await read(); if (accepts(value)) return value; await delay(30);
  }
  throw new Error(`Timeout ${label}: ${JSON.stringify(value)}`);
}
const declaration = () => renderTypes([...schemas].map(([namespace, messages]) =>
  createBaseSchema(parseCatalog(JSON.stringify(messages), { namespace, locale: 'en' }))));
async function generated() {
  await until(() => readFile(generatedFile, 'utf8'), text => text === declaration(), 'live declaration');
  const text = await readFile(generatedFile, 'utf8'), info = await stat(generatedFile);
  return { text, sha256: hash(text), mtimeMs: info.mtimeMs };
}
async function compiler(files, expectedSuccess = true) {
  const config = path.join(root, 'tsconfig.json');
  await writeFile(config, JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
    strict: true, allowJs: true, checkJs: true, noEmit: true, skipLibCheck: false, types: ['node', 'vite/client'] }, files }));
  let status = 0, output = '';
  try { const result = await exec(process.execPath, [path.join(repository, 'node_modules/typescript/bin/tsc'), '-p', config, '--pretty', 'false'],
    { cwd: repository, timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true }); output = result.stdout + result.stderr; }
  catch (error) { status = error.code; output = (error.stdout ?? '') + (error.stderr ?? ''); }
  if (expectedSuccess) assert.equal(status, 0, output);
  else { assert.notEqual(status, 0); assert.match(output, /TS2578/, 'Any-control must make negative checks unused'); }
  return { status, output };
}
const tsTemplate = await readFile(new URL('type-consumer.ts', import.meta.url), 'utf8');
const jsTemplate = await readFile(new URL('type-consumer-js.js', import.meta.url), 'utf8');
async function writeConsumers(withRole = false, phase = '') {
  const adapt = text => withRole ? text.replace(/\.t\('demo:greeting', \{ name: ([^}]+) \}\)/g,
    ".t('demo:greeting', { name: $1, role: 'member' })") : text;
  await writeFile(path.join(root, 'consumer.ts'), adapt(tsTemplate));
  await writeFile(path.join(root, 'consumer-js.js'), adapt(jsTemplate));
  await writeFile(path.join(root, 'phase.ts'), `import {createI18n} from '@0disoft/saylo-core/runtime';
    import {createLazyLayer} from '../lazy-layer.mjs';
    import type {CatalogSource} from '@0disoft/saylo-core/runtime';
    import type {AppSchema} from './generated.js';
    declare const source:CatalogSource;
    const options={catalogSource:source,locale:'ja',initialCatalogs:[],initialNamespaces:[]};
    const core=createI18n<AppSchema>(options),layer=await createLazyLayer<AppSchema>(options);
    for(const instance of [core,layer]) { ${phase} }`);
}
async function check(id, withRole = false, phase = '') {
  await writeConsumers(withRole, phase);
  const result = await compiler(['consumer.ts', 'consumer-js.js', 'phase.ts']);
  for (const instance of instances) await instance.refresh();
  const types = await generated();
  observations.push({ id, compiler: result, declaration: types.text, declarationSha256: types.sha256,
    declarationMtimeMs: types.mtimeMs, manifestRevision: source.readManifest().registryRevision,
    snapshots: instances.map((instance, index) => ({ variant: index ? 'layer' : 'core', locale: instance.getSnapshot().locale,
      loadedNamespaces: instance.getSnapshot().loadedNamespaces, greeting: instance.t('demo:greeting',
        { name: 'Ada', ...(withRole ? { role: 'member' } : {}) }), plain: instance.t('demo:plain') })) });
  console.log(`[typegen] ${id}: TS/checkJs and both live runtimes PASS`);
  return types;
}
async function edit(locale, namespace, value) {
  const revision = source.readManifest().registryRevision;
  await writeFile(path.join(root, 'locales', locale, `${namespace}.json`), JSON.stringify(value));
  await until(async () => source.readManifest().registryRevision, next => next > revision, `${locale}/${namespace} publication`);
}
try {
  await writeFile(path.join(root, 'package.json'), '{"private":true,"type":"module"}');
  for (const locale of ['en', 'ja']) await mkdir(path.join(root, 'locales', locale), { recursive: true });
  for (const [namespace, messages] of schemas) await writeFile(path.join(root, 'locales/en', `${namespace}.json`), JSON.stringify(messages));
  await writeFile(path.join(root, 'locales/ja/demo.json'), JSON.stringify({ greeting: 'JA {name}' }));
  const observer = { name: 'typegen-diagnostic-observer', configureServer(server) {
    const send = server.ws.send;
    server.ws.send = function(payload, ...args) {
      if (payload?.type === 'custom' && payload.event === 'saylo:eager-diagnostic' && payload.data.message)
        diagnostics.push(payload.data.message);
      return send.call(this, payload, ...args);
    };
  } };
  vite = await createServer({ configFile: false, root, logLevel: 'error', plugins: [
    saylo({ localesDir: 'locales', baseLocale: 'en', initialLocale: 'ja', initialNamespaces: [], timeZone: 'UTC', typegen: { outFile: 'generated.d.ts' } }), observer],
    server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [repository] } } });
  await vite.listen();
  ({ catalogSource: source } = await vite.ssrLoadModule('virtual:saylo/server'));
  await until(async () => vite.watcher.getWatched(), watched => Object.values(watched).some(names => names.includes('demo.json')), 'watcher initial scan');
  const options = { catalogSource: source, locale: 'ja', initialNamespaces: [], initialCatalogs: [], timeZone: 'UTC' };
  instances.push(createI18n(options), await createLazyLayer(options));
  for (const instance of instances) { await instance.loadNamespace('demo'); await instance.loadNamespace('help'); }
  const initial = await check('startup');
  // Control: an any-returning declaration must fail the consumer. Otherwise
  // green expected-error tests could hide a missing or overly broad facade.
  await writeFile(path.join(root, 'loose.mjs'), 'export const createLazyLayer=()=>{};');
  await writeFile(path.join(root, 'loose.d.mts'), "export function createLazyLayer<S>(options:unknown):Promise<any>; export type LazyLayer<S>=any;");
  await writeFile(path.join(root, 'loose.ts'), tsTemplate.replaceAll('../lazy-layer.mjs', './loose.mjs'));
  const anyControl = await compiler(['loose.ts'], false);
  const retained = instances.map(instance => instance.getSnapshot());
  await edit('ja', 'demo', { greeting: 'JA-updated {name}' });
  const translated = await check('translation-text-only'); assert.equal(translated.sha256, initial.sha256); assert.equal(translated.mtimeMs, initial.mtimeMs);
  assert.ok(instances.every(instance => instance.t('demo:greeting', { name: 'Ada' }) === 'JA-updated Ada'));
  assert.ok(retained.every(snapshot => snapshot.t('demo:greeting', { name: 'Ada' }) === 'JA Ada'));
  base.plain = 'New plain'; await edit('en', 'demo', base);
  const textOnly = await check('base-text-only'); assert.equal(textOnly.sha256, initial.sha256); assert.equal(textOnly.mtimeMs, initial.mtimeMs);
  const diagnosticCount = diagnostics.length;
  await writeFile(path.join(root, 'locales/en/demo.json'), '{');
  await until(async () => diagnostics.length, next => next > diagnosticCount, 'invalid base diagnostic');
  const invalid = await check('invalid-base-last-good'); assert.equal(invalid.sha256, initial.sha256); assert.equal(invalid.mtimeMs, initial.mtimeMs);
  assert.ok(instances.every(instance => instance.t('demo:plain') === 'New plain'));
  base.added = 'New {value}'; await edit('en', 'demo', base); await generated();
  const added = await check('recover-and-add-key', false, `instance.t('demo:added',{value:'X'});
    // @ts-expect-error added key requires value
    instance.t('demo:added');`);
  assert.notEqual(added.sha256, initial.sha256);
  assert.ok(instances.every(instance => instance.t('demo:added', { value: 'X' }) === 'New X'));
  const beforeRemoval = instances.map(instance => instance.getSnapshot());
  base.greeting = 'Hello {name} {role}'; await edit('en', 'demo', base); await generated();
  await check('add-required-argument', true, `instance.t('demo:greeting',{name:'Ada',role:'member'});
    // @ts-expect-error new baseline role remains required even if translation omits it
    instance.t('demo:greeting',{name:'Ada'});`);
  for (const instance of instances) assert.throws(() => instance.t('demo:greeting', { name: 'Ada' }), { name: 'InvalidArgumentError' });
  delete base.added; await edit('en', 'demo', base); await generated();
  await check('remove-key', true, `// @ts-expect-error removed key disappears from generated schema
    instance.t('demo:added',{value:'X'});`);
  for (const instance of instances) assert.throws(() => instance.t('demo:added', { value: 'X' }), { name: 'UnknownMessageError' });
  assert.ok(beforeRemoval.every(snapshot => snapshot.t('demo:added', { value: 'X' }) === 'New X'));
  schemas.set('late', { status: 'Late {state}' }); await edit('en', 'late', schemas.get('late')); await generated();
  for (const instance of instances) await instance.loadNamespace('late');
  await check('add-namespace', true, `instance.t('late:status',{state:'ready'});
    // @ts-expect-error new namespace arguments are required
    instance.t('late:status');`);
  assert.ok(instances.every(instance => instance.t('late:status', { state: 'ready' }) === 'Late ready'));
  const retainedLate = instances.map(instance => instance.getSnapshot()), revision = source.readManifest().registryRevision;
  schemas.delete('late'); await rm(path.join(root, 'locales/en/late.json'));
  await until(async () => source.readManifest().registryRevision, next => next > revision, 'namespace removal'); await generated();
  await check('remove-namespace', true, `// @ts-expect-error removed namespace disappears from generated schema
    instance.t('late:status',{state:'ready'});`);
  for (const instance of instances) assert.throws(() => instance.t('late:status', { state: 'ready' }), { name: 'UnknownMessageError' });
  assert.ok(retainedLate.every(snapshot => snapshot.t('late:status', { state: 'ready' }) === 'Late ready'));
  for (const [index, instance] of instances.entries()) {
    const boot = instance.getBootSnapshot();
    const restored = index ? await createLazyLayer({ catalogSource: source, initialSnapshot: JSON.stringify(boot) })
      : createI18n({ catalogSource: source, initialSnapshot: boot });
    try {
      // Boot is a JSON contract; decoding need not preserve dictionary prototypes.
      assert.deepEqual(JSON.parse(JSON.stringify(restored.getBootSnapshot())), JSON.parse(JSON.stringify(boot)));
      assert.equal(restored.t('demo:greeting', { name: 'Ada', role: 'member' }), 'JA-updated Ada');
      assert.throws(() => restored.t('demo:greeting', { name: 'Ada' }), { name: 'InvalidArgumentError' });
      bootRestorations.push({ variant: index ? 'layer' : 'core', input: index ? 'serialized-json' : 'boot-object',
        serializedDataEqual: true, greeting: 'JA-updated Ada', newArgumentEnforced: true });
    } finally { restored.dispose(); }
  }
  const files = ['benchmarks/thin-layer/lazy-layer.d.mts', 'benchmarks/thin-layer/lazy-layer.mjs', 'benchmarks/thin-layer/lazy-source-cache.mjs',
    'benchmarks/thin-layer/typegen-probe.mjs', 'benchmarks/thin-layer/type-consumer.ts', 'benchmarks/thin-layer/type-consumer-js.js',
    'packages/core/dist/runtime.d.ts', 'packages/core/dist/types.d.ts', 'packages/core/dist/i18n.js',
    'packages/typegen/dist/render.js', 'packages/typegen/dist/generator.js', 'packages/typegen/dist/worker.js',
    'packages/typegen/dist/write.js', 'packages/vite/dist/index.js', 'packages/vite/dist/live-registry.js', 'package-lock.json'];
  const codeHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(path.join(repository, file)))])));
  await writeFile(path.resolve(repository, values.out), JSON.stringify({ format: 'saylo-thin-layer-typegen-v1', observedAt: new Date().toISOString(),
    node: process.version, typescript: JSON.parse(await readFile(path.join(repository, 'node_modules/typescript/package.json'))).version,
    codeHashes, anyControl, diagnostics, observations, bootRestorations,
    scope: 'Private handwritten .d.mts facade reuses public Saylo schema/options/I18n types; actual TypeScript and checkJs consumers with generated base schema. React/Svelte/bridge compatibility is compile-time only. Real Vite dev typegen worker and public SSR catalog source with explicit runtime refresh for core and prototype. Nine lifecycle phases. No browser editor type service, automatic browser type refresh, standalone native i18next typegen, implementation checkJs, race/performance/memory/full equivalence claim.' }, null, 2) + '\n');
} finally {
  for (const instance of instances) instance.dispose();
  await vite?.close();
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(directory)); assert.ok(path.basename(resolved).startsWith('.typegen-probe-'));
  await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
