import { builtinModules } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const repository = fileURLToPath(new URL('..', import.meta.url));
const directions = {
  core: [], react: ['core'], svelte: ['core'], vue: ['core'], typegen: ['core'], vite: ['core', 'typegen'],
};
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
const packageName = specifier => specifier.startsWith('@')
  ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
const sourceTarget = target => target?.replace(/^\.\/dist\//, 'src/').replace(/\.(?:d\.)?js$/, '.ts');

// Parse syntax rather than text: comments and virtual-module source strings are not imports.
export function moduleReferences(text, file) {
  const ast = parse(text, { sourceType: 'module', sourceFilename: file, attachComment: false,
    plugins: [['typescript', { dts: file.endsWith('.d.ts') }], ...(file.endsWith('.tsx') ? ['jsx'] : [])] });
  const references = [];
  const add = (node, source, typeOnly = false) => references.push({
    specifier: source?.type === 'StringLiteral' ? source.value
      : source?.type === 'TemplateLiteral' && source.expressions.length === 0
        ? source.quasis[0].value.cooked : null,
    typeOnly, line: node.loc.start.line, column: node.loc.start.column + 1,
  });
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ImportDeclaration') {
      add(node, node.source, node.importKind === 'type' || (node.specifiers.length > 0
        && node.specifiers.every(item => item.importKind === 'type')));
    } else if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) {
      add(node, node.source, node.exportKind === 'type' || (node.specifiers?.length > 0
        && node.specifiers.every(item => item.exportKind === 'type')));
    } else if (node.type === 'ImportExpression') add(node, node.source);
    else if (node.type === 'TSImportType') add(node, node.source, true);
    else if (node.type === 'TSImportEqualsDeclaration' && node.moduleReference.type === 'TSExternalModuleReference') {
      add(node, node.moduleReference.expression, node.importKind === 'type');
    } else if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') {
      add(node, node.arguments[0]);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(item => { if (item?.type) visit(item); });
      else if (value?.type) visit(value);
    }
  }
  visit(ast.program);
  return references;
}

export function checkBoundaries(manifests, sources) {
  const violations = [];
  const references = new Map();
  const runtimeEdges = new Map();
  const nodeUses = new Map();
  const owned = new Map(Object.entries(manifests).map(([id, manifest]) => [manifest.name, id]));
  const report = (file, code, message, location = {}) => violations.push({ file, code, message,
    line: location.line ?? 1, column: location.column ?? 1 });
  const direction = (id, target) => id === target || directions[id]?.includes(target);
  const resolveSource = target => [target, target.replace(/\.d\.ts$/, '.ts'),
    target.replace(/\.(?:d\.)?ts$/, '.tsx')].find(candidate => sources.has(candidate));
  for (const [id, manifest] of Object.entries(manifests)) {
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      const target = owned.get(name);
      if (target && !direction(id, target)) report(`packages/${id}/package.json`, 'DIRECTION', `${id} cannot depend on ${target}`);
    }
  }
  for (const [file, text] of sources) {
    const id = file.split('/')[1];
    const manifest = manifests[id];
    if (!manifest) { report(file, 'PACKAGE', 'Source has no package manifest'); continue; }
    try { references.set(file, moduleReferences(text, file)); }
    catch (error) { report(file, 'SYNTAX', error.message, { line: error.loc?.line, column: (error.loc?.column ?? 0) + 1 }); continue; }
    const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]);
    const edges = [];
    for (const ref of references.get(file)) {
      const specifier = ref.specifier;
      if (specifier === null) { report(file, 'COMPUTED_IMPORT', 'Module path must be a literal so its boundary can be checked', ref); continue; }
      if (specifier.startsWith('node:') || builtins.has(specifier)) {
        if (!ref.typeOnly && !file.endsWith('.d.ts')) {
          const uses = nodeUses.get(file) ?? []; uses.push(ref); nodeUses.set(file, uses);
        }
        continue;
      }
      let target;
      if (specifier.startsWith('.')) {
        target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)).replace(/\.js$/, '.ts');
        if (!target.startsWith(`packages/${id}/src/`)) {
          report(file, 'PRIVATE_PATH', `Relative import ${specifier} escapes its package source`, ref); continue;
        }
        target = resolveSource(target);
        if (!target) { report(file, 'MISSING_SOURCE', `Local source for ${specifier} does not exist`, ref); continue; }
      } else {
        const name = packageName(specifier);
        const targetId = owned.get(name);
        if (name !== manifest.name && !declared.has(name)) report(file, 'UNDECLARED', `${name} is not a declared dependency or peer`, ref);
        if (targetId) {
          if (!direction(id, targetId)) report(file, 'DIRECTION', `${id} cannot import ${targetId}`, ref);
          const subpath = specifier === name ? '.' : '.' + specifier.slice(name.length);
          const entry = manifests[targetId].exports?.[subpath];
          if (!entry) { report(file, 'PRIVATE_EXPORT', `${specifier} is not an exported package entry`, ref); continue; }
          const output = typeof entry === 'string' ? entry : ref.typeOnly ? entry.types ?? entry.import : entry.import;
          if (!output) { report(file, 'NO_RUNTIME_EXPORT', `${specifier} has no runtime export`, ref); continue; }
          target = resolveSource(`packages/${targetId}/${sourceTarget(output)}`);
          if (!target) { report(file, 'MISSING_SOURCE', `Source for ${specifier} does not exist`, ref); continue; }
        }
      }
      if (target && !ref.typeOnly && !file.endsWith('.d.ts')) edges.push(target);
    }
    runtimeEdges.set(file, edges);
  }
  const browserRoots = [...sources.keys()].filter(file => ['core', 'react', 'svelte', 'vue'].includes(file.split('/')[1]) && !file.endsWith('.d.ts'));
  const client = manifests.vite?.exports?.['./client'];
  if (client) {
    const entry = resolveSource(`packages/vite/${sourceTarget(client.import)}`);
    if (entry) browserRoots.push(entry);
    else report('packages/vite/package.json', 'MISSING_SOURCE', 'Vite client runtime source does not exist');
  }
  const visited = new Set();
  const queue = browserRoots.map(file => ({ file, via: file }));
  for (let index = 0; index < queue.length; index++) {
    const { file, via } = queue[index];
    if (visited.has(file)) continue;
    visited.add(file);
    for (const ref of nodeUses.get(file) ?? []) report(file, 'BROWSER_NODE', `${ref.specifier} is reachable from browser source ${via}`, ref);
    for (const target of runtimeEdges.get(file) ?? []) queue.push({ file: target, via });
  }
  return { violations, packages: Object.keys(manifests).length, files: sources.size,
    references: [...references.values()].reduce((sum, refs) => sum + refs.length, 0), browserFiles: visited.size };
}

export async function checkRepository(root = repository) {
  const manifests = {};
  const sources = new Map();
  async function collect(directory, relative) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Source symlink needs an explicit boundary: ${file}`);
      if (entry.isDirectory()) await collect(path.join(directory, entry.name), file);
      else if (/\.tsx?$/.test(entry.name)) sources.set(file, await readFile(path.join(directory, entry.name), 'utf8'));
    }
  }
  for (const id of Object.keys(directions)) {
    manifests[id] = JSON.parse(await readFile(path.join(root, `packages/${id}/package.json`), 'utf8'));
    await collect(path.join(root, `packages/${id}/src`), `packages/${id}/src`);
  }
  return checkBoundaries(manifests, sources);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkRepository();
  for (const violation of result.violations) console.error(`${violation.file}:${violation.line}:${violation.column} [${violation.code}] ${violation.message}`);
  const { violations, ...summary } = result;
  console.log(`[boundaries] ${JSON.stringify({ ...summary, violations: violations.length })}`);
  if (violations.length) process.exitCode = 1;
}
