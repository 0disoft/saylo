import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRelease, packageIds, releaseInput } from './release-check.mjs';
import { approvedRegistryRelease, verifyRegistryVersion } from './registry-release.mjs';
import { packageDocPaths, verifyPackageDocs } from './build-package-docs.mjs';
import { registryConsumerContract } from './registry-consumer-contract.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const fixtures = fileURLToPath(new URL('./pack-fixtures/', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this smoke with npm run verify:pack.');
const exec = promisify(execFile);
const majors = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8')).devDependencies;
const packages = Object.fromEntries(packageIds.map(id => [`@0disoft/saylo-${id}`, id]));
const { values } = parseArgs({ options: { 'save-release': { type: 'boolean' }, registry: { type: 'boolean' },
  'registry-version': { type: 'string' } } });
const saveRelease = values['save-release'];
const fromRegistry = values.registry;
assert.ok(!(saveRelease && fromRegistry), 'Registry verification cannot replace local release artifacts.');
assert.ok(fromRegistry || !values['registry-version'], '--registry-version requires --registry.');
const bootstrap = fromRegistry ? await approvedRegistryRelease(values['registry-version']) : [];
const supportChecks = !fromRegistry || registryConsumerContract(values['registry-version']).support;
// Historical registry checks use their approved package set, excluding unpublished additions.
const names = fromRegistry ? bootstrap.map(pack => pack.name) : Object.keys(packages);
const hasSvelte = names.includes('@0disoft/saylo-svelte');
const license = await readFile(path.join(repository, 'LICENSE'), 'utf8');
const notice = await readFile(path.join(repository, 'NOTICE'), 'utf8');
// npm run can export .npmrc allow-scripts as an env override, which newer npm
// rejects for project installs. Install scripts are disabled explicitly below.
const childEnv = { ...Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => key.toLowerCase() !== 'npm_config_allow_scripts')), NODE_PATH: '' };
const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-pack-'));
const packs = path.join(root, 'packs');
function inside(directory, target) {
  const relative = path.relative(directory, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function example(readme, language) {
  const match = readme.match(new RegExp('```' + language + '\\r?\\n([\\s\\S]*?)\\r?\\n```'));
  assert.ok(match, `Missing ${language} README example`);
  return match[1];
}
async function npm(args, cwd) {
  try {
    const result = await exec(process.execPath, [npmCli, ...args], { cwd, windowsHide: true,
      env: childEnv, maxBuffer: 4 * 1024 * 1024 });
    return result.stdout;
  } catch (error) {
    throw new Error(`npm ${args.join(' ')} failed in ${path.basename(cwd)}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, { cause: error });
  }
}
try {
  assert.ok(!inside(repository, root), 'Consumer must live outside the repository.');
  await mkdir(packs);
  const registryVersions = new Map();
  if (fromRegistry) {
    for (const pack of bootstrap) {
      const name = pack.name;
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(30000) });
      assert.ok(response.ok, `${name}: public registry HTTP ${response.status}`);
      const metadata = await response.json();
      const version = verifyRegistryVersion(pack, metadata);
      registryVersions.set(name, version);
    }
    console.log(`[registry] All ${names.length} approved ${values['registry-version']} artifacts match published integrity; current dist-tags are independent.`);
  }
  const supportsAstRuntime = !fromRegistry || Boolean(registryVersions.get('@0disoft/saylo-core')?.exports?.['./runtime']);
  const source = fromRegistry ? ['--workspaces=false', ...names.map(name => `${name}@${registryVersions.get(name).version}`), '--registry', 'https://registry.npmjs.org/'] : packageIds.map(id => `--workspace=@0disoft/saylo-${id}`);
  const metadata = JSON.parse(await npm(['pack', ...source, '--ignore-scripts', '--json', '--pack-destination', packs], repository));
  const packed = Array.isArray(metadata) ? metadata : Object.values(metadata);
  assert.deepEqual(packed.map(pack => pack.name).sort(), [...names].sort());
  if (fromRegistry) for (const pack of packed) {
    const integrity = `sha512-${createHash('sha512').update(await readFile(path.join(packs, pack.filename))).digest('base64')}`;
    assert.equal(integrity, registryVersions.get(pack.name).dist.integrity, `${pack.name}: downloaded tarball integrity differs`);
  }
  if (saveRelease) {
    const core = JSON.parse(await readFile(path.join(repository, 'packages/core/package.json'), 'utf8'));
    await checkRelease(releaseInput(['--version', core.version, '--tag', core.publishConfig.tag]));
  }
  const packageDocs = new Map();
  for (const pack of packed) {
    const directory = path.join(repository, 'packages', packages[pack.name]);
    const manifest = fromRegistry ? registryVersions.get(pack.name)
      : JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const files = new Set(pack.files.map(file => file.path));
    assert.ok(files.has('README.md'), `${pack.name} is missing its README`);
    assert.ok(files.has('LICENSE') && files.has('NOTICE'), `${pack.name} needs license files`);
    const docs = new Set(pack.name === '@0disoft/saylo-vite' && (supportChecks || files.has('docs/manifest.json'))
      ? packageDocPaths.map(file => `docs/${file}`) : []);
    for (const file of docs) assert.ok(files.has(file), `${pack.name} missing bundled document ${file}`);
    assert.ok([...files].every(file => file.startsWith('dist/') || docs.has(file)
      || ['package.json', 'README.md', 'LICENSE', 'NOTICE'].includes(file)), `${pack.name} contains unexpected release files`);
    if (docs.size && !fromRegistry) await verifyPackageDocs(path.join(directory, 'docs'));
    assert.equal(manifest.license, 'Apache-2.0');
    assert.equal(manifest.private, undefined);
    assert.equal(pack.version, manifest.version);
    assert.deepEqual(manifest.engines, { node: '24.x' });
    assert.ok(typeof manifest.description === 'string' && manifest.description.trim(), `${pack.name} needs a description`);
    assert.deepEqual(manifest.repository, { type: 'git', url: 'git+https://github.com/0disoft/saylo.git', directory: `packages/${packages[pack.name]}` });
    // Keep historical registry artifacts tied to their original metadata.
    const legacyReportingMetadata = fromRegistry && /^0\.1\.0-alpha\.[1-4]$/.test(manifest.version);
    assert.equal(manifest.homepage, legacyReportingMetadata
      ? `https://github.com/0disoft/saylo/tree/main/packages/${packages[pack.name]}#readme`
      : `https://www.npmjs.com/package/${pack.name}`);
    assert.deepEqual(manifest.bugs, legacyReportingMetadata
      ? { url: 'https://github.com/0disoft/saylo/issues' }
      : { email: 'rodisoft1@gmail.com' });
    assert.ok(Array.isArray(manifest.keywords) && manifest.keywords.length && manifest.keywords.every(word => typeof word === 'string' && word.trim()), `${pack.name} needs search keywords`);
    packageDocs.set(pack.name, { manifest, readme: fromRegistry ? undefined : await readFile(path.join(directory, 'README.md'), 'utf8') });
    for (const target of [...Object.values(manifest.exports).flatMap(entry => Object.values(entry)), ...Object.values(manifest.bin ?? {})])
      assert.ok(files.has(target.replace(/^\.\//, '')), `${pack.name} is missing ${target}`);
    console.log(`[pack] ${pack.name}: ${pack.files.length} files, ${pack.size} bytes`);
  }
  for (const language of ['js', 'ts']) {
    const app = path.join(root, language);
    await cp(path.join(fixtures, 'shared'), app, { recursive: true });
    if (fromRegistry && !supportsAstRuntime) await cp(path.join(fixtures, 'registry-smoke.mjs'), path.join(app, 'smoke.mjs'));
    await cp(path.join(fixtures, language), path.join(app, 'src'), { recursive: true });
    // Published alpha.1 predates the runtime subpath; exercise it only in local tarballs.
    if (supportsAstRuntime) {
      const entry = path.join(app, 'src', `main.${language}`);
      await writeFile(entry, (await readFile(entry, 'utf8')).replaceAll("'@0disoft/saylo-core'", "'@0disoft/saylo-core/runtime'"));
    }
    await writeFile(path.join(app, 'index.html'), `<html><body><div id="app"></div><script type="module" src="/src/main.${language}"></script></body></html>\n`);
    await writeFile(path.join(app, 'package.json'), JSON.stringify({ name: `saylo-packed-${language}`, private: true, type: 'module',
      scripts: { typegen: 'saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts',
        typecheck: 'tsc -p tsconfig.json', build: 'vite build' },
      dependencies: { ...Object.fromEntries(packed.filter(pack => !['@0disoft/saylo-vite', '@0disoft/saylo-typegen'].includes(pack.name))
        .map(pack => [pack.name, `file:../packs/${pack.filename}`])),
        react: majors.react, 'react-dom': majors['react-dom'], ...(hasSvelte ? { svelte: majors.svelte } : {}) },
      devDependencies: { ...Object.fromEntries(['typescript', 'vite', '@types/node', '@types/react', '@types/react-dom'].map(name => [name, majors[name]])),
        ...Object.fromEntries(packed.filter(pack => ['@0disoft/saylo-vite', '@0disoft/saylo-typegen'].includes(pack.name))
          .map(pack => [pack.name, `file:../packs/${pack.filename}`])) } }, null, 2));
    await writeFile(path.join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022',
      module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2022', 'DOM'], strict: true,
      allowJs: true, checkJs: true, noEmit: true, jsx: 'react-jsx', types: ['node', 'vite/client', '@0disoft/saylo-vite/virtual'] },
      include: [`src/**/*.${language}`, ...(hasSvelte ? ['src/consumer-svelte*.js'] : []), 'readme-*.ts', 'readme-*.tsx', 'generated.d.ts', 'vite.config.mjs'] }, null, 2));
    console.log(`[pack] ${language}: installing tarballs and declared peer/tool major ranges outside the workspace`);
    await npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--workspaces=false'], app);
    if (!fromRegistry && language === 'js') {
      const bundled = await verifyPackageDocs(path.join(app, 'node_modules/@0disoft/saylo-vite/docs'));
      console.log(`[pack] Installed document bundle: ${JSON.stringify(bundled)}; contents and local file links match source.`);
    }
    for (const name of names) {
      const installed = path.join(app, 'node_modules', name);
      assert.equal((await lstat(installed)).isSymbolicLink(), false, `${name} is a workspace link`);
      assert.ok(inside(await realpath(app), await realpath(installed)), `${name} escaped the consumer`);
      const shipped = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
      const expected = packageDocs.get(name);
      for (const field of ['version', 'license', 'engines', 'publishConfig', 'dependencies', 'peerDependencies', 'description', 'repository', 'homepage', 'bugs', 'keywords'])
        assert.deepEqual(shipped[field], expected.manifest[field], `${name} lost packed ${field}`);
      const shippedReadme = await readFile(path.join(installed, 'README.md'), 'utf8');
      if (fromRegistry) expected.readme = shippedReadme;
      else assert.equal(shippedReadme, expected.readme, `${name} shipped a stale README`);
      assert.equal(await readFile(path.join(installed, 'LICENSE'), 'utf8'), license);
      assert.equal(await readFile(path.join(installed, 'NOTICE'), 'utf8'), notice);
    }
    if (supportChecks && language === 'js') {
      const cli = path.join(app, 'node_modules/@0disoft/saylo-typegen/dist/cli.js');
      const help = await exec(process.execPath, [cli, '-h'], { cwd: app, env: childEnv, windowsHide: true });
      assert.equal(help.stderr, '');
      assert.match(help.stdout, /--help, -h/);
      assert.match(help.stdout, /Example:/);
      console.log('[pack] Installed typegen CLI help alias and option example passed.');
    }
    if (hasSvelte) await cp(path.join(repository, 'packages/svelte/test/consumer-js.js'), path.join(app, 'src/consumer-svelte.js'));
    const hasSvelteSelectors = hasSvelte && (await readFile(path.join(app, 'node_modules/@0disoft/saylo-svelte/dist/index.d.ts'), 'utf8'))
      .includes('selectSvelteStore');
    if (!fromRegistry && hasSvelte) assert.ok(hasSvelteSelectors, 'Local Svelte package is missing selector declarations.');
    const hasSvelteRichText = hasSvelte && Boolean(JSON.parse(await readFile(path.join(app, 'node_modules/@0disoft/saylo-svelte/package.json'), 'utf8')).exports?.['./RichText.svelte']);
    if (!fromRegistry && hasSvelte) assert.ok(hasSvelteRichText, 'Local Svelte package is missing the rich component entry.');
    if (hasSvelteRichText) {
      await cp(path.join(repository, 'packages/svelte/test/rich-consumer-js.js'), path.join(app, 'src/consumer-svelte-rich.js'));
      if (language === 'ts') await cp(path.join(repository, 'packages/svelte/test/rich-consumer.ts'), path.join(app, 'readme-svelte-rich.ts'));
    }
    if (hasSvelteSelectors) {
      await cp(path.join(repository, 'packages/svelte/test/selector-consumer-js.js'), path.join(app, 'src/consumer-svelte-selectors.js'));
      if (language === 'ts') await cp(path.join(repository, 'packages/svelte/test/selector-consumer.ts'), path.join(app, 'readme-svelte-selectors.ts'));
    }
    if (language === 'ts') {
      // Check the actual shipped examples against the independently installed packages.
      const doc = id => packageDocs.get(`@0disoft/saylo-${id}`).readme;
      await writeFile(path.join(app, 'readme-core.mjs'), example(doc('core'), 'js'));
      await writeFile(path.join(app, 'readme-react.tsx'), example(doc('react'), 'tsx'));
      await writeFile(path.join(app, 'readme-typegen.ts'), example(doc('typegen'), 'ts'));
      await writeFile(path.join(app, 'src/readme-vite.ts'), example(doc('vite'), 'ts'));
      if (hasSvelte) {
        await writeFile(path.join(app, 'readme-svelte.mjs'), example(doc('svelte'), 'js'));
        await cp(path.join(repository, 'packages/svelte/test/consumer.ts'), path.join(app, 'readme-svelte.ts'));
        // Compile and render against the tarball's real Svelte peer, outside workspace resolution.
        await cp(path.join(fixtures, 'svelte-smoke.mjs'), path.join(app, 'svelte-smoke.mjs'));
      }
    }
    if (supportChecks) {
      await cp(path.join(fixtures, 'support-report.mjs'), path.join(app, `src/support-report.${language}`));
      await cp(path.join(fixtures, 'support-report.mjs'), path.join(app, 'support-report.mjs'));
      await cp(path.join(fixtures, 'sync-state.mjs'), path.join(app, 'sync-state.mjs'));
    }
    if (!fromRegistry) {
      await cp(path.join(fixtures, 'rich-text.mjs'), path.join(app, 'rich-text.mjs'));
      const rich = await exec(process.execPath, ['rich-text.mjs'], { cwd: app, windowsHide: true, env: childEnv });
      console.log(rich.stdout.trim());
    }
    if (!fromRegistry && language === 'js') {
      await cp(path.join(fixtures, 'catalog-features.mjs'), path.join(app, 'catalog-features.mjs'));
      console.log((await exec(process.execPath, ['catalog-features.mjs'],
        { cwd: app, windowsHide: true, env: childEnv, maxBuffer: 1024 * 1024 })).stdout.trim());
      await cp(path.join(fixtures, 'catalog-workflow.mjs'), path.join(app, 'catalog-workflow.mjs'));
      console.log((await exec(process.execPath, ['catalog-workflow.mjs'],
        // The workflow starts twenty separately bounded CLI processes, including cold filesystem reads.
        { cwd: app, windowsHide: true, env: childEnv, timeout: 300000, maxBuffer: 1024 * 1024 })).stdout.trim());
    }
    console.log((await npm(['run', 'typegen'], app)).trim());
    assert.match(await readFile(path.join(app, 'generated.d.ts'), 'utf8'), /"demo:items": \{ "count": number;/);
    await npm(['run', 'typecheck'], app);
    if (language === 'ts') {
      await exec(process.execPath, ['readme-core.mjs'], { cwd: app, windowsHide: true, env: childEnv });
      if (hasSvelte) {
        await exec(process.execPath, ['readme-svelte.mjs'], { cwd: app, windowsHide: true, env: childEnv });
        const svelte = await exec(process.execPath, ['svelte-smoke.mjs'], { cwd: app, windowsHide: true, env: childEnv });
        console.log(svelte.stdout.trim());
      }
      console.log('[pack] Shipped core README example ran; React, typegen and Vite README examples typechecked.');
    }
    const smoke = await exec(process.execPath, ['smoke.mjs'], { cwd: app, windowsHide: true, env: childEnv });
    console.log(smoke.stdout.trim());
    if (supportChecks) console.log((await exec(process.execPath, ['support-report.mjs'],
      { cwd: app, windowsHide: true, env: childEnv })).stdout.trim());
    if (supportChecks) console.log((await exec(process.execPath, ['sync-state.mjs'],
      { cwd: app, windowsHide: true, env: childEnv })).stdout.trim());
    console.log((await npm(['run', 'build'], app)).trim());
    const bundle = JSON.parse(await readFile(path.join(app, 'dist/.vite/manifest.json'), 'utf8'));
    assert.ok(Object.values(bundle).some(entry => entry.isDynamicEntry), 'Lazy translation chunk was not emitted.');
    if (supportsAstRuntime) for (const entry of Object.values(bundle)) {
      if (entry.file.endsWith('.js')) assert.ok(!(await readFile(path.join(app, 'dist', entry.file), 'utf8'))
        .includes('EXPECT_ARGUMENT_CLOSING_BRACE'), 'AST consumer shipped the ICU parser.');
    }
    const supportsCompleteTranslations = (await readFile(path.join(app, 'node_modules/@0disoft/saylo-vite/dist/types.d.ts'), 'utf8'))
      .includes('requireCompleteTranslations');
    if (!fromRegistry) assert.ok(supportsCompleteTranslations, 'Local release is missing the complete translation option.');
    if (supportsCompleteTranslations) {
      await cp(path.join(fixtures, 'complete-translations.mjs'), path.join(app, 'complete-translations.mjs'));
      console.log((await exec(process.execPath, [path.join(app, 'complete-translations.mjs')],
        { cwd: app, env: childEnv, windowsHide: true, maxBuffer: 1024 * 1024 })).stdout.trim());
    }
    if (!fromRegistry && language === 'ts') {
      for (const file of ['ssr-entry.mjs', 'ssr-build.mjs', 'ssr-runtime.mjs']) await cp(path.join(fixtures, file), path.join(app, file));
      console.log((await exec(process.execPath, ['ssr-build.mjs'], { cwd: app, env: childEnv, windowsHide: true })).stdout.trim());
      await npm(['prune', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--workspaces=false'], app);
      console.log((await exec(process.execPath, ['ssr-runtime.mjs'], { cwd: app, env: childEnv, windowsHide: true })).stdout.trim());
    }
    console.log(`[pack] ${language}: CLI, ${language === 'js' ? 'checkJs' : 'TypeScript'}, runtime/React SSR, Vite lazy build passed`);
  }
  console.log(`[pack] All ${names.length} packed packages passed independent JS and TS consumption.`);
  if (saveRelease) {
    const destination = path.join(repository, '.release', 'npm');
    await mkdir(destination, { recursive: true });
    const resolved = await realpath(destination);
    assert.equal(resolved, path.join(await realpath(repository), '.release', 'npm'), 'Unsafe release output path.');
    assert.equal((await lstat(destination)).isSymbolicLink(), false);
    await rm(resolved, { recursive: true, force: true });
    await mkdir(destination);
    for (const pack of packed) await cp(path.join(packs, pack.filename), path.join(destination, pack.filename));
    await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(packed.map(({ name, version, filename, integrity }) => ({ name, version, filename, integrity })), null, 2) + '\n');
    console.log('[pack] Saved the verified release artifacts to .release/npm.');
  }
} finally {
  const resolved = path.resolve(root);
  const temporaryParent = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== temporaryParent || !path.basename(resolved).startsWith('saylo-pack-')) throw new Error('Unsafe pack smoke cleanup path.');
  await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
