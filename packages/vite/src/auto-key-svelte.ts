import { createRequire } from 'node:module';
import path from 'node:path';

type SyntaxNode = { readonly type?: string; readonly start?: number; readonly end?: number; readonly [key: string]: unknown };
type AddSource = (text: string, expression?: boolean) => void;

/** Let the app's Svelte compiler delimit JavaScript; Babel still owns JS/TS analysis. */
export function svelteSources(source: string, file: string, add: AddSource): void {
  const require = createRequire(path.resolve(file));
  let compiler: typeof import('svelte/compiler');
  try { compiler = require('svelte/compiler'); }
  catch (cause) {
    throw new Error(`[saylo:auto-keys] Cannot load svelte/compiler for ${file}. Install Svelte 5 in the app or use explicit includeKeys.`, { cause });
  }
  if (!compiler.VERSION.startsWith('5.')) throw new Error(`[saylo:auto-keys] ${file} requires Svelte 5 for automatic source analysis. Use explicit includeKeys with other versions.`);
  let root: unknown;
  try { root = compiler.parse(source, { modern: true, filename: file }); }
  catch (cause) {
    throw new Error(`[saylo:auto-keys] Cannot analyze ${file}: ${cause instanceof Error ? cause.message : String(cause)}.`, { cause });
  }
  const text = (value: SyntaxNode) => {
    if (typeof value.start !== 'number' || typeof value.end !== 'number') throw new Error(`[saylo:auto-keys] Missing Svelte source range in ${file}.`);
    return source.slice(value.start, value.end);
  };
  function collect(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) collect(item); return; }
    const current = value as SyntaxNode;
    if (current.type === 'Script') {
      if ((current.attributes as SyntaxNode[]).some(attribute => typeof attribute.name === 'string' && attribute.name.toLowerCase() === 'src'))
        throw new Error(`[saylo:auto-keys] External SFC script sources in ${file} need an explicit includeKeys list.`);
      add(text(current.content as SyntaxNode)); return;
    }
    if (current.type === 'SnippetBlock') {
      add(`function ${text(current.expression as SyntaxNode)}(${(current.parameters as SyntaxNode[]).map(text).join(',')}) {}`);
      collect(current.body); return;
    }
    if (current.type === 'VariableDeclaration') { add(text(current)); return; }
    if (current.type && /(?:Expression|Literal)$|^(?:Identifier|Super|MetaProperty)$/.test(current.type)) {
      add(text(current), true); return;
    }
    for (const child of Object.values(current)) collect(child);
  }
  const component = root as SyntaxNode;
  collect(component.module);
  collect(component.instance);
  collect(component.fragment);
}
