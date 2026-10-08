import { createI18n } from '@0disoft/saylo-core';
import type { BootSnapshot, CatalogSource } from '@0disoft/saylo-core';
import { createSayloSvelte } from '@0disoft/saylo-svelte';
import type { AppSchema } from './generated';

// Only the typed context key is shared. Every layout creates its own instance.
export const { setSayloContext, getI18n } = createSayloSvelte<AppSchema>();

export function createBootInstance(boot: BootSnapshot) {
  let source: CatalogSource = {
    readManifest: () => boot.manifest,
    loadCatalog: async (locale, namespace) => boot.catalogOutcomes.find(outcome =>
      outcome.key.locale === locale && outcome.key.namespace === namespace)
      ?? { status: 'failed', code: 'SSR_SCOPE', message: 'Catalog is outside the prepared SSR scope.' },
  };
  const proxy: CatalogSource = {
    readManifest: () => source.readManifest(),
    loadCatalog: (locale, namespace, signal) => source.loadCatalog(locale, namespace, signal),
  };
  const instance = createI18n<AppSchema>({ catalogSource: proxy, initialSnapshot: boot });
  return { instance, attachSource: (next: CatalogSource) => { source = next; } };
}
