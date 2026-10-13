import { IntlMessageFormat } from 'intl-messageformat';
import type { Formatters, FormatXMLElementFn } from 'intl-messageformat';
import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import type { ParsedMessage, RichTextPart } from './types.js';
import { freezeRichParts, projectRichText } from './rich-text.js';

class BoundedCache<T> {
  private readonly values = new Map<string, T>();
  constructor(private readonly limit: number) {}

  get(key: string, create: () => T): T {
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

/** Two separate bounded caches; text changes do not invalidate native Intl formatters. */
export function createTextFormatter(timeZone: string) {
  const numbers = new BoundedCache<Intl.NumberFormat>(128);
  const dates = new BoundedCache<Intl.DateTimeFormat>(128);
  const plurals = new BoundedCache<Intl.PluralRules>(128);
  const messages = new BoundedCache<IntlMessageFormat>(256);
  const richMessages = new BoundedCache<{ formatter: IntlMessageFormat; tags: ReadonlyMap<string, string> }>(256);
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
    // Exact source text is a collision-free content key for this initial implementation.
    const key = JSON.stringify([namespace, id, message.source, formatLocale, timeZone]);
    const formatter = messages.get(key, () => new IntlMessageFormat(
      // FormatJS reads this AST; it never receives a public mutable reference.
      message.ast as unknown as MessageFormatElement[], formatLocale, undefined, { formatters, ignoreTag: true },
    ));
    const result = formatter.format(values);
    return Array.isArray(result) ? result.join('') : String(result);
  };
  const parts = (namespace: string, id: string, message: ParsedMessage, formatLocale: string,
    values: Record<string, string | number>): readonly RichTextPart[] => {
    const key = JSON.stringify([namespace, id, message.source, formatLocale, timeZone]);
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
