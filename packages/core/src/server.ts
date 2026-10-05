import { createBootSnapshot } from './boot.js';
import { CatalogLoader } from './catalog-loader.js';
import { createI18n } from './i18n.js';
import { CatalogLoadError } from './loading-errors.js';
import { canonicalLocale, readManifest, scopeKeys } from './loading-registry.js';
import type { CatalogSource, I18n } from './loading-types.js';
import type { Schema } from './types.js';

export interface ServerI18nOptions {
  readonly catalogSource: CatalogSource;
  readonly locale: string;
  readonly initialNamespaces: readonly string[];
  readonly timeZone?: string;
  readonly requestTimeoutMs?: number;
}

/** Load a request's complete scope before creating its fixed render/hydration snapshot. */
export async function createServerI18n<S extends Schema = Schema>(options: ServerI18nOptions): Promise<I18n<S>> {
  const timeoutMs = options.requestTimeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new RangeError('Invalid requestTimeoutMs.');
  const locale = canonicalLocale(options.locale);
  const timeZone = new Intl.DateTimeFormat('en', { timeZone: options.timeZone ?? 'UTC' }).resolvedOptions().timeZone;
  for (let attempt = 0; attempt < 3; attempt++) {
    const manifest = readManifest(options.catalogSource.readManifest());
    if (!manifest.availableLocales.includes(locale) || new Set(options.initialNamespaces).size !== options.initialNamespaces.length ||
        options.initialNamespaces.some(n => !manifest.availableNamespaces.includes(n))) throw new RangeError('SSR scope is outside the manifest.');
    const loader = new CatalogLoader(options.catalogSource, () => manifest, Math.ceil(timeoutMs));
    try {
      const outcomes = await Promise.all(scopeKeys(manifest, locale, [...options.initialNamespaces].sort()).map(key => loader.load(key)));
      const initialSnapshot = createBootSnapshot({ manifest, locale, timeZone, loadedNamespaces: options.initialNamespaces,
        stateRevision: 0, catalogOutcomes: outcomes });
      return createI18n<S>({ catalogSource: options.catalogSource, initialSnapshot, requestTimeoutMs: timeoutMs });
    } catch (error) {
      if (!(error instanceof CatalogLoadError) || error.code !== 'STALE_CATALOG' || attempt === 2) throw error;
    } finally { loader.stop(new CatalogLoadError('DISPOSED', 'SSR preparation finished.')); }
  }
  throw new CatalogLoadError('STALE_CATALOG', 'SSR catalogs did not stabilize.');
}
