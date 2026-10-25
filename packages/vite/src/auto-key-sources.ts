import { parse } from '@babel/parser';
import { svelteSources } from './auto-key-svelte.js';

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
  if (file.endsWith('.svelte')) { svelteSources(source, file, add); return result; }
  if (!/\.vue$/.test(file)) { add(source); return result; }
  let cursor = 0, braces = 0, expressionQuote = '', attributeQuote = '', inTag = false;
  // Inspect only markup between blocks. Raw scripts and real comments are each
  // consumed whole, so comment-looking JavaScript strings cannot erase code.
  const inspectPrefix = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      const character = text[i]!;
      if (braces) {
        if (expressionQuote) {
          if (character === '\\') i++;
          else if (character === expressionQuote) expressionQuote = '';
        } else if ('\"\'`'.includes(character)) expressionQuote = character;
        else if (character === '{') braces++;
        else if (character === '}') braces--;
      } else if (character === '{' && (!attributeQuote && text[i + 1] === '{')) {
        braces = 2;
        i++;
      } else if (attributeQuote) {
        if (character === attributeQuote) attributeQuote = '';
      } else if (inTag) {
        if (character === '"' || character === "'") attributeQuote = character;
        else if (character === '>') inTag = false;
      } else if (character === '<' && /[a-z/!]/i.test(text[i + 1] ?? '')) inTag = true;
    }
  };
  const markup = source.replace(/<!--[^]*?-->|<(script|style)\b([^>]*)>([^]*?)<\/\1\s*>/gi,
    (whole, tag: string | undefined, attributes: string, body: string, offset: number) => {
      inspectPrefix(source.slice(cursor, offset));
      if (braces || attributeQuote || inTag)
        throw new Error(`[saylo:auto-keys] Comment or script markers inside template expressions or attributes in ${file} need an explicit includeKeys list.`);
      cursor = offset + whole.length;
      if (tag?.toLowerCase() === 'script') {
        if (/\bsrc\s*=/i.test(attributes))
          throw new Error(`[saylo:auto-keys] External SFC script/template sources in ${file} need an explicit includeKeys list.`);
        add(body);
      }
      return '';
    });
  if (/<(?:script|template)\b[^>]*\bsrc\s*=/i.test(markup))
    throw new Error(`[saylo:auto-keys] External SFC script/template sources in ${file} need an explicit includeKeys list.`);
  if (file.endsWith('.vue')) {
    for (const match of markup.matchAll(/{{([^]*?)}}/g)) add(match[1]!, true);
    for (const match of markup.matchAll(/(?:\s|<)(?:[:@][\w:.[\]-]+|v-[\w:.[\]-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      let expression = entities(match[1] ?? match[2]!);
      if (/v-for\s*=/.test(match[0])) expression = expression.replace(/^[^]*?\s+(?:in|of)\s+/, '');
      add(expression, true, true);
    }
    return result;
  }
  return result;
}
