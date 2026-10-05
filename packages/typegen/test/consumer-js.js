import { createStore } from '@saylo/core';
import { fixtureCatalog } from './fixture.mjs';
/** @type {import('@saylo/core').Store<import('./generated.js').AppSchema>} */
const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [fixtureCatalog] });
store.t('cart:when', { at: new Date() });
store.t('cart:amount', { count: 3 });
// @ts-expect-error generated required args also work in checkJs
store.t('cart:amount');
// @ts-expect-error generated argument union excludes strings for dates
store.t('cart:when', { at: 'now' });
// @ts-expect-error unknown generated key
store.t('cart:missing');
