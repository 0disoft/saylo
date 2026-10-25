import { CatalogError, immutableSnapshot } from './diagnostics.js';
import { createTextFormatter } from './formatters.js';
import { fallbackLocaleChain, normalizeFallbackLocales } from './locale-chain.js';
import { InvalidRichTextError } from './rich-text.js';
import { createBaseSchema, validateTranslation } from './schema.js';
import { InvalidArgumentError, NamespaceNotLoadedError, UnknownMessageError } from './translation-errors.js';
import { captureErrorPolicy, formatErrorFallback, missingKeyFallback } from './translation-policy.js';
import type { CatalogSchema, MessageSchema, ParsedCatalog, Schema, Translate, TranslateParts, Translator, TranslatorOptions } from './types.js';

function catalogError(catalog: ParsedCatalog, code: 'DUPLICATE_CATALOG' | 'LOCALE_MISMATCH' | 'NAMESPACE_MISMATCH', message: string): never {
  throw new CatalogError([{ code, message, sourceName: catalog.sourceName, locale: catalog.locale, namespace: catalog.namespace }]);
}

function dateValue(value: unknown): number | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  try {
    const timestamp = Date.prototype.getTime.call(value);
    return Number.isFinite(timestamp) ? timestamp : undefined;
  } catch { return undefined; }
}

function validateArguments(key: string, schema: MessageSchema, args: Record<string, unknown> | undefined): Record<string, string | number> {
  if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) {
    throw new InvalidArgumentError(key, undefined, 'Arguments must be an object.');
  }
  const values: Record<string, string | number> = Object.create(null);
  for (const [argument, contract] of Object.entries(schema)) {
    if (args === undefined || !Object.hasOwn(args, argument)) {
      throw new InvalidArgumentError(key, argument, 'Required argument is missing, even when the translation omits it.');
    }
    const value = args[argument];
    if (typeof value === 'string' && contract.acceptedTypes.includes('string')) values[argument] = value;
    else if (typeof value === 'number' && Number.isFinite(value) && contract.acceptedTypes.includes('number')) values[argument] = value;
    else {
      const timestamp = contract.acceptedTypes.includes('date') ? dateValue(value) : undefined;
      if (timestamp === undefined) throw new InvalidArgumentError(key, argument, `Expected ${contract.acceptedTypes.join(' | ')} with a finite number or valid Date.`);
      values[argument] = timestamp;
    }
  }
  return values;
}

/** Pure lookup/formatting stage; no locale setter, store subscription or loading yet. */
export function createTranslator<S extends Schema = Schema>(options: TranslatorOptions): Translator<S> {
  return createBoundTranslator<S>(options);
}

/** Internal hook for an eager store to retain formatter caches across snapshots. */
export function createBoundTranslator<S extends Schema = Schema>(options: TranslatorOptions, sharedFormat?: ReturnType<typeof createTextFormatter>): Translator<S> {
  const locale = Intl.getCanonicalLocales(options.locale)[0];
  if (!locale) throw new RangeError('A translator requires a nonempty locale.');
  // A translator owns its view even when callers retain mutable catalog inputs.
  // Parser-owned immutable catalogs/ASTs are shared; only mutable data is copied.
  const bases = immutableSnapshot(options.baseCatalogs);
  const suppliedTranslations = immutableSnapshot(options.translations ?? []);
  const first = bases[0];
  if (!first) throw new RangeError('A translator requires at least one base catalog.');
  const baseLocale = first.locale;
  const timeZone = new Intl.DateTimeFormat('en', { timeZone: options.timeZone ?? 'UTC' }).resolvedOptions().timeZone;
  const baseCatalogs = new Map<string, ParsedCatalog>();
  const baseSchemas = new Map<string, CatalogSchema>();
  const fallbackLocales = normalizeFallbackLocales(options.fallbackLocales);
  const messageLocales = fallbackLocaleChain(locale, fallbackLocales, baseLocale);
  // The terminal base catalog is already the final lookup. Only its own selected
  // locale historically allowed a same-locale override in `translations`.
  const translationLocales = locale === baseLocale ? messageLocales : messageLocales.slice(0, -1);
  const messageLocaleSet = new Set(translationLocales);
  const translations = new Map<string, Map<string, ParsedCatalog>>();
  for (const catalog of bases) {
    if (catalog.locale !== baseLocale) catalogError(catalog, 'LOCALE_MISMATCH', 'All base catalogs must use the same locale.');
    if (baseCatalogs.has(catalog.namespace)) catalogError(catalog, 'DUPLICATE_CATALOG', 'Duplicate base namespace.');
    baseCatalogs.set(catalog.namespace, catalog);
    baseSchemas.set(catalog.namespace, createBaseSchema(catalog));
  }
  for (const catalog of suppliedTranslations) {
    if (!messageLocaleSet.has(catalog.locale))
      catalogError(catalog, 'LOCALE_MISMATCH', 'Translation catalog locale is outside the fallback chain.');
    let localeCatalogs = translations.get(catalog.locale);
    if (!localeCatalogs) { localeCatalogs = new Map(); translations.set(catalog.locale, localeCatalogs); }
    if (localeCatalogs.has(catalog.namespace)) catalogError(catalog, 'DUPLICATE_CATALOG', 'Duplicate translation namespace.');
    const schema = baseSchemas.get(catalog.namespace);
    if (!schema) catalogError(catalog, 'NAMESPACE_MISMATCH', 'Translation namespace has no loaded base catalog.');
    validateTranslation(schema, catalog);
    localeCatalogs.set(catalog.namespace, catalog);
  }
  const format = sharedFormat ?? createTextFormatter(timeZone);
  const policy = captureErrorPolicy(options);
  const formatFailures = policy?.onFormatError ? new WeakSet<object>() : undefined;
  let formatText: (...args: Parameters<typeof format>) => ReturnType<typeof format> = format;
  let formatParts: typeof format.parts = format.parts;
  if (formatFailures) {
    const markFailure = (error: unknown) => {
      if (!(error instanceof InvalidRichTextError) && error !== null &&
          (typeof error === 'object' || typeof error === 'function')) formatFailures.add(error);
    };
    formatText = (namespace, id, message, formatLocale, values) => {
      try { return format(namespace, id, message, formatLocale, values); }
      catch (error) { markFailure(error); throw error; }
    };
    formatParts = (namespace, id, message, formatLocale, values) => {
      try { return format.parts(namespace, id, message, formatLocale, values); }
      catch (error) { markFailure(error); throw error; }
    };
  }
  const strictRender = (key: string, args?: Record<string, unknown>, rich = false) => {
    if (typeof key !== 'string') throw new UnknownMessageError(String(key));
    const separator = key.indexOf(':');
    if (separator <= 0 || separator === key.length - 1 || key.indexOf(':', separator + 1) !== -1) throw new UnknownMessageError(key);
    const namespace = key.slice(0, separator);
    const id = key.slice(separator + 1);
    const base = baseCatalogs.get(namespace);
    if (!base) throw new NamespaceNotLoadedError(namespace, key);
    if (!Object.hasOwn(base.messages, id)) throw new UnknownMessageError(key);
    const values = validateArguments(key, baseSchemas.get(namespace)!.keys[id]!, args);
    let source = base;
    for (const messageLocale of translationLocales) {
      const translation = translations.get(messageLocale)?.get(namespace);
      if (translation && Object.hasOwn(translation.messages, id)) { source = translation; break; }
    }
    return rich ? formatParts(namespace, id, source.messages[id]!, source.locale, values)
      : formatText(namespace, id, source.messages[id]!, source.locale, values);
  };
  const render = policy ? (key: string, args?: Record<string, unknown>, rich = false) => {
    try { return strictRender(key, args, rich); }
    catch (error) {
      const surface = rich ? 'parts' : 'text';
      if (error instanceof UnknownMessageError || error instanceof NamespaceNotLoadedError) {
        const fallback = missingKeyFallback(policy, error, error.key, locale, baseLocale, surface);
        if (fallback !== undefined) return fallback;
        throw error;
      }
      const formatterFailure = error instanceof Error && formatFailures?.delete(error) === true;
      if (error instanceof InvalidArgumentError || formatterFailure) {
        const fallback = formatErrorFallback(policy, error,
          error instanceof InvalidArgumentError ? error.key : key, locale, baseLocale, surface);
        if (fallback !== undefined) return fallback;
      }
      throw error;
    }
  } : strictRender;
  const translate = (key: string, args?: Record<string, unknown>) => render(key, args);
  const parts = (key: string, args?: Record<string, unknown>) => render(key, args, true);
  return Object.freeze({ locale, baseLocale, timeZone, t: translate as Translate<S>, tParts: parts as TranslateParts<S> });
}
