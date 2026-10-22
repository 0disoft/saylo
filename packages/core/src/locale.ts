/** A canonical HTTP language range, ordered by descending quality then header order. */
export interface LanguagePreference {
  readonly range: string;
  readonly quality: number;
}

function canonicalLocale(value: string): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try { return Intl.getCanonicalLocales(value)[0]; }
  catch { return undefined; }
}

function localePolicy(supportedLocales: readonly string[], fallbackLocale: string) {
  const supported = new Set<string>();
  for (const value of supportedLocales) {
    const locale = canonicalLocale(value);
    if (!locale) throw new RangeError(`Invalid supported locale: ${value}`);
    if (supported.has(locale)) throw new RangeError(`Duplicate supported locale: ${locale}`);
    supported.add(locale);
  }
  const fallback = canonicalLocale(fallbackLocale);
  if (!fallback || !supported.has(fallback)) throw new RangeError('Fallback locale must be supported');
  return { supported, fallback };
}

function lookup(candidate: string, supported: ReadonlySet<string>): string | undefined {
  let locale = canonicalLocale(candidate);
  while (locale) {
    if (supported.has(locale)) return locale;
    const subtags = locale.split('-');
    subtags.pop();
    // Remove a trailing extension/private-use singleton together with its value (RFC 4647).
    if (subtags.at(-1)?.length === 1) subtags.pop();
    locale = subtags.join('-');
  }
  return undefined;
}

/** Try candidates in app-defined order, using exact then parent tags; never guess a region. */
export function resolveLocale(
  candidates: readonly string[], supportedLocales: readonly string[], fallbackLocale: string,
): string {
  const { supported, fallback } = localePolicy(supportedLocales, fallbackLocale);
  for (const candidate of candidates) {
    const locale = lookup(candidate, supported);
    if (locale) return locale;
  }
  return fallback;
}

/** Ignore malformed entries; retain q=0 ranges so callers cannot accidentally lose exclusions. */
export function parseAcceptLanguage(header: string | null | undefined): readonly LanguagePreference[] {
  const preferences: LanguagePreference[] = [];
  for (const entry of (header ?? '').split(',')) {
    const match = /^[\t ]*(\*|[a-z]{1,8}(?:-[a-z0-9]{1,8})*)[\t ]*(?:;[\t ]*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?[\t ]*$/i.exec(entry);
    if (!match) continue;
    const range = match[1] === '*' ? '*' : canonicalLocale(match[1]!);
    if (range) preferences.push(Object.freeze({ range, quality: match[2] === undefined ? 1 : Number(match[2]) }));
  }
  return Object.freeze(preferences.sort((a, b) => b.quality - a.quality));
}

function rangeMatches(range: string, locale: string): boolean {
  return range === '*' || locale === range || locale.startsWith(`${range}-`);
}

function isExcluded(locale: string, preferences: readonly LanguagePreference[]): boolean {
  let specificity = -1;
  let excluded = false;
  for (const { range, quality } of preferences) {
    if (!rangeMatches(range, locale)) continue;
    const depth = range === '*' ? 0 : range.split('-').length;
    if (depth > specificity) { specificity = depth; excluded = quality === 0; }
    else if (depth === specificity && quality === 0) excluded = true;
  }
  return excluded;
}

/**
 * Negotiate HTTP preferences with parent lookup and most-specific q=0 exclusions.
 * Wildcards supply a default after explicit ranges: prefer the fallback, then supported order.
 * If nothing is acceptable, return the app fallback (this helper never produces HTTP 406).
 */
export function resolveAcceptLanguage(
  header: string | null | undefined, supportedLocales: readonly string[], fallbackLocale: string,
): string {
  const { supported, fallback } = localePolicy(supportedLocales, fallbackLocale);
  const preferences = parseAcceptLanguage(header);
  const acceptable = new Set([...supported].filter(locale => !isExcluded(locale, preferences)));
  for (const { range, quality } of preferences) {
    if (quality === 0 || range === '*') continue;
    const locale = lookup(range, acceptable);
    if (locale) return locale;
  }
  if (preferences.some(({ range, quality }) => range === '*' && quality > 0)) {
    if (acceptable.has(fallback)) return fallback;
    return acceptable.values().next().value ?? fallback;
  }
  return fallback;
}
