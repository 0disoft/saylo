import { TYPE } from '@formatjs/icu-messageformat-parser/no-parser.js';
import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import type { DeepReadonly } from './types.js';

export type PseudoLocaleMode = 'accent' | 'long';

export function readPseudoLocale(value: unknown): PseudoLocaleMode | undefined {
  if (value === undefined || value === 'accent' || value === 'long') return value;
  throw new RangeError('pseudoLocale must be accent, long, or undefined.');
}

const accents = Object.fromEntries(Array.from('abcdefghijklmnopqrstuvwxyz').map((letter, index) =>
  [letter, Array.from('áƀçďëƒğĥïĵķľṁñöþʠřšţüṽŵẋÿž')[index]!]));

function literal(value: string, mode: PseudoLocaleMode): string {
  // Plain t() keeps markup literal. Preserve its markers too; tParts() has
  // already projected them to tag nodes before this transformation.
  return value.split(/(<\/?[A-Za-z][A-Za-z0-9_-]*>)/g).map((part, index) => {
    if (index % 2 || !/\p{L}/u.test(part)) return part;
    return part.replace(/\S(?:[\s\S]*\S)?/u, text => {
      const transformed = mode === 'accent' ? text.replace(/[a-z]/gi, letter => {
        const replacement = accents[letter.toLowerCase()]!;
        return letter === letter.toUpperCase() ? replacement.toUpperCase() : replacement;
      }) : text;
      const padding = '～'.repeat(Math.ceil(Array.from(text).length * (mode === 'accent' ? 0.35 : 1)));
      return `［${transformed}${padding}］`;
    });
  }).join('');
}

/** Transform only authored literals. ICU operands, branch keys, styles and tags are shared unchanged. */
export function pseudoMessageAst(ast: DeepReadonly<MessageFormatElement[]>, mode: PseudoLocaleMode): MessageFormatElement[] {
  return ast.map(element => {
    if (element.type === TYPE.literal) return { ...element, value: literal(element.value, mode) };
    if (element.type === TYPE.select || element.type === TYPE.plural) {
      return { ...element, options: Object.fromEntries(Object.entries(element.options).map(([key, option]) =>
        [key, { ...option, value: pseudoMessageAst(option.value, mode) }])) } as MessageFormatElement;
    }
    if (element.type === TYPE.tag)
      return { ...element, children: pseudoMessageAst(element.children, mode) };
    return element as MessageFormatElement;
  });
}
