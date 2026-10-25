import { SSR_STABILITY_MAX_ATTEMPTS } from './loading-policy.js';
import { createBootSnapshot } from './boot.js';
import { CatalogLoader } from './catalog-loader.js';
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
  const timeoutMs = timeoutDuration(options.requestTimeoutMs);
  const maxCachedCatalogs = catalogCacheLimit(options.maxCachedCatalogs);
  const policy = captureErrorPolicy(options);
  const fallbackLocales = normalizeFallbackLocales(options.fallbackLocales);
  if (options.signal?.aborted) throw aborted(options.signal);
  const locale = canonicalLocale(options.locale);
  const timeZone = new Intl.DateTimeFormat('en', { timeZone: options.timeZone ?? 'UTC' }).resolvedOptions().timeZone;
  for (let attempt = 0; attempt < SSR_STABILITY_MAX_ATTEMPTS; attempt++) {
    const manifest = readManifest(options.catalogSource.readManifest());
    if (!manifestMembership(manifest).locales.has(locale) || new Set(options.initialNamespaces).size !== options.initialNamespaces.length ||
        options.initialNamespaces.some(n => !manifestMembership(manifest).namespaces.has(n))) throw new RangeError('SSR scope is outside the manifest.');
    const unavailableFallback = fallbackLocales.find(value => !manifestMembership(manifest).locales.has(value));
    if (unavailableFallback) throw new RangeError(`SSR fallback locale is outside the manifest: ${unavailableFallback}`);
    const initialKeys = scopeKeys(manifest, locale, [...options.initialNamespaces].sort(), fallbackLocales);
    const protectedKeys = new Set(initialKeys.map(keyId));
    const cacheOptions = maxCachedCatalogs === undefined
      ? { protectedKeys: () => protectedKeys }
      : { maxCachedCatalogs, protectedKeys: () => protectedKeys };
    const loader = new CatalogLoader(options.catalogSource, () => manifest, timeoutMs, options.schedule,
      cacheOptions);
    const abort = () => loader.stop(aborted(options.signal!));
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      if (options.signal?.aborted) throw aborted(options.signal);
      const outcomes = await Promise.all(initialKeys.map(key => loader.load(key)));
      if (options.signal?.aborted) throw aborted(options.signal);
      const initialSnapshot = createBootSnapshot({ manifest, locale, timeZone, loadedNamespaces: options.initialNamespaces,
        fallbackLocales, stateRevision: 0, catalogOutcomes: outcomes });
      return createI18n<S>({ catalogSource: options.catalogSource, initialSnapshot, requestTimeoutMs: timeoutMs,
        ...(maxCachedCatalogs === undefined ? {} : { maxCachedCatalogs }),
        ...(options.schedule ? { schedule: options.schedule } : {}), ...(options.signal ? { signal: options.signal } : {}),
        fallbackLocales, ...(policy ?? {}) });
    } catch (error) {
      if (!(error instanceof CatalogLoadError) || error.code !== 'STALE_CATALOG' || attempt === SSR_STABILITY_MAX_ATTEMPTS - 1) throw error;
    } finally { options.signal?.removeEventListener('abort', abort); loader.stop(new CatalogLoadError('DISPOSED', 'SSR preparation finished.')); }
  }
  throw new CatalogLoadError('STALE_CATALOG', 'SSR catalogs did not stabilize.');
}
