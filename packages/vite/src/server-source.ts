import type { CatalogSource } from '@0disoft/saylo-core';

// Node module shared by the plugin and externalized Vite SSR imports. Entries own no request locale state.
const sources = new Map<string, CatalogSource>();

export function registerServerSource(sessionId: string, source: CatalogSource): () => void {
  sources.set(sessionId, source);
  return () => { if (sources.get(sessionId) === source) sources.delete(sessionId); };
}

export function getServerCatalogSource(sessionId: string): CatalogSource {
  const current = () => {
    const source = sources.get(sessionId);
    if (!source) throw new Error('Saylo SSR source is unavailable; the development server may have closed.');
    return source;
  };
  current();
  return Object.freeze({ readManifest: () => current().readManifest(),
    loadCatalog: (locale: string, namespace: string, signal?: AbortSignal) => current().loadCatalog(locale, namespace, signal) });
}
