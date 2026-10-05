// @ts-check
import { createBaseSchema, createI18n, createStore, createTranslator, parseCatalog, validateTranslation } from '@0disoft/saylo-core';

const parsed = parseCatalog('{"x":"{n, number}"}', { locale: 'ko', namespace: 'cart' });
const base = createBaseSchema(parsed);
validateTranslation(base, parseCatalog('{"x":"Items"}', { locale: 'en', namespace: 'cart' }));
// @ts-expect-error required namespace in typed JS too
parseCatalog('{}', { locale: 'ko' });
// @ts-expect-error immutable in JS too
base.keys.x.n.acceptedTypes.push('string');

/** @typedef {{ 'cart:title': {}, 'cart:items': { count: number } }} AppSchema */
/** @type {import('@0disoft/saylo-core').Translator<AppSchema>} */
const typed = createTranslator({ locale: 'ko', baseCatalogs: [parseCatalog('{"title":"Cart","items":"{count, number}"}', { locale: 'ko', namespace: 'cart' })] });
typed.t('cart:title');
typed.t('cart:items', { count: 3 });
// @ts-expect-error required argument in typed JS
typed.t('cart:items');
// @ts-expect-error wrong number in typed JS
typed.t('cart:items', { count: '3' });
/** @param {'cart:title'|'cart:items'} key */
function unionKey(key) {
  // @ts-expect-error union key must be narrowed
  typed.t(key);
  if (key === 'cart:items') typed.t(key, { count: 3 }); else typed.t(key);
}
void unionKey;

/** @type {import('@0disoft/saylo-core').Store<AppSchema>} */
const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [parseCatalog('{"title":"Cart","items":"{count, number}"}', { locale: 'ko', namespace: 'cart' })] });
store.t('cart:items', { count: 3 });
store.subscribe(snapshot => {
  snapshot.t('cart:title');
  // @ts-expect-error snapshot arg checking in JS
  snapshot.t('cart:items');
});

const lazyCatalog = parseCatalog('{"title":"Cart","items":"{count, number}"}', { locale: 'ko', namespace: 'cart' });
/** @type {import('@0disoft/saylo-core').CatalogOutcome} */
const bootPair = { status: 'present', sessionId: 'one', key: { locale: 'ko', namespace: 'cart' },
  catalogVersion: 1, namespaceSchemaFingerprint: createBaseSchema(lazyCatalog).fingerprint, catalog: lazyCatalog };
/** @type {import('@0disoft/saylo-core').CatalogSource} */
const source = {
  readManifest: () => ({ sessionId: 'one', registryRevision: 0, baseLocale: 'ko',
    availableLocales: ['ko', 'en'], availableNamespaces: ['cart'], catalogs: [bootPair] }),
  loadCatalog: async (locale, namespace) => ({ status: 'missing', sessionId: 'one', key: { locale, namespace }, catalogVersion: 0 }),
};
/** @type {import('@0disoft/saylo-core').I18n<AppSchema>} */
const lazy = createI18n({ catalogSource: source, locale: 'ko', initialNamespaces: ['cart'], initialCatalogs: [bootPair] });
/** @type {Promise<void>} */
const transition = lazy.setLocale('en');
void transition;
lazy.t('cart:title');
lazy.t('cart:items', { count: 3 });
// @ts-expect-error lazy required arg in checkJs
lazy.t('cart:items');
// @ts-expect-error lazy wrong value in checkJs
lazy.getSnapshot().t('cart:items', { count: '3' });
