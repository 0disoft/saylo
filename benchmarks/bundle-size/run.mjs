import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build, version as viteVersion } from 'vite';
import { createDemoConfig as vanillaConfig } from '../../examples/vanilla/vite.config.mjs';
import { createDemoConfig as reactConfig } from '../../examples/react/vite.config.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const relative = file => path.relative(root, file).split(path.sep).join('/');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sentinel = 'EXPECT_ARGUMENT_CLOSING_BRACE';
const outFile = path.resolve(root, process.argv[2] ?? 'benchmarks/results/demo-bundle-size.json');

async function inputs(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !['node_modules', 'dist', '.git'].includes(entry.name)) files.push(...await inputs(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

const sourceFiles = [path.join(root, 'package-lock.json'), ...(await inputs(path.join(root, 'examples/vanilla'))),
  ...(await inputs(path.join(root, 'examples/react'))), ...(await inputs(path.join(root, 'benchmarks/bundle-size')))];
for (const name of ['core', 'react', 'vite', 'typegen']) {
  sourceFiles.push(...await inputs(path.join(root, 'packages', name, 'dist')));
  sourceFiles.push(path.join(root, 'packages', name, 'package.json'));
}
const codeHashes = Object.fromEntries(await Promise.all(sourceFiles.sort().map(async file => [relative(file), hash(await readFile(file))])));

function measure(output) {
  const chunks = output.filter(item => item.type === 'chunk');
  const byName = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
  const initial = new Set();
  function visit(name) {
    if (initial.has(name)) return;
    const chunk = byName.get(name);
    assert.ok(chunk, `Missing static JS dependency: ${name}`);
    initial.add(name);
    for (const dependency of chunk.imports) visit(dependency);
  }
  const entries = chunks.filter(chunk => chunk.isEntry);
  assert.ok(entries.length, 'Expected an HTML JS entry');
  for (const chunk of entries) visit(chunk.fileName);
  const rows = chunks.map(chunk => ({
    fileName: chunk.fileName,
    group: initial.has(chunk.fileName) ? 'initial' : 'deferred',
    isEntry: chunk.isEntry,
    isDynamicEntry: chunk.isDynamicEntry,
    imports: chunk.imports,
    dynamicImports: chunk.dynamicImports,
    bytes: Buffer.byteLength(chunk.code),
    gzipBytes: gzipSync(chunk.code, { level: 9 }).length,
    sha256: hash(chunk.code),
    parserSentinel: chunk.code.includes(sentinel),
  })).sort((a, b) => a.fileName.localeCompare(b.fileName));
  const sum = selected => selected.reduce((total, row) => ({ bytes: total.bytes + row.bytes,
    gzipBytes: total.gzipBytes + row.gzipBytes, chunks: total.chunks + 1 }), { bytes: 0, gzipBytes: 0, chunks: 0 });
  return { initial: sum(rows.filter(row => row.group === 'initial')),
    deferred: sum(rows.filter(row => row.group === 'deferred')), total: sum(rows), chunks: rows };
}

const cases = [];
for (const [app, createConfig] of [['vanilla', vanillaConfig], ['react', reactConfig]]) {
  for (const astRuntime of [false, true]) {
    const config = createConfig({ astRuntime });
    const result = await build({ ...config, configFile: false, logLevel: 'warn',
      build: { ...config.build, write: false, reportCompressedSize: false } });
    assert.ok(!Array.isArray(result) && 'output' in result, 'Expected one client build');
    const sizes = measure(result.output);
    assert.equal(sizes.chunks.some(chunk => chunk.parserSentinel), !astRuntime,
      `${app}: parser sentinel must exist only with astRuntime:false`);
    assert.equal(sizes.deferred.chunks > 0, app === 'react', `${app}: unexpected catalog splitting`);
    cases.push({ app, astRuntime, minify: 'Vite default', ...sizes });
    console.log(`${app} astRuntime=${astRuntime}: initial ${sizes.initial.bytes} B / ${sizes.initial.gzipBytes} B gzip; deferred ${sizes.deferred.bytes} B / ${sizes.deferred.gzipBytes} B gzip`);
  }
}

// Typegen may run during the React build. The measured inputs must stay intact.
for (const [file, expected] of Object.entries(codeHashes)) assert.equal(hash(await readFile(path.join(root, file))), expected, `Input changed: ${file}`);
const reactPackage = JSON.parse(await readFile(path.join(root, 'node_modules/react/package.json'), 'utf8'));
const result = {
  measuredAt: new Date().toISOString(), gitRevision: git('rev-parse', 'HEAD'),
  workingTreeStatus: git('status', '--short'),
  environment: { node: process.version, platform: process.platform, arch: process.arch, vite: viteVersion, react: reactPackage.version },
  method: { command: 'npm run build && node benchmarks/bundle-size/run.mjs',
    initial: 'HTML JS entries plus transitive static JS imports; dynamic imports excluded',
    deferred: 'All remaining emitted JS chunks; shared chunks counted once, no assumed navigation',
    gzip: 'Sum of individual chunk gzipSync sizes, level 9',
    scope: 'Default-minified client JS only; no HTML, CSS, maps, HTTP headers, Brotli, server output or load timing',
    variance: 'Each build generates a random session UUID; hashes and gzip sizes may vary slightly on repeat',
  }, codeHashes, cases,
};
await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Saved ${relative(outFile)}`);
