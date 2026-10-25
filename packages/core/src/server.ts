import { SSR_STABILITY_MAX_ATTEMPTS } from './loading-policy.js';
import { createBootSnapshot } from './boot.js';
import { CatalogLoader } from './catalog-loader.js';
import { CatalogLoadQueue } from './loading-queue.js';
import { createI18n } from './i18n.js';
import { CatalogLoadError } from './loading-errors.js';
import { aborted, timeoutDuration } from './loading-runtime.js';
import { catalogCacheLimit } from './loading-policy.js';
import { normalizeFallbackLocales } from './locale-chain.js';
import { canonicalLocale, keyId, manifestMembership, readManifest, scopeKeys } from './loading-registry.js';
import { captureErrorPolicy } from './translation-policy.js';
import type { CatalogCacheOptions, CatalogSource, CatalogSchedule, I18n } from './loading-types.js';
import type { LocaleFallbackOptions, Schema, TranslationErrorPolicy } from './types.js';

export interface ServerI18nOptions extends TranslationErrorPolicy, LocaleFallbackOptions, CatalogCacheOptions {
  readonly catalogSource: CatalogSource;
  readonly locale: string;
  readonly initialNamespaces: readonly string[];
  readonly timeZone?: string;
  readonly requestTimeoutMs?: number;
  readonly schedule?: CatalogSchedule;
  readonly signal?: AbortSignal;
}

/** Load a request's complete scope before creating its fixed render/hydration snapshot. */
export async function createServerI18n<S extends Schema = Schema>(options: ServerI18nOptions): Promise<I18n<S>> {
  const { catalogSource, schedule, signal } = options;
  const timeoutMs = timeoutDuration(options.requestTimeoutMs);
  const maxCachedCatalogs = catalogCacheLimit(options.maxCachedCatalogs);
  const policy = captureErrorPolicy(options);
  const fallbackLocales = normalizeFallbackLocales(options.fallbackLocales);
  if (signal?.aborted) throw aborted(signal);
  const locale = canonicalLocale(options.locale);
  const timeZone = new Intl.DateTimeFormat('en', { timeZone: options.timeZone ?? 'UTC' }).resolvedOptions().timeZone;
  // A request owns its scope and dependencies even when the caller reuses or
  // updates the options object while catalog I/O is pending.
  const initialNamespaces = [...options.initialNamespaces];
  // Retry loaders own separate versions/caches, but share the request's physical
  // I/O budget until even sources that ignore cancellation have settled.
  const queue = new CatalogLoadQueue();
  for (let attempt = 0; attempt < SSR_STABILITY_MAX_ATTEMPTS; attempt++) {
    const manifest = readManifest(catalogSource.readManifest());
    if (!manifestMembership(manifest).locales.has(locale) || new Set(initialNamespaces).size !== initialNamespaces.length ||
        initialNamespaces.some(n => !manifestMembership(manifest).namespaces.has(n))) throw new RangeError('SSR scope is outside the manifest.');
    const unavailableFallback = fallbackLocales.find(value => !manifestMembership(manifest).locales.has(value));
    if (unavailableFallback) throw new RangeError(`SSR fallback locale is outside the manifest: ${unavailableFallback}`);
    const initialKeys = scopeKeys(manifest, locale, [...initialNamespaces].sort(), fallbackLocales);
    const protectedKeys = new Set(initialKeys.map(keyId));
    const cacheOptions = maxCachedCatalogs === undefined
      ? { protectedKeys: () => protectedKeys }
      : { maxCachedCatalogs, protectedKeys: () => protectedKeys };
    const loader = new CatalogLoader(catalogSource, () => manifest, timeoutMs, schedule,
      cacheOptions, queue);
    const abort = () => loader.stop(aborted(signal!));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) throw aborted(signal);
      const outcomes = await Promise.all(initialKeys.map(key => loader.load(key)));
      if (signal?.aborted) throw aborted(signal);
      const initialSnapshot = createBootSnapshot({ manifest, locale, timeZone, loadedNamespaces: initialNamespaces,
        fallbackLocales, stateRevision: 0, catalogOutcomes: outcomes });
      return createI18n<S>({ catalogSource, initialSnapshot, requestTimeoutMs: timeoutMs,
        ...(maxCachedCatalogs === undefined ? {} : { maxCachedCatalogs }),
        ...(schedule ? { schedule } : {}), ...(signal ? { signal } : {}),
        fallbackLocales, ...(policy ?? {}) });
    } catch (error) {
      if (!(error instanceof CatalogLoadError) || error.code !== 'STALE_CATALOG' || attempt === SSR_STABILITY_MAX_ATTEMPTS - 1) throw error;
    } finally { signal?.removeEventListener('abort', abort); loader.stop(new CatalogLoadError('DISPOSED', 'SSR preparation finished.')); }
  }
  throw new CatalogLoadError('STALE_CATALOG', 'SSR catalogs did not stabilize.');
}
