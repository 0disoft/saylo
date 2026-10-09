import { createElement } from 'react';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSayloReact } from '@0disoft/saylo-react';

/** @typedef {{ 'cart:title': {}, 'cart:items': { count: number } }} AppSchema */
const catalog = parseCatalog('{"title":"Cart","items":"{count, number}"}', { locale: 'en', namespace: 'cart' });
/** @type {import('@0disoft/saylo-core').Store<AppSchema>} */
const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
/** @type {import('@0disoft/saylo-react').SayloReactBindings<AppSchema>} */
const bindings = createSayloReact();

function Cart() {
  /** @type {string} */
  const title = bindings.useI18nSelector(snapshot => snapshot.t('cart:items', { count: 3 }));
  // @ts-expect-error checkJs selectors retain required args
  bindings.useI18nSelector(snapshot => snapshot.t('cart:items'));
  // @ts-expect-error checkJs selectors retain argument types
  bindings.useI18nSelector(snapshot => snapshot.t('cart:items', { count: '3' }));
  // @ts-expect-error checkJs selectors reject unknown keys
  bindings.useI18nSelector(snapshot => snapshot.t('cart:unknown'));
  void title;
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
/** @param {import('@0disoft/saylo-core').I18n<AppSchema>} instance */
export function lazyApp(instance) { return createElement(bindings.SayloProvider, { instance }, createElement(Cart)); }

import { createHydrationAdapter } from '@0disoft/saylo-react';
/** @param {import('@0disoft/saylo-core').I18n<AppSchema>} instance */
export function hydratedApp(instance) {
  const adapter = createHydrationAdapter(instance);
  adapter.getServerSnapshot().t('cart:items', { count: 1 });
  // @ts-expect-error checkJs keeps the hydration snapshot argument contract
  adapter.getServerSnapshot().t('cart:items');
  return createElement(bindings.SayloProvider, { instance: adapter }, createElement(Cart));
}
