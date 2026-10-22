import type { ArgumentType, ParsedMessage } from '@0disoft/saylo-core';

/** Advisory only: actual import/approval validation always uses the current catalogs and config. */
export interface TranslationWorkContext {
  readonly arguments: Readonly<Record<string, readonly ArgumentType[]>>;
  /** Null is literal mode; [] is rich mode with no allowed tags. */
  readonly richTextTags: readonly string[] | null;
}

export function createTranslationWorkContext(message: ParsedMessage): TranslationWorkContext {
  return { arguments: Object.fromEntries(Object.keys(message.arguments).sort().map(name =>
    [name, [...message.arguments[name]!.acceptedTypes].sort()])),
    richTextTags: message.richTextTags === undefined ? null : [...message.richTextTags].sort() };
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const types = new Set(['string', 'number', 'date']);
export function isTranslationWorkContext(value: unknown): value is TranslationWorkContext {
  if (!record(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'arguments') ||
      !Object.hasOwn(value, 'richTextTags') || !record(value.arguments)) return false;
  for (const [name, accepted] of Object.entries(value.arguments)) {
    if (!name || !Array.isArray(accepted) || !accepted.length || new Set(accepted).size !== accepted.length ||
        !accepted.every(type => typeof type === 'string' && types.has(type))) return false;
  }
  return value.richTextTags === null || (Array.isArray(value.richTextTags) &&
    new Set(value.richTextTags).size === value.richTextTags.length &&
    value.richTextTags.every(tag => typeof tag === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(tag)));
}
