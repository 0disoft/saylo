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
      } else return `${label} (저장소 참고 기록)`;
    } else if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('#')) return original;
    else reference = path.posix.normalize(path.posix.join(path.posix.dirname(source), href));
    const [file, ...fragment] = reference.split('#');
    // The guides' catalog/API pointer follows the shipped implementation README,
    // rather than distributing an early design document containing proposed APIs.
    const mapped = file === 'docs/03-catalog-and-api.md' ? 'api/core.md' : targets.get(file);
    if (!mapped) return `${label} (별도 참고 기록)`;
    const relative = path.posix.relative(path.posix.dirname(target), mapped);
    const anchor = fragment.length ? '#' + fragment.join('#') : '';
    return `[${file === 'docs/03-catalog-and-api.md' ? '코어 사용 API' : label}](${relative}${anchor})`;
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
  files.set('README.md', `# Saylo 설치 폴더의 사용 안내\n\n이 문서 묶음은 ${manifest.name} ${manifest.version}의 tarball을 만들 때 포함한다. GitHub 로그인 없이 설치 폴더에서 읽을 수 있다.\n\n## 시작하기\n\n- [JavaScript와 TypeScript](getting-started.md)\n- [React](getting-started-react.md)\n- [Svelte](getting-started-svelte.md)\n- [SvelteKit와 SSR](getting-started-sveltekit.md)\n\n## API와 사용 계약\n\n${['core', 'react', 'svelte', 'typegen', 'vite'].map(id => `- [@0disoft/saylo-${id}](api/${id}.md)`).join('\n')}\n- [개발 연결 상태](dev-sync-state.md)\n- [문의용 진단 자료](support-report.md)\n- [문의와 기능 제안](support.md)\n- [비공개 보안 제보](security.md)\n\n시작 안내는 public npm의 alpha.4로 검증한 예제다. API 문서의 게시 버전·후보 표시를 확인하고 설치 버전과 맞춰 사용한다. 개발 동기화 상태·문의용 진단 API와 이 문서 묶음은 alpha.5 후보 tarball에 포함하며 기존 alpha.4 게시본에는 없다. 이 묶음의 버전은 만들 때의 package.json 값이며 registry 게시 완료를 뜻하지 않는다. 포함하지 않은 설계·측정 기록은 제목만 남겼다. 외부 웹 문서와 fragment 목적지는 이 묶음의 파일 검사 범위 밖이다.\n\nmanifest.json은 LF로 정규화한 원본과 묶음 파일의 SHA-256을 기록한다. 실행 코드 블록은 원본과 같다.\n`);
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
