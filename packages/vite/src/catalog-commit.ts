import { CatalogLoadError } from '@0disoft/saylo-core';
import type { CatalogManifest, CatalogOutcome } from '@0disoft/saylo-core';
import { applyCatalogPatch } from './catalog-patch.js';
import { decodeCatalogResult } from './catalog-wire.js';
import { catalogId, catalogMetadata, matches } from './catalog-outcome.js';
import type { CatalogPush } from './types.js';

/** Calculate replacements without changing the cache or freezing transport input. */
export function planPushReplacements(next: CatalogManifest, cache: ReadonlyMap<string, CatalogOutcome>, push?: CatalogPush) {
  const replacements = new Map<string, CatalogOutcome>();
  if (!push) return replacements;
  if (!Array.isArray(push.outcomes)) throw new Error('Invalid catalog push outcomes.');
  for (const wire of push.outcomes) {
    const decoded = decodeCatalogResult(wire);
    if (!decoded || decoded.status === 'failed') throw new Error('Failed catalog push.');
    const key = catalogId(decoded.key), baseline = cache.get(key);
    if (!baseline) continue; // Another source on the shared socket owns this pair.
    if (replacements.has(key)) throw new Error('Duplicate catalog push outcome.');
    const result = decoded.status === 'patch' ? applyCatalogPatch(baseline.status === 'present' ? baseline : undefined, decoded) : decoded;
    if (!matches(next, result)) throw new CatalogLoadError('STALE_CATALOG', 'Pushed catalog does not match its manifest.');
    replacements.set(key, result);
  }
  return replacements;
}

/** Keep one stale present baseline per available pair for request-scoped deltas. */
export function planCacheRemovals(manifest: CatalogManifest, cache: ReadonlyMap<string, CatalogOutcome>, push: boolean): string[] {
  const metadata = catalogMetadata(manifest);
  const namespaces = push ? new Set(manifest.availableNamespaces) : undefined;
  const locales = push ? new Set(manifest.availableLocales) : undefined;
  const removals: string[] = [];
  for (const [key, result] of cache) {
    if (result.sessionId !== manifest.sessionId ||
        (metadata.get(key)?.status !== 'present' && (!push || result.status === 'present')) ||
        (push && (!namespaces!.has(result.key.namespace) || !locales!.has(result.key.locale)))) removals.push(key);
  }
  return removals;
}
