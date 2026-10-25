const NO_FALLBACK_LOCALES: readonly string[] = Object.freeze([]);

function canonicalLocale(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Locale values must be strings.');
  const locale = Intl.getCanonicalLocales(value)[0];
  if (!locale) throw new RangeError('Locale must not be empty.');
  return locale;
}

/** Canonicalize the explicit list once at instance creation; order remains user-defined. */
export function normalizeFallbackLocales(fallbackLocales: readonly string[] | undefined): readonly string[] {
  if (fallbackLocales === undefined) return NO_FALLBACK_LOCALES;
  if (!Array.isArray(fallbackLocales)) throw new TypeError('fallbackLocales must be an array.');
  const locales: string[] = [];
  const seen = new Set<string>();
  for (const value of fallbackLocales) {
    const locale = canonicalLocale(value);
    if (seen.has(locale)) throw new RangeError('Fallback locales must be unique after canonicalization.');
    seen.add(locale);
    locales.push(locale);
  }
  return locales.length ? Object.freeze(locales) : NO_FALLBACK_LOCALES;
}

/**
 * Build a finite, deduplicated message lookup chain. The selected locale wins,
 * explicit fallbacks keep their order, and the base locale is always terminal.
 * A configured entry equal to the selected or base locale is already satisfied.
 */
export function fallbackLocaleChain(selectedLocale: string, fallbackLocales: readonly string[],
  baseLocale: string): readonly string[] {
  const selected = canonicalLocale(selectedLocale);
  const base = canonicalLocale(baseLocale);
  const chain = [selected];
  const seen = new Set(chain);
  if (selected !== base) {
    for (const value of normalizeFallbackLocales(fallbackLocales)) {
      if (value === base || seen.has(value)) continue;
      seen.add(value);
      chain.push(value);
    }
    chain.push(base);
  }
  return Object.freeze(chain);
}
