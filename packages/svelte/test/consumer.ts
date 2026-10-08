import { createStore, parseCatalog } from '@0disoft/saylo-core';
import type { I18n } from '@0disoft/saylo-core';
import { createSayloSvelte, createSvelteStore } from '@0disoft/saylo-svelte';

type AppSchema = { 'cart:title': {}; 'cart:items': { count: number }; 'cart:code': { code: string } };
const catalog = parseCatalog('{"title":"Cart","items":"{count, number}","code":"{code}"}', { locale: 'en', namespace: 'cart' });
const store = createStore<AppSchema>({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
const bindings = createSayloSvelte<AppSchema>();
createSvelteStore(store).subscribe(snapshot => {
  snapshot.t('cart:title');
  snapshot.t('cart:items', { count: 3 });
  // @ts-expect-error required argument
  snapshot.t('cart:items');
  // @ts-expect-error numeric argument
  snapshot.t('cart:items', { count: '3' });
  // @ts-expect-error unknown key
  snapshot.t('cart:missing');
  const key = Math.random() > 0.5 ? 'cart:items' : 'cart:code';
  // @ts-expect-error union keys and args must stay correlated
  snapshot.t(key, { count: 3 });
  const transition: void | Promise<void> = snapshot.setLocale('en');
  const namespace: Promise<void> | undefined = snapshot.loadNamespace?.('cart');
  void transition; void namespace;
  // @ts-expect-error immutable snapshot
  snapshot.stateRevision = 4;
});
export function setup() { return bindings.setSayloContext(store); }
declare const lazy: I18n<AppSchema>;
createSvelteStore(lazy);
const other = createStore<{ 'other:title': {} }>({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
// @ts-expect-error context requires this factory's schema
bindings.setSayloContext(other);
