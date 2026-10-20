import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedCatalog } from '@0disoft/saylo-core';
import { node, sourceTrees, visit } from './auto-key-sources.js';
import type { SourceNode } from './auto-key-sources.js';

export interface AutoIncludeKeys {
  /** Files or directories relative to Vite root. Directories are scanned recursively. */
  readonly from: readonly string[];
  /** Explicit keys used by calls whose key cannot be determined statically. */
  readonly dynamicKeys?: readonly string[];
}

const ignored = new Set(['node_modules', '.git', '.release', 'dist', 'build', '.svelte-kit', 'coverage']);
const identifier = (value: unknown) => { const current = node(value); return current?.type === 'Identifier' ? current.name as string : undefined; };
const literal = (value: unknown): string | undefined => {
  const current = node(value);
  if (current?.type === 'StringLiteral') return current.value as string;
  if (current?.type === 'TemplateLiteral' && Array.isArray(current.expressions) && !current.expressions.length) {
    const part = current.quasis as { value: { cooked: string } }[];
    return part[0]?.value.cooked;
  }
  return;
};
const property = (value: unknown) => { const current = node(value); return current?.computed ? literal(current.property) : identifier(current?.property); };
const translatedProperty = (value: unknown) => ['t', 'tParts'].includes(property(value) ?? '');

export function readAutoKeys(value: unknown): AutoIncludeKeys | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const config = value as AutoIncludeKeys;
  if (!Array.isArray(config.from) || !config.from.length || config.from.some(file => typeof file !== 'string' || !file.trim()) ||
      (config.dynamicKeys !== undefined && (!Array.isArray(config.dynamicKeys) || config.dynamicKeys.some(key => typeof key !== 'string' || !/^[^:]+:[^:]+$/.test(key)))))
    throw new TypeError('Automatic includeKeys needs nonempty from paths and optional namespace:messageId dynamicKeys.');
  return Object.freeze({ from: Object.freeze([...config.from]),
    ...(config.dynamicKeys ? { dynamicKeys: Object.freeze([...config.dynamicKeys]) } : {}) });
}

/** Conservative source selection: matching literals may retain extra keys, never execute app code. */
export async function findIncludedKeys(root: string, catalogs: readonly ParsedCatalog[], baseLocale: string, config: AutoIncludeKeys,
  onSource: (file: string) => void = () => {}): Promise<readonly string[]> {
  const available = new Set(catalogs.filter(c => c.locale === baseLocale).flatMap(c => Object.keys(c.messages).map(id => `${c.namespace}:${id}`)));
  const selected = new Set(config.dynamicKeys ?? []);
  const paths = new Set<string>();
  const resolvedRoot = await realpath(root);
  const inside = (file: string) => { const relative = path.relative(resolvedRoot, file); return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep); };
  async function scan(file: string) {
    if (!inside(file)) throw new Error(`[saylo:auto-keys] Source escapes Vite root: ${file}`);
    const info = await lstat(file);
    if (info.isSymbolicLink()) throw new Error(`[saylo:auto-keys] Source symlinks are not supported: ${file}`);
    if (!inside(await realpath(file))) throw new Error(`[saylo:auto-keys] Source resolves outside Vite root: ${file}`);
    onSource(file);
    if (info.isDirectory()) {
      for (const entry of (await readdir(file, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!ignored.has(entry.name) && !entry.name.startsWith('.')) await scan(path.join(file, entry.name));
      }
    } else if (info.isFile() && /\.(?:[cm]?[jt]sx?|vue|svelte)$/.test(file) && !/\.d\.[cm]?ts$/.test(file)) paths.add(file);
  }
  for (const entry of config.from) await scan(path.resolve(resolvedRoot, entry));
  if (!paths.size) throw new Error('[saylo:auto-keys] No JavaScript, TypeScript, Vue or Svelte source files were found.');
  const trees = await Promise.all([...paths].map(async file => ({ file, trees: sourceTrees(await readFile(file, 'utf8'), file) })));
  const aliases = new Set(['t', 'tParts', '$t']);
  // Resolve simple aliases, including destructuring, without assuming a framework.
  for (let before = -1; before !== aliases.size;) {
    before = aliases.size;
    for (const source of trees) for (const tree of source.trees) visit(tree, current => {
      if (current.type === 'ImportSpecifier' && aliases.has(identifier(current.imported) ?? '')) {
        const local = identifier(current.local); if (local) aliases.add(local);
      }
      if (current.type !== 'VariableDeclarator' && current.type !== 'AssignmentExpression') return;
      const left = node(current.id ?? current.left), right = node(current.init ?? current.right);
      const name = identifier(left);
      if (name && (translatedProperty(right) || aliases.has(identifier(right) ?? ''))) aliases.add(name);
      const bound = right?.type === 'CallExpression' ? node(right.callee) : undefined;
      if (name && property(bound) === 'bind' && (translatedProperty(bound?.object) || aliases.has(identifier(bound?.object) ?? ''))) aliases.add(name);
      if (left?.type === 'ObjectPattern') for (const value of left.properties as SourceNode[]) {
        if (['t', 'tParts'].includes(identifier(value.key) ?? literal(value.key) ?? '')) {
          const local = identifier(value.value); if (local) aliases.add(local);
        }
      }
    });
  }
  const dynamic: string[] = [];
  for (const source of trees) for (const tree of source.trees) visit(tree, current => {
    const value = literal(current);
    if (value !== undefined && available.has(value)) selected.add(value);
    if (current.type !== 'CallExpression' && current.type !== 'OptionalCallExpression') return;
    let callee = node(current.callee);
    let argument = (current.arguments as unknown[])[0];
    const target = node(callee?.object);
    if (['call', 'apply'].includes(property(callee) ?? '') && (translatedProperty(target) || aliases.has(identifier(target) ?? ''))) {
      argument = (current.arguments as unknown[])[1];
      if (property(callee) === 'apply') argument = (node(argument)?.elements as unknown[] | undefined)?.[0];
      callee = target;
    }
    // Passing a translator to unknown code cannot prove a finite set of keys.
    if ((current.arguments as unknown[]).some(value => translatedProperty(value) || aliases.has(identifier(value) ?? '')))
      dynamic.push(path.relative(root, source.file));
    if (!aliases.has(identifier(callee) ?? '') && !translatedProperty(callee)) return;
    const key = literal(argument);
    if (key !== undefined) { if (/^[^:]+:[^:]+$/.test(key)) selected.add(key); return; }
    const template = node(argument);
    if (template?.type === 'TemplateLiteral') {
      const quasis = template.quasis as { value: { cooked: string | null } }[];
      const pieces = quasis.map(q => q.value.cooked);
      if (pieces.every((p): p is string => p !== null) && pieces.some(p => p.length > 0)) {
        const pattern = new RegExp('^' + pieces.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
        for (const candidate of available) if (pattern.test(candidate)) selected.add(candidate);
        return;
      }
    }
    dynamic.push(path.relative(root, source.file));
  });
  if (dynamic.length && !config.dynamicKeys?.length) throw new Error(`[saylo:auto-keys] Dynamic translation keys in ${[...new Set(dynamic)].join(', ')}. Supply includeKeys.dynamicKeys or use an explicit includeKeys list.`);
  return Object.freeze([...selected].sort());
}
