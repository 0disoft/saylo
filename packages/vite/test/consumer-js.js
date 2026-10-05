import saylo from '@0disoft/saylo-vite';
import { connectDev, createStaticCatalogSource } from '@0disoft/saylo-vite/client';
import { createI18n, createStore } from '@0disoft/saylo-core';
import { catalogSource, initialCatalogs as lazyCatalogs, initialLocale as lazyLocale, initialNamespaces } from 'virtual:saylo/lazy';
import { initialCatalogs, baseLocale, initialLocale } from 'virtual:saylo';

saylo({ localesDir: './locales', baseLocale: 'ko' });
const store = createStore({ catalogs: initialCatalogs, baseLocale, locale: initialLocale });
const stop = connectDev(store, { onDiagnostic: diagnostic => console.log(diagnostic.diagnostics) });
stop();
const lazy = createI18n({ catalogSource, locale: lazyLocale, initialNamespaces, initialCatalogs: lazyCatalogs });
connectDev(lazy, { catalogSource });
// @ts-expect-error checkJs also requires the lazy source handle
connectDev(lazy);

createStaticCatalogSource(catalogSource.readManifest(), lazyCatalogs, [
  { key: { locale: 'en', namespace: 'demo' }, load: async () => lazyCatalogs[0] },
]);
// @ts-expect-error checkJs also rejects unversioned static outcomes
createStaticCatalogSource(catalogSource.readManifest(), lazyCatalogs, [{ key: { locale: 'en', namespace: 'demo' }, load: async () => ({}) }]);

import { createRequestI18n } from 'virtual:saylo/server';
createRequestI18n({ locale: 'en' }).then(instance => instance.dispose());
// @ts-expect-error checkJs also rejects invalid request locales
createRequestI18n({ locale: 3 });
