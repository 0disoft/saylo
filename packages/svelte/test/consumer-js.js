import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSayloSvelte, createSvelteStore } from '@0disoft/saylo-svelte';

/** @typedef {{ 'cart:title': {}, 'cart:items': { count: number } }} AppSchema */
const catalog = parseCatalog('{"title":"Cart","items":"{count, number}"}', { locale: 'en', namespace: 'cart' });
/** @type {import('@0disoft/saylo-core').Store<AppSchema>} */
const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
/** @type {import('@0disoft/saylo-svelte').SayloSvelteBindings<AppSchema>} */
const bindings = createSayloSvelte();
createSvelteStore(store).subscribe(({ t, setLocale }) => {
  t('cart:items', { count: 3 });
  // @ts-expect-error checkJs retains required args
  t('cart:items');
  // @ts-expect-error checkJs retains argument types
  t('cart:items', { count: '3' });
  // @ts-expect-error checkJs rejects unknown keys
  t('cart:unknown');
  setLocale('en');
});
export function setup() { return bindings.setSayloContext(store); }
