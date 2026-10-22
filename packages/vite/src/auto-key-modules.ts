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
}
const extensions = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.cjs', '.cts', '.vue', '.svelte'];

export type ImportResolver = (specifier: string, importer: string) => Promise<string | undefined>;

/** Resolve configured aliases without reading additional sources or expanding the scan boundary. */
export async function resolveModuleImports(sources: readonly ModuleFacts[], resolveImport?: ImportResolver): Promise<ReadonlyMap<string, string>> {
  const resolved = new Map<string, string>();
  if (!resolveImport) return resolved;
  const modules = new Set(sources.map(source => moduleId(source.file)));
  const imports = sources.flatMap(source => [...new Set([...source.namedImports, ...source.namespaceImports]
    .map(imported => imported.specifier))].map(specifier => ({ specifier, importer: source.file })));
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
  for (const source of sources) {
    for (const imported of source.namedImports) {
      const target = resolve(source.file, imported.specifier);
      if (target) edge(memberId(moduleId(target.file), imported.imported), localId(source.file, imported.local));
    }
    for (const imported of source.namespaceImports) {
      const target = resolve(source.file, imported.specifier);
      if (!target) { if (imported.specifier.startsWith('.')) unknown(imported.token); continue; }
      for (const [name] of target.exports) {
        const member = memberId(imported.token, name);
        edge(memberId(moduleId(target.file), name), member);
        edge(member, imported.token);
      }
    }
  }
}
