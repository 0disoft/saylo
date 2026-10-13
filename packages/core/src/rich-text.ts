import { TYPE } from '@formatjs/icu-messageformat-parser/no-parser.js';
import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import type { DeepReadonly, RichTextPart } from './types.js';

export class InvalidRichTextError extends Error {
  constructor(readonly key: string, detail: string) {
    super(`Invalid rich text for ${JSON.stringify(key)}: ${detail}`);
    this.name = 'InvalidRichTextError';
  }
}

/** Project only literal AST markers; interpolated user values never enter this scan. */
export function projectRichText(ast: DeepReadonly<MessageFormatElement[]>, key: string,
  argumentsSchema: object): { ast: MessageFormatElement[]; tags: ReadonlyMap<string, string> } {
  const tags = new Map<string, string>();
  const names = new Map<string, string>();
  function internalName(name: string) {
    const existing = names.get(name);
    if (existing) return existing;
    let alias = `__saylo_tag_${names.size}`;
    while (Object.hasOwn(argumentsSchema, alias) || tags.has(alias)) alias += '_';
    names.set(name, alias);
    tags.set(alias, name);
    return alias;
  }
  function walk(elements: DeepReadonly<MessageFormatElement[]>): MessageFormatElement[] {
    const result: MessageFormatElement[] = [];
    const stack: { name: string; children: MessageFormatElement[] }[] = [];
    const append = (element: MessageFormatElement) => (stack.at(-1)?.children ?? result).push(element);
    for (const element of elements) {
      if (element.type === TYPE.literal) {
        let offset = 0;
        for (const match of element.value.matchAll(/<\/?([A-Za-z][A-Za-z0-9_-]*)>/g)) {
          if (match.index > offset) append({ type: TYPE.literal, value: element.value.slice(offset, match.index) });
          const name = match[1]!;
          if (match[0].startsWith('</')) {
            const opened = stack.pop();
            if (!opened || opened.name !== name) throw new InvalidRichTextError(key, `Unexpected closing tag </${name}>.`);
            append({ type: TYPE.tag, value: internalName(name), children: opened.children });
          } else stack.push({ name, children: [] });
          offset = match.index + match[0].length;
        }
        if (offset < element.value.length) append({ type: TYPE.literal, value: element.value.slice(offset) });
      } else if (element.type === TYPE.select || element.type === TYPE.plural) {
        const options = Object.fromEntries(Object.entries(element.options).map(([name, option]) =>
          [name, { ...option, value: walk(option.value) }]));
        append({ ...element, options } as MessageFormatElement);
      } else if (element.type === TYPE.tag) {
        append({ ...element, value: internalName(element.value), children: walk(element.children) });
      } else append(element as MessageFormatElement);
    }
    if (stack.length) throw new InvalidRichTextError(key, `Unclosed tag <${stack.at(-1)!.name}>.`);
    return result;
  }
  return { ast: walk(ast), tags };
}

export function freezeRichParts(chunks: readonly (string | RichTextPart)[]): readonly RichTextPart[] {
  return Object.freeze(chunks.map(chunk => typeof chunk === 'string'
    ? Object.freeze({ type: 'text' as const, value: chunk }) : chunk));
}
