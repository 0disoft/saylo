import { CatalogError, isDeepFrozen } from './diagnostics.js';
import { nextRevision } from './loading-runtime.js';
import { fallbackLocaleChain, normalizeFallbackLocales } from './locale-chain.js';
import { createTextFormatter } from './formatters.js';
import { createBaseSchema, validateTranslation } from './schema.js';
import { createBoundTranslator } from './translator.js';
import { captureErrorPolicy } from './translation-policy.js';
import { catalogSignature } from './snapshot-signature.js';
import type { ParsedCatalog, Schema, Store, StoreOptions, StoreSnapshot, Translate, TranslateParts } from './types.js';

interface Registry {
  readonly catalogs: readonly ParsedCatalog[];
  readonly locales: readonly string[];
  readonly namespaces: readonly string[];
  readonly immutable: boolean;
}

function canonicalLocale(locale: string): string {
  const canonical = Intl.getCanonicalLocales(locale)[0];
  if (!canonical) throw new RangeError('Locale must not be empty.');
  return canonical;
}

function validateRegistry(catalogs: readonly ParsedCatalog[], baseLocale: string): Registry {
  const bases = catalogs.filter(c => c.locale === baseLocale);
  if (!bases.length) throw new RangeError('The eager registry must retain at least one base catalog.');
  const schemas = new Map(bases.map(c => [c.namespace, createBaseSchema(c)]));
  const seen = new Set<string>();
  for (const catalog of catalogs) {
    const key = JSON.stringify([catalog.locale, catalog.namespace]);
    const context = { sourceName: catalog.sourceName, locale: catalog.locale, namespace: catalog.namespace };
    if (seen.has(key)) throw new CatalogError([{ ...context, code: 'DUPLICATE_CATALOG', message: 'Duplicate locale and namespace in eager registry.' }]);
    seen.add(key);
    const schema = schemas.get(catalog.namespace);
    if (!schema) throw new CatalogError([{ ...context, code: 'NAMESPACE_MISMATCH', message: 'Every translation namespace needs a base catalog.' }]);
    if (catalog.locale !== baseLocale) validateTranslation(schema, catalog);
  }
  return {
    catalogs: Object.freeze([...catalogs]),
    locales: Object.freeze([...new Set(catalogs.map(c => c.locale))].sort()),
    namespaces: Object.freeze([...schemas.keys()].sort()),
    immutable: catalogs.every(isDeepFrozen),
  };
}

function visibleSignature(registry: Registry, baseLocale: string, locale: string,
  fallbackLocales: readonly string[]): string {
  const locales = new Set(fallbackLocaleChain(locale, fallbackLocales, baseLocale));
  const catalogs = registry.catalogs.filter(c => locales.has(c.locale));
  catalogs.sort((a, b) => JSON.stringify([a.locale, a.namespace]).localeCompare(JSON.stringify([b.locale, b.namespace])));
  const scope = JSON.stringify([locale, registry.locales, registry.namespaces]);
  return `${scope.slice(0, -1)},[${catalogs.map(catalogSignature).join(',')}]]`;
}

/** Atomic eager snapshots. Transport, lazy loading and quarantine are later stages. */
export function createStore<S extends Schema = Schema>(options: StoreOptions): Store<S> {
  const baseLocale = canonicalLocale(options.baseLocale);
  const timeZone = new Intl.DateTimeFormat('en', { timeZone: options.timeZone ?? 'UTC' }).resolvedOptions().timeZone;
  const formatter = createTextFormatter(timeZone);
  const policy = captureErrorPolicy(options);
  const fallbackLocales = normalizeFallbackLocales(options.fallbackLocales);
  let registry = validateRegistry(options.catalogs, baseLocale);
  let locale = canonicalLocale(options.locale);
  if (!registry.locales.includes(locale)) throw new RangeError('Initial locale is outside the eager registry.');
  function assertFallbackLocales(next: Registry) {
    const unavailable = fallbackLocales.find(locale => !next.locales.includes(locale));
    if (unavailable) throw new RangeError(`Fallback locale is outside the eager registry: ${unavailable}`);
  }
  assertFallbackLocales(registry);
  let signature = visibleSignature(registry, baseLocale, locale, fallbackLocales);
  function snapshot(registry: Registry, locale: string, stateRevision: number): StoreSnapshot<S> {
    const chain = fallbackLocaleChain(locale, fallbackLocales, baseLocale);
    const translator = createBoundTranslator<S>({ locale, timeZone,
      baseCatalogs: registry.catalogs.filter(c => c.locale === baseLocale),
      translations: registry.catalogs.filter(c => c.locale !== baseLocale && chain.includes(c.locale)),
      fallbackLocales,
      ...(policy ?? {}),
    }, formatter);
    return Object.freeze({ ...translator, stateRevision,
      availableLocales: registry.locales, availableNamespaces: registry.namespaces, loadedNamespaces: registry.namespaces });
  }
  let current = snapshot(registry, locale, 0);
  let planned = current;
  let disposed = false;
  let notifying = false;
  const pending: StoreSnapshot<S>[] = [];
  const listeners = new Set<{ callback: (snapshot: StoreSnapshot<S>) => void }>();
  const disposers = new Set<{ callback: () => void }>();
  function assertActive() { if (disposed) throw new Error('Store is disposed.'); }
  function publish(nextRegistry: Registry, nextLocale: string) {
    const nextSignature = visibleSignature(nextRegistry, baseLocale, nextLocale, fallbackLocales);
    const next = nextSignature === signature ? planned : snapshot(nextRegistry, nextLocale, nextRevision(planned.stateRevision));
    registry = nextRegistry;
    locale = nextLocale;
    signature = nextSignature;
    planned = next;
    pending.push(next);
    if (notifying) return;
    notifying = true;
    const errors: unknown[] = [];
    try {
      while (pending.length && !disposed) {
        const candidate = pending.shift()!;
        if (candidate === current) continue;
        current = candidate;
        for (const listener of [...listeners]) {
          if (!listeners.has(listener)) continue;
          try { listener.callback(current); } catch (error) { errors.push(error); }
        }
      }
    } finally { notifying = false; }
    if (errors.length) throw new AggregateError(errors, 'Subscriber failures after store commit; committed snapshots are retained.');
  }
  return Object.freeze({
    t: ((key: string, args?: Record<string, unknown>) => (current.t as Translate<Schema>)(key, args)) as Translate<S>,
    tParts: ((key: string, args?: Record<string, unknown>) => (current.tParts as TranslateParts<Schema>)(key, args)) as TranslateParts<S>,
    getSnapshot: () => current,
    subscribe: (callback: (snapshot: StoreSnapshot<S>) => void) => {
      assertActive();
      const listener = { callback };
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    onDispose: (callback: () => void) => {
      assertActive();
      const listener = { callback };
      disposers.add(listener);
      return () => { disposers.delete(listener); };
    },
    replaceCatalogs: (catalogs: readonly ParsedCatalog[]) => {
      assertActive();
      const nextRegistry = validateRegistry(catalogs, baseLocale);
      assertFallbackLocales(nextRegistry);
      publish(nextRegistry, nextRegistry.locales.includes(locale) ? locale : baseLocale);
    },
    setLocale: (nextLocale: string) => {
      assertActive();
      const canonical = canonicalLocale(nextLocale);
      if (!registry.locales.includes(canonical)) throw new RangeError('Locale is outside the eager registry.');
      // locale includes queued reentrant selections. Only proven immutable
      // catalogs make an unchanged selection safe without a content scan.
      if (registry.immutable && canonical === locale) return;
      publish(registry, canonical);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      pending.length = 0;
      const errors: unknown[] = [];
      for (const listener of [...disposers]) {
        if (!disposers.has(listener)) continue;
        disposers.delete(listener);
        try { listener.callback(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'Failures during store disposal; all owned cleanup was attempted.');
    },
  });
}
