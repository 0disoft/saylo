import { createElement } from 'react';
import { createStore, parseCatalog } from '@saylo/core';
import { createSayloReact } from '@saylo/react';

/** @typedef {{ 'cart:title': {}, 'cart:items': { count: number } }} AppSchema */
const catalog = parseCatalog('{"title":"Cart","items":"{count, number}"}', { locale: 'en', namespace: 'cart' });
/** @type {import('@saylo/core').Store<AppSchema>} */
const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
/** @type {import('@saylo/react').SayloReactBindings<AppSchema>} */
const bindings = createSayloReact();

function Cart() {
  const { t, setLocale } = bindings.useI18n();
  t('cart:items', { count: 3 });
  // @ts-expect-error checkJs retains required args
  t('cart:items');
  // @ts-expect-error checkJs retains argument types
  t('cart:items', { count: '3' });
  // @ts-expect-error checkJs rejects unknown keys
  t('cart:unknown');
  setLocale('en');
  return createElement('p', null, t('cart:title'));
}
export const app = createElement(bindings.SayloProvider, { instance: store }, createElement(Cart));
/** @param {import('@saylo/core').I18n<AppSchema>} instance */
export function lazyApp(instance) { return createElement(bindings.SayloProvider, { instance }, createElement(Cart)); }

import { createHydrationAdapter } from '@saylo/react';
/** @param {import('@saylo/core').I18n<AppSchema>} instance */
export function hydratedApp(instance) {
  const adapter = createHydrationAdapter(instance);
  adapter.getServerSnapshot().t('cart:items', { count: 1 });
  // @ts-expect-error checkJs keeps the hydration snapshot argument contract
  adapter.getServerSnapshot().t('cart:items');
  return createElement(bindings.SayloProvider, { instance: adapter }, createElement(Cart));
}
