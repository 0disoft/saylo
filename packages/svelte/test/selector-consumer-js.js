import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSayloSvelte, createSvelteStore, selectSvelteStore } from '@0disoft/saylo-svelte';

/** @typedef {{ 'cart:title': {}, 'cart:items': { count: number } }} AppSchema */
const catalog = parseCatalog('{"title":"Cart","items":"{count, number}"}', { locale: 'en', namespace: 'cart' });
/** @type {import('@0disoft/saylo-core').Store<AppSchema>} */
const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
/** @type {import('@0disoft/saylo-svelte').SayloSvelteBindings<AppSchema>} */
const bindings = createSayloSvelte();
const source = createSvelteStore(store);
/** @type {import('svelte/store').Readable<string>} */
const title = selectSvelteStore(source, snapshot => snapshot.t('cart:items', { count: 3 }));
void title;
// @ts-expect-error checkJs selection keeps required args
selectSvelteStore(source, snapshot => snapshot.t('cart:items'));
// @ts-expect-error checkJs selection keeps argument types
selectSvelteStore(source, snapshot => snapshot.t('cart:items', { count: '3' }));
// @ts-expect-error checkJs selection rejects unknown keys
selectSvelteStore(source, snapshot => snapshot.t('cart:unknown'));
export function selectFromContext() { return bindings.getI18nSelector(snapshot => snapshot.t('cart:items', { count: 3 })); }
