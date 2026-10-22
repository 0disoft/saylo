import { SSR_STABILITY_MAX_ATTEMPTS } from './loading-policy.js';
import { createBootSnapshot } from './boot.js';
import { CatalogLoader } from './catalog-loader.js';
import { createI18n } from './i18n.js';
import { CatalogLoadError } from './loading-errors.js';
import { aborted, timeoutDuration } from './loading-runtime.js';
import { canonicalLocale, manifestMembership, readManifest, scopeKeys } from './loading-registry.js';
import type { CatalogSource, CatalogSchedule, I18n } from './loading-types.js';
import type { Schema } from './types.js';

export interface ServerI18nOptions {
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
  if (options.signal?.aborted) throw aborted(options.signal);
  const locale = canonicalLocale(options.locale);
  const timeZone = new Intl.DateTimeFormat('en', { timeZone: options.timeZone ?? 'UTC' }).resolvedOptions().timeZone;
  for (let attempt = 0; attempt < SSR_STABILITY_MAX_ATTEMPTS; attempt++) {
    const manifest = readManifest(options.catalogSource.readManifest());
    if (!manifestMembership(manifest).locales.has(locale) || new Set(options.initialNamespaces).size !== options.initialNamespaces.length ||
        options.initialNamespaces.some(n => !manifestMembership(manifest).namespaces.has(n))) throw new RangeError('SSR scope is outside the manifest.');
    const loader = new CatalogLoader(options.catalogSource, () => manifest, timeoutMs, options.schedule);
    const abort = () => loader.stop(aborted(options.signal!));
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      if (options.signal?.aborted) throw aborted(options.signal);
      const outcomes = await Promise.all(scopeKeys(manifest, locale, [...options.initialNamespaces].sort()).map(key => loader.load(key)));
      if (options.signal?.aborted) throw aborted(options.signal);
      const initialSnapshot = createBootSnapshot({ manifest, locale, timeZone, loadedNamespaces: options.initialNamespaces,
        stateRevision: 0, catalogOutcomes: outcomes });
      return createI18n<S>({ catalogSource: options.catalogSource, initialSnapshot, requestTimeoutMs: timeoutMs,
        ...(options.schedule ? { schedule: options.schedule } : {}), ...(options.signal ? { signal: options.signal } : {}) });
    } catch (error) {
      if (!(error instanceof CatalogLoadError) || error.code !== 'STALE_CATALOG' || attempt === SSR_STABILITY_MAX_ATTEMPTS - 1) throw error;
    } finally { options.signal?.removeEventListener('abort', abort); loader.stop(new CatalogLoadError('DISPOSED', 'SSR preparation finished.')); }
  }
  throw new CatalogLoadError('STALE_CATALOG', 'SSR catalogs did not stabilize.');
}
