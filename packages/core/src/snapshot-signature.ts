import { isDeepFrozen } from './diagnostics.js';
import type { CatalogManifest } from './loading-types.js';
import type { ParsedCatalog } from './types.js';
import type { PseudoLocaleMode } from './pseudo-locale.js';

const signatures = new WeakMap<ParsedCatalog, string>();

/** Shared eager/lazy fragment cache; caller-owned mutable catalogs are always rescanned. */
export function catalogSignature(catalog: ParsedCatalog): string {
  const cacheable = isDeepFrozen(catalog);
  const cached = cacheable ? signatures.get(catalog) : undefined;
  if (cached !== undefined) return cached;
  const signature = JSON.stringify([catalog.locale, catalog.namespace,
    Object.keys(catalog.messages).sort().map(id => [id, catalog.messages[id]!.source,
      ...(catalog.messages[id]!.richTextTags === undefined ? [] : [catalog.messages[id]!.richTextTags])])]);
  if (cacheable) signatures.set(catalog, signature);
  return signature;
}

/** Preserve the content-based signature while reusing immutable catalog fragments. */
export function createLoadedSignature(manifest: CatalogManifest, locale: string,
  namespaces: readonly string[], catalogs: readonly ParsedCatalog[], pseudoLocale?: PseudoLocaleMode): string {
  const scope = JSON.stringify([locale, manifest.availableLocales, manifest.availableNamespaces, namespaces,
    ...(pseudoLocale ? [pseudoLocale] : [])]);
  return `${scope.slice(0, -1)},[${catalogs.map(catalogSignature).join(',')}]]`;
}
