import saylo, { loadProjectConfig } from '@0disoft/saylo-vite';
import { connectDev, createStaticCatalogSource, createSupportReport, createSupportRecorder } from '@0disoft/saylo-vite/client';
import type { DevSyncState } from '@0disoft/saylo-vite/client';
import { createI18n, createStore } from '@0disoft/saylo-core';
import { catalogSource, initialCatalogs as lazyCatalogs, initialLocale as lazyLocale, initialNamespaces } from 'virtual:saylo/lazy';
import { initialCatalogs, baseLocale, initialLocale, timeZone } from 'virtual:saylo';

saylo({ localesDir: './locales', baseLocale: 'ko', astRuntime: true, requireCompleteTranslations: true, typegen: { outFile: 'generated.d.ts' } });
saylo({ localesDir: './locales', baseLocale: 'ko', includeKeys: ['demo:hello'] as const });
saylo({ localesDir: './locales', baseLocale: 'ko', includeKeys: [] });
saylo({ localesDir: './locales', baseLocale: 'ko', requireReviewedTranslations: true, reviews: 'reviews.json' });
// @ts-expect-error review enforcement is a boolean option
saylo({ localesDir: './locales', baseLocale: 'ko', requireReviewedTranslations: 'true' });
// @ts-expect-error approval paths must be strings
saylo({ localesDir: './locales', baseLocale: 'ko', reviews: true });
saylo(loadProjectConfig('saylo.config.json'));
saylo({ localesDir: './locales', baseLocale: 'ko', includeKeys: { from: ['src'], dynamicKeys: ['demo:hello'] } });
// @ts-expect-error automatic analysis requires source paths
saylo({ localesDir: './locales', baseLocale: 'ko', includeKeys: { dynamicKeys: ['demo:hello'] } });
// @ts-expect-error includeKeys is a list of strings
saylo({ localesDir: './locales', baseLocale: 'ko', includeKeys: 'demo:hello' });
// @ts-expect-error message keys must be strings
saylo({ localesDir: './locales', baseLocale: 'ko', includeKeys: [1] });
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
connectDev(store, { runtime: { createId: () => 'consumer', schedule: (milliseconds, callback) => {
  const timer = setTimeout(callback, milliseconds); return () => clearTimeout(timer);
} } });
stop();
const recorder = createSupportRecorder({ runtime: 'browser', sayloVite: '0.1.0-alpha.4' });
connectDev(store, { onDiagnostic: recorder.onDiagnostic, onSyncState: recorder.onSyncState });
const report = createSupportReport({ environment: { runtime: 'node' } });
// @ts-expect-error support report is immutable
report.events.push({});
// @ts-expect-error arbitrary runtime metadata is not accepted
createSupportReport({ environment: { token: 'hidden' } });
JSON.stringify(recorder.getReport());

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
