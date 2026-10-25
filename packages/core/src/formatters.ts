import { IntlMessageFormat } from 'intl-messageformat';
import type { Formatters, FormatXMLElementFn } from 'intl-messageformat';
import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import type { ParsedMessage, RichTextPart } from './types.js';
import { freezeRichParts, projectRichText } from './rich-text.js';

const FORMATTER_CACHE_POLICY = Object.freeze({ intlEntries: 128, messageEntries: 256 });

class BoundedCache<T, K = string> {
  private readonly values = new Map<K, T>();
  constructor(private readonly limit: number) {}

  get(key: K, create: () => T): T {
    const cached = this.values.get(key);
    if (cached !== undefined) {
      this.values.delete(key);
      this.values.set(key, cached);
      return cached;
    }
    const value = create();
    this.values.set(key, value);
    if (this.values.size > this.limit) this.values.delete(this.values.keys().next().value!);
    return value;
  }
}

function intlKey(locale: unknown, options: object | undefined): string {
  return JSON.stringify([locale, Object.entries(options ?? {}).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))]);
}

function messageKey(namespace: string, id: string, message: ParsedMessage, locale: string, timeZone: string) {
  return { namespace, id, source: message.source, locale,
    key: JSON.stringify([namespace, id, message.source, locale, timeZone]) };
}

/** Two separate bounded caches; text changes do not invalidate native Intl formatters. */
export function createTextFormatter(timeZone: string) {
  const numbers = new BoundedCache<Intl.NumberFormat>(FORMATTER_CACHE_POLICY.intlEntries);
  const dates = new BoundedCache<Intl.DateTimeFormat>(FORMATTER_CACHE_POLICY.intlEntries);
  const plurals = new BoundedCache<Intl.PluralRules>(FORMATTER_CACHE_POLICY.intlEntries);
  const messages = new BoundedCache<IntlMessageFormat>(FORMATTER_CACHE_POLICY.messageEntries);
  const richMessages = new BoundedCache<{ formatter: IntlMessageFormat; tags: ReadonlyMap<string, string> }>(FORMATTER_CACHE_POLICY.messageEntries);
  // Bound identity hints as well as formatter instances: a WeakMap would retain
  // serialized keys for every still-live catalog message even after LRU eviction.
  const messageKeys = new BoundedCache<ReturnType<typeof messageKey>, ParsedMessage>(FORMATTER_CACHE_POLICY.messageEntries);
  const keyFor = (namespace: string, id: string, message: ParsedMessage, locale: string) => {
    const hint = messageKeys.get(message, () => messageKey(namespace, id, message, locale, timeZone));
    if (hint.namespace !== namespace || hint.id !== id || hint.source !== message.source || hint.locale !== locale)
      Object.assign(hint, messageKey(namespace, id, message, locale, timeZone));
    return hint.key;
  };
  const formatters: Formatters = {
    getNumberFormat: (locale, options) => numbers.get(intlKey(locale, options), () => new Intl.NumberFormat(locale, options)),
    getDateTimeFormat: (locale, options) => {
      // Apply to default styles and skeletons, overriding host timezone in both paths.
      const resolved = { ...options, timeZone };
      return dates.get(intlKey(locale, resolved), () => new Intl.DateTimeFormat(locale, resolved));
    },
    getPluralRules: (locale, options) => plurals.get(intlKey(locale, options), () => new Intl.PluralRules(locale, options)),
  };
  const text = (namespace: string, id: string, message: ParsedMessage, formatLocale: string, values: Record<string, string | number>): string => {
    // Keep exact content keys across catalog replacement, without copying the
    // full source again for every hot call on the same message and context.
    const key = keyFor(namespace, id, message, formatLocale);
    const formatter = messages.get(key, () => new IntlMessageFormat(
      // FormatJS reads this AST; it never receives a public mutable reference.
      message.ast as unknown as MessageFormatElement[], formatLocale, undefined, { formatters, ignoreTag: true },
    ));
    const result = formatter.format(values);
    return Array.isArray(result) ? result.join('') : String(result);
  };
  const parts = (namespace: string, id: string, message: ParsedMessage, formatLocale: string,
    values: Record<string, string | number>): readonly RichTextPart[] => {
    const key = keyFor(namespace, id, message, formatLocale);
    const { formatter, tags } = richMessages.get(key, () => {
      const projected = projectRichText(message.ast, `${namespace}:${id}`, message.arguments);
      return { formatter: new IntlMessageFormat(projected.ast, formatLocale, undefined, { formatters }), tags: projected.tags };
    });
    const richValues: Record<string, string | number | FormatXMLElementFn<RichTextPart>> = Object.assign(Object.create(null), values);
    for (const [alias, name] of tags) {
      richValues[alias] = children => Object.freeze({ type: 'tag' as const, name, children: freezeRichParts(children) });
    }
    return freezeRichParts(formatter.formatToParts<RichTextPart>(richValues).map(part => part.value));
  };
  return Object.assign(text, { parts });
}
