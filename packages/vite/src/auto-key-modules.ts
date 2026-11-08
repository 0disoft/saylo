import path from 'node:path';
import { mapFileTasks } from './catalog-files.js';

export const namespaceId = (file: string, specifier: string) => JSON.stringify(['namespace', file, specifier]);
export const memberId = (namespace: string, name: string) => JSON.stringify(['member', namespace, name]);
export const moduleId = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
export const localId = (file: string, name: string) => name.startsWith('[') ? name : JSON.stringify(['local', moduleId(file), name]);

interface ModuleFacts {
  readonly file: string;
  readonly namespaceImports: readonly { specifier: string; token: string }[];
  readonly exports: readonly (readonly [string, unknown])[];
  readonly namedImports: readonly { specifier: string; imported: string; local: string }[];
  readonly starExports: readonly string[];
}
const extensions = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.cjs', '.cts', '.vue', '.svelte'];

export type ImportResolver = (specifier: string, importer: string) => Promise<string | undefined>;

/** Resolve configured aliases without reading additional sources or expanding the scan boundary. */
export async function resolveModuleImports(sources: readonly ModuleFacts[], resolveImport?: ImportResolver): Promise<ReadonlyMap<string, string>> {
  const resolved = new Map<string, string>();
  if (!resolveImport) return resolved;
  const modules = new Set(sources.map(source => moduleId(source.file)));
  const imports = sources.flatMap(source => [...new Set([...source.namedImports, ...source.namespaceImports]
    .map(imported => imported.specifier).concat(source.starExports))].map(specifier => ({ specifier, importer: source.file })));
  const results = await mapFileTasks(imports, async ({ specifier, importer }) => {
    const target = await resolveImport(specifier, importer);
    if (target === undefined) return;
    if (!modules.has(moduleId(target))) throw new Error(`[saylo:auto-keys] Aliased import ${JSON.stringify(specifier)} in ${importer} resolves outside scanned sources: ${target}. Include its source in includeKeys.from or use an explicit includeKeys list.`);
    return [namespaceId(importer, specifier), moduleId(target)] as const;
  });
  for (const result of results) if (result) resolved.set(...result);
  return resolved;
}

/** Link scanned relative modules and Vite-resolved aliases; other packages have no translator evidence. */
export function linkNamespaceImports(sources: readonly ModuleFacts[], edge: (from: string, to: string) => void,
  unknown: (token: string) => void, resolvedImports: ReadonlyMap<string, string> = new Map()) {
  const modules = new Map(sources.map(source => [moduleId(source.file), source]));
  const resolve = (file: string, specifier: string) => {
    const resolved = resolvedImports.get(namespaceId(file, specifier));
    if (resolved) return modules.get(resolved);
    if (!specifier.startsWith('.')) return;
    const base = path.resolve(path.dirname(file), specifier);
    const candidates = [base];
    const extension = path.extname(base);
    if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
      const stem = base.slice(0, -extension.length);
      candidates.push(stem + ({ '.js': '.ts', '.jsx': '.tsx', '.mjs': '.mts', '.cjs': '.cts' }[extension]));
    }
    if (!extension) {
      for (const suffix of extensions) candidates.push(base + suffix);
      for (const suffix of extensions) candidates.push(path.join(base, 'index' + suffix));
    }
    return candidates.map(candidate => modules.get(moduleId(candidate))).find(Boolean);
  };
  const ownExports = new Map(sources.map(source => [source, new Set(source.exports.map(([name]) => name))]));
  const exportNames = new Map(sources.map(source => [source, new Set(ownExports.get(source))]));
  const starDependents = new Map<ModuleFacts, Set<ModuleFacts>>();
  for (const source of sources) for (const specifier of source.starExports) {
    const target = resolve(source.file, specifier);
    if (!target) throw new Error(`[saylo:auto-keys] Wildcard reexport ${JSON.stringify(specifier)} in ${source.file} cannot be resolved within scanned sources. Include its source in includeKeys.from or use an explicit includeKeys list.`);
    let dependents = starDependents.get(target);
    if (!dependents) { dependents = new Set(); starDependents.set(target, dependents); }
    dependents.add(source);
  }
  // Discover transitive export names before linking namespace members. Each name
  // visits a module once, so barrel cycles terminate without recursion.
  const queue: [ModuleFacts, string][] = sources.flatMap(source => [...exportNames.get(source)!].map(name => [source, name] as [ModuleFacts, string]));
  for (let index = 0; index < queue.length; index++) {
    const [target, name] = queue[index]!;
    if (name === 'default') continue;
    for (const source of starDependents.get(target) ?? []) {
      if (ownExports.get(source)!.has(name)) continue; // Explicit exports override export *.
      edge(memberId(moduleId(target.file), name), memberId(moduleId(source.file), name));
      const names = exportNames.get(source)!;
      if (!names.has(name)) { names.add(name); queue.push([source, name]); }
    }
  }
  for (const source of sources) {
    for (const imported of source.namedImports) {
      const target = resolve(source.file, imported.specifier);
      if (target) edge(memberId(moduleId(target.file), imported.imported), localId(source.file, imported.local));
    }
    for (const imported of source.namespaceImports) {
      const target = resolve(source.file, imported.specifier);
      if (!target) { if (imported.specifier.startsWith('.')) unknown(imported.token); continue; }
      for (const name of exportNames.get(target)!) {
        const member = memberId(imported.token, name);
        edge(memberId(moduleId(target.file), name), member);
        edge(member, imported.token);
      }
    }
  }
}
