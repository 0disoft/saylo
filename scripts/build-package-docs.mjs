import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
const destination = path.join(repository, 'packages/vite/docs');
// Explicit consumer-facing inputs only. Review logs, design histories, credentials
// and application sources are never discovered or recursively copied.
export const packageDocInputs = [
  { source: 'SUPPORT.md', target: 'support.md' },
  { source: 'SECURITY.md', target: 'security.md' },
  ...['getting-started', 'getting-started-react', 'getting-started-svelte', 'getting-started-sveltekit',
    'dev-sync-state', 'support-report'].map(name => ({ source: `docs/${name}.md`, target: `${name}.md` })),
  ...['core', 'react', 'svelte', 'typegen', 'vite'].map(name => ({ source: `packages/${name}/README.md`, target: `api/${name}.md` })),
];
export const packageDocPaths = ['README.md', 'manifest.json', ...packageDocInputs.map(entry => entry.target)];
const targets = new Map(packageDocInputs.map(entry => [entry.source, entry.target]));
targets.set('README.md', 'README.md');
targets.set('packages/vite/docs/README.md', 'README.md');
const hash = value => createHash('sha256').update(value).digest('hex');
const normalize = text => text.replaceAll('\r\n', '\n');
const outsideCode = (text, transform) => text.split(/(^```[^\n]*\n[\s\S]*?^```[ \t]*$)/m)
  .map(part => part.startsWith('```') ? part : transform(part)).join('');

function rewriteLinks(text, source, target) {
  return outsideCode(text, part => part.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (original, label, href) => {
    let reference = href;
    if (href.startsWith('https://github.com/0disoft/saylo')) {
      const suffix = href.slice('https://github.com/0disoft/saylo'.length);
      if (!suffix || suffix === '#readme' || suffix === '/') reference = 'README.md';
      else if (suffix.startsWith('/blob/main/')) reference = suffix.slice('/blob/main/'.length);
      else if (suffix.startsWith('/tree/main/packages/')) {
        reference = suffix.slice('/tree/main/'.length).replace(/#readme$/, '') + '/README.md';
      } else return `${label} (repository reference)`;
    } else if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('#')) return original;
    else reference = path.posix.normalize(path.posix.join(path.posix.dirname(source), href));
    const [file, ...fragment] = reference.split('#');
    // The guides' catalog/API pointer follows the shipped implementation README,
    // rather than distributing an early design document containing proposed APIs.
    const mapped = file === 'docs/03-catalog-and-api.md' ? 'api/core.md' : targets.get(file);
    if (!mapped) return `${label} (separate reference)`;
    const relative = path.posix.relative(path.posix.dirname(target), mapped);
    const anchor = fragment.length ? '#' + fragment.join('#') : '';
    return `[${file === 'docs/03-catalog-and-api.md' ? 'Core API' : label}](${relative}${anchor})`;
  }));
}

function assertLocalLinks(files) {
  for (const [file, contents] of files) {
    if (!file.endsWith('.md')) continue;
    outsideCode(contents, part => {
      for (const match of part.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)) {
        const href = match[1];
        if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('#')) continue;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), href.split('#')[0]));
        assert.ok(files.has(target), `${file}: bundled link ${href} has no file`);
      }
      return part;
    });
  }
}

async function render() {
  const manifest = JSON.parse(await readFile(path.join(repository, 'packages/vite/package.json'), 'utf8'));
  const files = new Map();
  const entries = [];
  for (const { source, target } of packageDocInputs) {
    const input = normalize(await readFile(path.join(repository, source), 'utf8'));
    const bundled = rewriteLinks(input, source, target);
    // Do not alter the runnable document snippets accepted by the starter checks.
    const code = text => [...text.matchAll(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm)].map(match => match[0]);
    assert.deepEqual(code(bundled), code(input), `${source}: code blocks changed`);
    files.set(target, bundled);
    entries.push({ source, target, sourceSha256: hash(input), bundledSha256: hash(bundled) });
  }
  files.set('README.md', `# Saylo documentation in your installation\n\nThis documentation bundle is included when the tarball for ${manifest.name} ${manifest.version} is built. You can read it from the installation directory without signing in to GitHub.\n\n## Getting started\n\n- [JavaScript and TypeScript](getting-started.md)\n- [React](getting-started-react.md)\n- [Svelte](getting-started-svelte.md)\n- [SvelteKit and SSR](getting-started-sveltekit.md)\n\n## APIs and usage contracts\n\n${['core', 'react', 'svelte', 'typegen', 'vite'].map(id => `- [@0disoft/saylo-${id}](api/${id}.md)`).join('\n')}\n- [Development synchronization state](dev-sync-state.md)\n- [Diagnostic reports for support](support-report.md)\n- [Support and feature requests](support.md)\n- [Private security reports](security.md)\n\nThe getting-started examples were verified against alpha.4 on the public npm registry. Check the published-version and candidate labels in the API documentation against your installed version. The development synchronization state API, support diagnostics API, and this documentation bundle are included in alpha.5 candidate tarballs; they are absent from the published alpha.4 packages. The version shown here comes from package.json at build time and does not confirm registry publication. References to design and measurement records that are not bundled retain their titles only. External web documents and fragment targets are outside this bundle's file-link checks.\n\nmanifest.json records SHA-256 hashes of the source and bundled files after normalizing line endings to LF. Runnable code blocks are identical to their sources.\n`);
  files.set('manifest.json', JSON.stringify({ schema: 'saylo.package-docs/v1', package: manifest.name,
    version: manifest.version, textNormalization: 'CRLF to LF', documents: entries }, null, 2) + '\n');
  assertLocalLinks(files);
  assert.deepEqual([...files.keys()].sort(), [...packageDocPaths].sort());
  return files;
}

async function listFiles(directory, prefix = '') {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), `Generated docs must not contain symlink ${entry.name}`);
    const relative = prefix + entry.name;
    if (entry.isDirectory()) found.push(...await listFiles(path.join(directory, entry.name), relative + '/'));
    else { assert.ok(entry.isFile()); found.push(relative); }
  }
  return found;
}

export async function verifyPackageDocs(directory = destination) {
  assert.ok(!(await lstat(directory)).isSymbolicLink());
  const expected = await render();
  assert.deepEqual((await listFiles(directory)).sort(), [...packageDocPaths].sort(), 'Unexpected or missing bundled document');
  for (const [file, text] of expected) assert.equal(await readFile(path.join(directory, file), 'utf8'), text,
    `${file}: bundled document differs from current source`);
  return { documents: packageDocInputs.length, files: packageDocPaths.length,
    bytes: [...expected.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0) };
}

export async function buildPackageDocs() {
  const expected = await render();
  assert.equal(path.resolve(destination), path.join(repository, 'packages/vite/docs'));
  await mkdir(destination, { recursive: true });
  assert.ok(!(await lstat(destination)).isSymbolicLink());
  await mkdir(path.join(destination, 'api'), { recursive: true });
  assert.ok(!(await lstat(path.join(destination, 'api'))).isSymbolicLink());
  // Remove only files owned by the previous generated manifest, if an input was retired.
  let previous;
  try { previous = JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous) for (const { target } of previous.documents) {
    assert.match(target, /^(?:api\/)?[a-z\d-]+\.md$/);
    if (!expected.has(target)) await rm(path.join(destination, target), { force: true });
  }
  for (const [file, text] of expected) {
    const target = path.join(destination, file);
    try {
      const existing = await lstat(target);
      assert.ok(existing.isFile() && !existing.isSymbolicLink(), `Generated document ${file} must be a regular file`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeFile(target, text);
  }
  return verifyPackageDocs();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--check'));
  const result = await (process.argv[2] === '--check' ? verifyPackageDocs() : buildPackageDocs());
  console.log(`[package-docs] ${JSON.stringify(result)}; code blocks preserved and local file links resolved.`);
}
