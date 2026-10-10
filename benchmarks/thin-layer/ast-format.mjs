import { IntlMessageFormat } from 'intl-messageformat';

class BoundedCache {
  constructor(limit) { this.limit = limit; this.values = new Map(); }
  get(key, create) {
    if (this.values.has(key)) {
      const value = this.values.get(key);
      this.values.delete(key); this.values.set(key, value);
      return value;
    }
    const value = create();
    this.values.set(key, value);
    if (this.values.size > this.limit) this.values.delete(this.values.keys().next().value);
    return value;
  }
}

const intlKey = (locale, options) => JSON.stringify([locale,
  Object.entries(options ?? {}).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))]);

// Benchmark-only implementation of i18next's public i18nFormat extension.
// Each immutable engine/snapshot owns its formatter and bounded caches.
// The original AST and process-wide Intl/default formats remain untouched.
export function createAstFormat(timeZone) {
  const messages = new BoundedCache(256);
  const numbers = new BoundedCache(128), dates = new BoundedCache(128), plurals = new BoundedCache(128);
  const formatters = {
    getNumberFormat: (locale, options) => numbers.get(intlKey(locale, options), () => new Intl.NumberFormat(locale, options)),
    getDateTimeFormat: (locale, options) => {
      const resolved = { ...options, timeZone };
      return dates.get(intlKey(locale, resolved), () => new Intl.DateTimeFormat(locale, resolved));
    },
    getPluralRules: (locale, options) => plurals.get(intlKey(locale, options), () => new Intl.PluralRules(locale, options)),
  };
  return {
    type: 'i18nFormat',
    init() {},
    parse(ast, options, locale, namespace, key) {
      const formatter = messages.get(JSON.stringify([locale, namespace, key]),
        () => new IntlMessageFormat(ast, locale, undefined, { formatters, ignoreTag: true }));
      const value = formatter.format(options.values);
      return Array.isArray(value) ? value.join('') : String(value);
    },
    addLookupKeys(keys) { return keys; },
  };
}
