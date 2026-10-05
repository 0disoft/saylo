// @ts-check
import { createBaseSchema, createStore, createTranslator, parseCatalog, validateTranslation } from '@saylo/core';

const parsed = parseCatalog('{"x":"{n, number}"}', { locale: 'ko', namespace: 'cart' });
const base = createBaseSchema(parsed);
validateTranslation(base, parseCatalog('{"x":"Items"}', { locale: 'en', namespace: 'cart' }));
// @ts-expect-error required namespace in typed JS too
parseCatalog('{}', { locale: 'ko' });
// @ts-expect-error immutable in JS too
base.keys.x.n.acceptedTypes.push('string');

/** @typedef {{ 'cart:title': {}, 'cart:items': { count: number } }} AppSchema */
/** @type {import('@saylo/core').Translator<AppSchema>} */
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

/** @type {import('@saylo/core').Store<AppSchema>} */
const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [parseCatalog('{"title":"Cart","items":"{count, number}"}', { locale: 'ko', namespace: 'cart' })] });
store.t('cart:items', { count: 3 });
store.subscribe(snapshot => {
  snapshot.t('cart:title');
  // @ts-expect-error snapshot arg checking in JS
  snapshot.t('cart:items');
});
