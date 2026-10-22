import path from 'node:path';

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

/** Link only scanned relative modules; unrelated package namespaces have no translator evidence. */
export function linkNamespaceImports(sources: readonly ModuleFacts[], edge: (from: string, to: string) => void,
  unknown: (token: string) => void) {
  const modules = new Map(sources.map(source => [moduleId(source.file), source]));
  const resolve = (file: string, specifier: string) => {
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
      if (!imported.specifier.startsWith('.')) continue;
      const target = resolve(source.file, imported.specifier);
      if (target) edge(memberId(moduleId(target.file), imported.imported), localId(source.file, imported.local));
    }
    for (const imported of source.namespaceImports) {
    if (!imported.specifier.startsWith('.')) continue;
    const target = resolve(source.file, imported.specifier);
    if (!target) { unknown(imported.token); continue; }
    for (const [name] of target.exports) {
      const member = memberId(imported.token, name);
      edge(memberId(moduleId(target.file), name), member);
      edge(member, imported.token);
    }
    }
  }
}
