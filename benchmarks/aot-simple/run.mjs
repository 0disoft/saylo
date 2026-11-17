import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { createTranslator, parseCatalog } from '@0disoft/saylo-core';
import { createAstFormatter } from '../../packages/vite/dist/ast-formatter.js';
import { compileSimpleMessages, injectSimpleFormatter } from './compiler.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const core = path.join(root, 'packages/core/dist');
const originalFormatter = path.join(core, 'formatters.js');
const policy = Object.freeze({ warmupRounds: 100, rounds: 200, trials: 5,
  controlRelativeTolerance: 0.15, controlAbsoluteToleranceUs: 0.5,
  minimumRelativeSaving: 0.10, minimumAbsoluteSavingUs: 0.2 });
const inputs = [{ name: 'Saylo', n: 0, at: 0 }, { name: '제로디 🌍', n: 1, at: 1700000000000 },
  { name: '<b> raw </b>', n: 1234.5, at: 1800000000000 }];
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const hash = value => createHash('sha256').update(value).digest('hex');
const parent = path.join(root, '.release');
await mkdir(parent, { recursive: true });
const temporary = await mkdtemp(path.join(parent, 'aot-simple-'));

async function prepare(label, catalog) {
  const directory = path.join(temporary, label), dist = path.join(directory, 'dist');
  await cp(core, dist, { recursive: true });
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  const program = compileSimpleMessages(catalog);
  const source = await readFile(path.join(dist, 'formatters.js'), 'utf8');
  await writeFile(path.join(dist, 'aot-programs.js'), program.source);
  await writeFile(path.join(dist, 'formatters.js'), injectSimpleFormatter(source));
  const candidate = await import(pathToFileURL(path.join(dist, 'runtime.js')));
  return { directory, dist, program, candidate };
}

function outcome(call) {
  try { return { value: call() }; }
  catch (error) { return { error: { name: error.name, message: error.message } }; }
}

async function verify() {
  const source = JSON.stringify(Object.fromEntries([
    ['empty', ''], ['literal', ' Literal 🌍 \n '], ['argument', 'Hi {name}: {n} / {name}'],
    ['quoted', "It''s '{literal}' {name}"], ['__proto__', '{name}'],
    ['code', '\"; globalThis.__sayloAotInjected = true; // {name}'],
    ['number', '{n, number}'], ['plural', '{n, plural, one {One} other {# items}}'],
    ['select', '{name, select, Saylo {Hello} other {Other}}'], ['date', '{at, date, short}'],
    ['ordinal', '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}'],
    ['rich', '<link>Hello {name}</link>'],
  ]));
  const catalog = parseCatalog(source, { locale: 'en', namespace: 'verify', richText: { rich: ['link'] } });
  const f = await prepare('verify', catalog);
  assert.equal(f.program.compiled, 6); assert.equal(f.program.fallback, 6);
  let comparisons = 0;
  for (const pseudoLocale of [undefined, 'accent', 'long']) {
    const options = { locale: 'en', baseCatalogs: [catalog], ...(pseudoLocale ? { pseudoLocale } : {}) };
    const baseline = createTranslator(options), candidate = f.candidate.createTranslator(options);
    for (const id of [...Object.keys(catalog.messages), 'missing']) {
      for (const args of [...inputs, undefined, null, [], { name: true, n: NaN },
        { name: 'Ada', n: Infinity, at: new Date('invalid') }, Object.create(inputs[0])]) {
        for (const surface of ['t', 'tParts']) {
          const key = `verify:${id}`;
          assert.deepEqual(outcome(() => candidate[surface](key, args)), outcome(() => baseline[surface](key, args)),
            `${pseudoLocale ?? 'normal'} ${surface} ${id}`);
          comparisons++;
        }
      }
    }
  }
  assert.equal(globalThis.__sayloAotInjected, undefined);
  return { comparisons, compiled: f.program.compiled, fallback: f.program.fallback,
    scope: 'Text, parts, invalid arguments, unknown keys, ICU, rich text and both pseudo locales against current createTranslator.' };
}

function fixture(count, mixed) {
  return parseCatalog(JSON.stringify(Object.fromEntries(Array.from({ length: count }, (_, index) => {
    let text = index % 3 === 0 ? `Message ${index}: Hello 🌍` : index % 3 === 1
      ? `Message ${index}: Hello {name}` : `Message ${index}: {name} / {n} / {name}`;
    if (mixed && index % 10 === 0) {
      const formats = [`Message ${index}: {n, number}`, `Message ${index}: {n, plural, one {One} other {# items}}`,
        `Message ${index}: {name, select, Saylo {Hello} other {Other}}`, `Message ${index}: {at, date, short}`];
      text = formats[(index / 10) % formats.length];
    }
    return [`m${index}`, text];
  }))), { locale: 'en', namespace: 'bench' });
}

async function bundle(directory, runtime, catalog) {
  const entry = path.join(directory, 'entry.mjs');
  await mkdir(directory, { recursive: true });
  await writeFile(entry, `import { createTranslator } from ${JSON.stringify(path.join(runtime, 'runtime.js').split(path.sep).join('/'))};
export const translator = createTranslator({ locale: 'en', baseCatalogs: [JSON.parse(${JSON.stringify(JSON.stringify(catalog))})] });`);
  const ast = createAstFormatter(), candidateFormatter = path.join(runtime, 'formatters.js');
  const output = await build({ configFile: false, root: directory, logLevel: 'silent',
    plugins: [{ name: 'saylo-aot-experiment-ast', enforce: 'pre',
      resolveId(id, importer) {
        const mapped = importer && path.normalize(importer) === candidateFormatter ? originalFormatter : importer;
        return ast.resolve(id, mapped, this);
      }, load(id) { return ast.load(id); } }],
    build: { write: false, minify: true, sourcemap: false, reportCompressedSize: false,
      lib: { entry, formats: ['es'], fileName: 'benchmark' } } });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result => result.output)
    .filter(item => item.type === 'chunk');
  assert.ok(chunks.length > 0);
  assert.ok(chunks.every(chunk => !chunk.code.includes('EXPECT_ARGUMENT_CLOSING_BRACE')), 'Both bundles must remove the ICU source parser.');
  return { rawBytes: chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0),
    gzipBytes: chunks.reduce((sum, chunk) => sum + gzipSync(chunk.code, { level: 9 }).byteLength, 0),
    sha256: chunks.map(chunk => hash(chunk.code)) };
}

function timeCalls(cases, keys) {
  const run = (translator, rounds) => {
    let checksum = 0;
    for (let round = 0; round < rounds; round++) {
      const args = inputs[round % inputs.length];
      for (const key of keys) checksum += translator.t(key, args).length;
    }
    return checksum;
  };
  const samples = Object.fromEntries(Object.keys(cases).map(name => [name, []]));
  let expectedChecksum;
  for (const translator of Object.values(cases)) run(translator, policy.warmupRounds);
  const names = Object.keys(cases);
  for (let trial = 0; trial < policy.trials; trial++) {
    const rotated = [...names.slice(trial % names.length), ...names.slice(0, trial % names.length)];
    for (const name of trial % 2 ? rotated.reverse() : rotated) {
      const start = performance.now(), checksum = run(cases[name], policy.rounds);
      samples[name].push((performance.now() - start) * 1000 / (keys.length * policy.rounds));
      expectedChecksum ??= checksum;
      assert.equal(checksum, expectedChecksum);
    }
  }
  return Object.fromEntries(Object.entries(samples).map(([name, microsecondsPerCall]) =>
    [name, { medianMicrosecondsPerCall: median(microsecondsPerCall), microsecondsPerCall }]));
}

try {
  const verification = await verify();
  if (process.argv.includes('--verify-only')) {
    process.stdout.write(JSON.stringify({ verification }, null, 2) + '\n');
  } else {
    const results = [];
    for (const count of [64, 512]) for (const mixed of [false, true]) {
      const label = `${count}-${mixed ? 'mixed' : 'simple'}`, catalog = fixture(count, mixed);
      const f = await prepare(label, catalog), options = { locale: 'en', baseCatalogs: [catalog] };
      const keys = Object.keys(catalog.messages).map(id => `bench:${id}`);
      const cases = { baseline: createTranslator(options), control: createTranslator(options),
        candidate: f.candidate.createTranslator(options) };
      for (const key of keys) for (const args of inputs)
        assert.equal(cases.candidate.t(key, args), cases.baseline.t(key, args));
      const bundles = { baseline: await bundle(path.join(f.directory, 'baseline-bundle'), core, catalog),
        candidate: await bundle(path.join(f.directory, 'candidate-bundle'), f.dist, catalog) };
      const timing = timeCalls(cases, keys), base = timing.baseline.medianMicrosecondsPerCall;
      const controlDifference = Math.abs(timing.control.medianMicrosecondsPerCall - base);
      const controlValid = controlDifference <= Math.max(policy.controlAbsoluteToleranceUs, base * policy.controlRelativeTolerance);
      const savingUs = base - timing.candidate.medianMicrosecondsPerCall;
      const wins = timing.baseline.microsecondsPerCall.filter((sample, index) =>
        sample > timing.candidate.microsecondsPerCall[index]).length;
      const observedSaving = controlValid && savingUs >= Math.max(policy.minimumAbsoluteSavingUs, base * policy.minimumRelativeSaving)
        && wins >= 4;
      results.push({ label, messages: count, compiledMessages: f.program.compiled, fallbackMessages: f.program.fallback,
        callsPerTrial: count * policy.rounds, controlValid, timing,
        timingVerdict: !controlValid ? 'invalid-control' : observedSaving ? 'local-node-saving' : 'inconclusive',
        relativeSaving: controlValid ? savingUs / base : null, pairedWins: wins, bundles });
      process.stderr.write(`${label}: ${results.at(-1).timingVerdict}; bundle ${bundles.baseline.gzipBytes} -> ${bundles.candidate.gzipBytes} gzip bytes\n`);
    }
    const report = { schema: 'saylo-simple-aot-experiment/v1', measuredAt: new Date().toISOString(),
      sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      environment: { node: process.version, platform: process.platform, arch: process.arch,
        vite: JSON.parse(await readFile(path.join(root, 'node_modules/vite/package.json'))).version,
        intlMessageFormat: JSON.parse(await readFile(path.join(root, 'node_modules/intl-messageformat/package.json'))).version },
      codeHashes: Object.fromEntries(await Promise.all(['benchmarks/aot-simple/run.mjs', 'benchmarks/aot-simple/compiler.mjs',
        'packages/core/dist/translator.js', 'packages/core/dist/formatters.js', 'packages/vite/dist/ast-formatter.js']
        .map(async file => [file, hash(await readFile(path.join(root, file)))]))),
      scope: 'Experimental formatter dispatch in temporary compiled-core copies. Public translator validation and ICU/rich/pseudo fallbacks retained. Node warm calls; Vite production ESM library chunks, parser removed on both sides, gzip level 9. No browser, startup, heap or full app measurement. Catalog AST/source remain; this is not a complete AOT backend.',
      policy, verification, results };
    const output = JSON.stringify(report, null, 2) + '\n', flag = process.argv.indexOf('--out-file');
    if (flag !== -1) { assert.ok(process.argv[flag + 1]); await writeFile(process.argv[flag + 1], output); }
    process.stdout.write(output);
  }
} finally {
  assert.equal(path.dirname(temporary), parent);
  assert.ok(path.basename(temporary).startsWith('aot-simple-'));
  await rm(temporary, { recursive: true, force: true });
}
