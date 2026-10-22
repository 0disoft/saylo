import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedCatalog } from '@0disoft/saylo-core';
import { analyzeSource, resolveAliases, isTranslator } from './auto-key-analysis.js';
import { mapFileTasks } from './catalog-files.js';

export interface AutoIncludeKeys {
  /** Files or directories relative to Vite root. Directories are scanned recursively. */
  readonly from: readonly string[];
  /** Explicit keys used by calls whose key cannot be determined statically. */
  readonly dynamicKeys?: readonly string[];
}

const ignored = new Set(['node_modules', '.git', '.release', 'dist', 'build', '.svelte-kit', 'coverage']);
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
  const sources = await mapFileTasks([...paths], async file => analyzeSource(await readFile(file, 'utf8'), file, available));
  const aliases = resolveAliases(sources);
  const byNamespace = new Map<string, string[]>();
  for (const key of available) {
    const namespace = key.slice(0, key.indexOf(':'));
    let keys = byNamespace.get(namespace);
    if (!keys) { keys = []; byNamespace.set(namespace, keys); }
    keys.push(key);
  }
  const matchedPatterns = new Map<string, readonly string[]>();
  const dynamic = new Set<string>();
  for (const source of sources) {
    const markDynamic = () => { dynamic.add(path.relative(root, source.file)); };
    for (const key of source.literals) selected.add(key);
    if (source.escapes.some(ref => isTranslator(ref, aliases))) markDynamic();
    for (const call of source.calls) {
      if (call.arguments.some(ref => isTranslator(ref, aliases))) markDynamic();
      if (!isTranslator(call.callee, aliases)) continue;
      if (call.key !== undefined) { if (/^[^:]+:[^:]+$/.test(call.key)) selected.add(call.key); continue; }
      const pieces = call.pieces;
      if (!pieces || !pieces.every((p): p is string => p !== null) || !pieces.some(p => p.length > 0)) { markDynamic(); continue; }
      const identity = JSON.stringify(pieces);
      let matched = matchedPatterns.get(identity);
      if (!matched) {
        const pattern = new RegExp('^' + pieces.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 's');
        const first = pieces[0] ?? '', separator = first.indexOf(':');
        const candidates = separator >= 0 ? byNamespace.get(first.slice(0, separator)) ?? [] : available;
        matched = [...candidates].filter(candidate => pattern.test(candidate));
        matchedPatterns.set(identity, matched);
      }
      for (const key of matched) selected.add(key);
    }
  }
  if (dynamic.size && !config.dynamicKeys?.length) throw new Error(`[saylo:auto-keys] Dynamic translation keys in ${[...dynamic].join(', ')}. Supply includeKeys.dynamicKeys or use an explicit includeKeys list.`);
  return Object.freeze([...selected].sort());
}
