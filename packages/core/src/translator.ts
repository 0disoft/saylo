import { CatalogError } from './diagnostics.js';
import { createTextFormatter } from './formatters.js';
import { createBaseSchema, validateTranslation } from './schema.js';
import { InvalidArgumentError, NamespaceNotLoadedError, UnknownMessageError } from './translation-errors.js';
import type { CatalogSchema, MessageSchema, ParsedCatalog, Schema, Translate, Translator, TranslatorOptions } from './types.js';

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
  const first = options.baseCatalogs[0];
  if (!first) throw new RangeError('A translator requires at least one base catalog.');
  const baseLocale = first.locale;
  const timeZone = new Intl.DateTimeFormat('en', { timeZone: options.timeZone ?? 'UTC' }).resolvedOptions().timeZone;
  const baseCatalogs = new Map<string, ParsedCatalog>();
  const baseSchemas = new Map<string, CatalogSchema>();
  const translations = new Map<string, ParsedCatalog>();
  for (const catalog of options.baseCatalogs) {
    if (catalog.locale !== baseLocale) catalogError(catalog, 'LOCALE_MISMATCH', 'All base catalogs must use the same locale.');
    if (baseCatalogs.has(catalog.namespace)) catalogError(catalog, 'DUPLICATE_CATALOG', 'Duplicate base namespace.');
    baseCatalogs.set(catalog.namespace, catalog);
    baseSchemas.set(catalog.namespace, createBaseSchema(catalog));
  }
  for (const catalog of options.translations ?? []) {
    if (catalog.locale !== locale) catalogError(catalog, 'LOCALE_MISMATCH', 'Translation catalog must use the selected locale.');
    if (translations.has(catalog.namespace)) catalogError(catalog, 'DUPLICATE_CATALOG', 'Duplicate translation namespace.');
    const schema = baseSchemas.get(catalog.namespace);
    if (!schema) catalogError(catalog, 'NAMESPACE_MISMATCH', 'Translation namespace has no loaded base catalog.');
    validateTranslation(schema, catalog);
    translations.set(catalog.namespace, catalog);
  }
  const format = sharedFormat ?? createTextFormatter(timeZone);
  const translate = (key: string, args?: Record<string, unknown>): string => {
    if (typeof key !== 'string') throw new UnknownMessageError(String(key));
    const separator = key.indexOf(':');
    if (separator <= 0 || separator === key.length - 1 || key.indexOf(':', separator + 1) !== -1) throw new UnknownMessageError(key);
    const namespace = key.slice(0, separator);
    const id = key.slice(separator + 1);
    const base = baseCatalogs.get(namespace);
    if (!base) throw new NamespaceNotLoadedError(namespace, key);
    if (!Object.hasOwn(base.messages, id)) throw new UnknownMessageError(key);
    const values = validateArguments(key, baseSchemas.get(namespace)!.keys[id]!, args);
    const translation = translations.get(namespace);
    const source = translation && Object.hasOwn(translation.messages, id) ? translation : base;
    return format(namespace, id, source.messages[id]!, source.locale, values);
  };
  return Object.freeze({ locale, baseLocale, timeZone, t: translate as Translate<S> });
}
