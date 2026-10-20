import { parse } from '@babel/parser';

export interface SourceNode {
  readonly type: string;
  readonly [key: string]: unknown;
}

export function node(value: unknown): SourceNode | undefined {
  return value !== null && typeof value === 'object' && 'type' in value && typeof value.type === 'string'
    ? value as SourceNode : undefined;
}

export function visit(value: unknown, callback: (value: SourceNode, parent?: SourceNode) => void, parent?: SourceNode) {
  const current = node(value);
  if (!current) return;
  callback(current, parent);
  for (const child of Object.values(current)) {
    if (Array.isArray(child)) child.forEach(value => visit(value, callback, current));
    else if (node(child)) visit(child, callback, current);
  }
}

const entities = (value: string) => value.replace(/&(?:quot|apos|amp|lt|gt);/g,
  match => ({ '&quot;': '"', '&apos;': "'", '&amp;': '&', '&lt;': '<', '&gt;': '>' })[match]!);

/** SFC markup is never parsed as JavaScript. Extract its scripts and expressions separately. */
export function sourceTrees(source: string, file: string): SourceNode[] {
  const result: SourceNode[] = [];
  const add = (text: string, expression = false, statements = false) => {
    if (!text.trim()) return;
    try {
      result.push(parse(expression ? `(${text})` : text, { sourceType: 'unambiguous',
        plugins: ['typescript', 'jsx'], attachComment: false }) as unknown as SourceNode);
    } catch (error) {
      if (expression && statements) { add(text); return; }
      throw new Error(`[saylo:auto-keys] Cannot analyze ${file}: ${error instanceof Error ? error.message : String(error)}. Use explicit includeKeys for unsupported syntax.`);
    }
  };
  if (!/\.(?:vue|svelte)$/.test(file)) { add(source); return result; }
  let markup = source.replace(/<!--[^]*?-->/g, '');
  if (/<(?:script|template)\b[^>]*\bsrc\s*=/i.test(markup))
    throw new Error(`[saylo:auto-keys] External SFC script/template sources in ${file} need an explicit includeKeys list.`);
  markup = markup.replace(/<(script|style)\b[^>]*>([^]*?)<\/\1\s*>/gi, (_whole, tag: string, body: string) => {
    if (tag.toLowerCase() === 'script') add(body);
    return '';
  });
  if (file.endsWith('.vue')) {
    for (const match of markup.matchAll(/{{([^]*?)}}/g)) add(match[1]!, true);
    for (const match of markup.matchAll(/(?:\s|<)(?:[:@][\w:.[\]-]+|v-[\w:.[\]-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      let expression = entities(match[1] ?? match[2]!);
      if (/v-for\s*=/.test(match[0])) expression = expression.replace(/^[^]*?\s+(?:in|of)\s+/, '');
      add(expression, true, true);
    }
    return result;
  }
  // Find balanced Svelte expressions, including object literals and quoted braces.
  for (let start = 0; start < markup.length; start++) {
    if (markup[start] !== '{') continue;
    let depth = 1, quote = '', end = start + 1;
    for (; end < markup.length && depth; end++) {
      const character = markup[end]!;
      if (quote) {
        if (character === '\\') end++;
        else if (character === quote) quote = '';
      } else if (character === '"' || character === "'" || character === '`') quote = character;
      else if (character === '{') depth++;
      else if (character === '}') depth--;
    }
    if (depth) throw new Error(`[saylo:auto-keys] Unclosed template expression in ${file}.`);
    let expression = markup.slice(start + 1, end - 1).trim();
    start = end - 1;
    if (expression.startsWith('#snippet ')) { add(`function ${expression.slice(9)} {}`); continue; }
    if (/^(?:\/|:else\s*$|:then\b|:catch\b)/.test(expression)) continue;
    expression = expression.replace(/^:else\s+if\s+/, '').replace(/^#(?:if|key|await)\s+/, '')
      .replace(/^@(?:html|render|debug)\s+/, '');
    if (expression.startsWith('#each ')) {
      const parts = expression.slice(6).split(/\s+as\s+/);
      const key = parts.slice(1).join(' as ').match(/\(([^]*)\)\s*$/)?.[1];
      if (key) add(key, true);
      expression = parts[0]!;
    }
    if (expression.startsWith('@const ')) add('const ' + expression.slice(7));
    else add(expression, true);
  }
  return result;
}
