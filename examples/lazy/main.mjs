import assert from 'node:assert/strict';
import { createBaseSchema, createI18n, parseCatalog } from '@0disoft/saylo-core';

// Simulated transport: only the requested pair is returned to the instance.
const catalogs = [
  ['ko', 'common', { title: '환영합니다' }], ['en', 'common', { title: 'Welcome' }],
  ['ko', 'cart', { items: '{count, plural, other {상품 #개}}' }],
].map(([locale, namespace, messages]) => parseCatalog(JSON.stringify(messages), { locale, namespace }));
const fingerprint = namespace => createBaseSchema(catalogs.find(c => c.locale === 'ko' && c.namespace === namespace)).fingerprint;
const outcome = (locale, namespace) => {
  const catalog = catalogs.find(c => c.locale === locale && c.namespace === namespace);
  return { sessionId: 'demo', key: { locale, namespace }, catalogVersion: catalog ? 1 : 0,
    ...(catalog ? { status: 'present', namespaceSchemaFingerprint: fingerprint(namespace), catalog } : { status: 'missing' }) };
};
const source = {
  readManifest: () => ({ sessionId: 'demo', registryRevision: 0, baseLocale: 'ko',
    availableLocales: ['en', 'ko'], availableNamespaces: ['cart', 'common'],
    catalogs: catalogs.map(c => ({ key: { locale: c.locale, namespace: c.namespace }, status: 'present',
      catalogVersion: 1, namespaceSchemaFingerprint: fingerprint(c.namespace) })) }),
  async loadCatalog(locale, namespace, signal) {
    console.log(`load ${locale}/${namespace}`);
    await new Promise(resolve => setTimeout(resolve, locale === 'en' ? 50 : 10));
    if (signal.aborted) return { status: 'failed', code: 'ABORTED', message: 'Load cancelled' };
    return outcome(locale, namespace);
  },
};
const i18n = createI18n({ catalogSource: source, locale: 'ko', initialNamespaces: ['common'], initialCatalogs: [outcome('ko', 'common')] });
const before = i18n.getSnapshot();
let commits = 0;
i18n.subscribe(snapshot => {
  commits++;
  console.log(`commit ${snapshot.locale}: ${snapshot.t('common:title')} / ${snapshot.t('cart:items', { count: 3 })}`);
});
try {
  const locale = i18n.setLocale('en');
  const namespace = i18n.loadNamespace('cart');
  assert.equal(i18n.getSnapshot(), before);
  console.log(`pending: ${i18n.t('common:title')}`);
  await Promise.all([locale, namespace]);
  assert.equal(commits, 1);
  assert.equal(i18n.getSnapshot().locale, 'en');
  assert.equal(i18n.t('cart:items', { count: 3 }), '상품 3개');
  assert.equal(before.t('common:title'), '환영합니다');
  console.log('Both intents completed; missing English cart uses the Korean baseline.');
} finally { i18n.dispose(); }
