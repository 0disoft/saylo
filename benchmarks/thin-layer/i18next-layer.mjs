import { parseCatalog } from '../../packages/core/dist/index.js';
import { createCatalogLayer } from './catalog-layer.mjs';

// Node-only source adapter. Commit the source cache only after the AST layer accepts it.
export async function createLayer(baseLocale, initialSources, initialLocale) {
  let accepted = new Map();
  let parsedCatalogs = 0;
  let layer;
  async function replace(sources, locale) {
    const candidate = new Map();
    const catalogs = sources.map(({ source, ...options }) => {
      const key = JSON.stringify([options.locale, options.namespace, options.sourceName ?? '<catalog>']);
      const previous = accepted.get(key);
      let catalog = previous?.catalog;
      if (!previous || previous.source !== source) { parsedCatalogs++; catalog = parseCatalog(source, options, catalog); }
      candidate.set(key, { source, catalog });
      return catalog;
    });
    const snapshot = layer ? await layer.replace(catalogs, locale) :
      (layer = await createCatalogLayer(baseLocale, catalogs, locale ?? initialLocale)).getSnapshot();
    accepted = candidate;
    return snapshot;
  }
  await replace(initialSources, initialLocale);
  return { getSnapshot: () => layer.getSnapshot(), replace,
    getProbeStats: () => Object.freeze({ parsedCatalogs, ...layer.getProbeStats() }) };
}
