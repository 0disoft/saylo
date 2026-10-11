import saylo from '@0disoft/saylo-vite';
import { connectDev, createStaticCatalogSource } from '@0disoft/saylo-vite/client';
import type { DevSyncState } from '@0disoft/saylo-vite/client';
import { createI18n, createStore } from '@0disoft/saylo-core';
import { catalogSource, initialCatalogs as lazyCatalogs, initialLocale as lazyLocale, initialNamespaces } from 'virtual:saylo/lazy';
import { initialCatalogs, baseLocale, initialLocale, timeZone } from 'virtual:saylo';

saylo({ localesDir: './locales', baseLocale: 'ko', astRuntime: true, requireCompleteTranslations: true, typegen: { outFile: 'generated.d.ts' } });
// @ts-expect-error completeness is a boolean option
saylo({ localesDir: './locales', baseLocale: 'ko', requireCompleteTranslations: 'true' });
const store = createStore({ catalogs: initialCatalogs, baseLocale, locale: initialLocale, timeZone });
const onSyncState = (state: DevSyncState) => {
  const attempts: number = state.attempt;
  const limit: 3 = state.maxAttempts;
  console.log(state.status, attempts, limit);
  // @ts-expect-error synchronization states are immutable observations
  state.attempt = 7;
};
const stop: () => void = connectDev(store, { onDiagnostic: diagnostic => console.log(diagnostic.message), onSyncState });
stop();

const lazy = createI18n({ catalogSource, locale: lazyLocale, initialNamespaces, initialCatalogs: lazyCatalogs });
const disconnect: () => void = connectDev(lazy, { catalogSource, onSyncState });
catalogSource.subscribeSyncState?.(onSyncState);
catalogSource.getSyncState?.();
disconnect();
// @ts-expect-error lazy instances require their source handle
connectDev(lazy);

const staticSource = createStaticCatalogSource(catalogSource.readManifest(), lazyCatalogs, [
  { key: { locale: 'en', namespace: 'demo' }, load: async () => lazyCatalogs[0]! },
]);
staticSource.loadCatalog('en', 'demo');
// @ts-expect-error static loaders must resolve a versioned catalog outcome
createStaticCatalogSource(catalogSource.readManifest(), lazyCatalogs, [{ key: { locale: 'en', namespace: 'demo' }, load: async () => ({}) }]);

import { createRequestI18n } from 'virtual:saylo/server';
const request = createRequestI18n<{ 'demo:hello': { name: string } }>({ locale: 'en' });
request.then(instance => { instance.getServerSnapshot().t('demo:hello', { name: 'SSR' }); instance.dispose(); });
// @ts-expect-error request locale must be a string
createRequestI18n({ locale: 3 });
