import { createStore, parseCatalog } from '@saylo/core';
import type { I18n } from '@saylo/core';
import { createSayloReact } from '@saylo/react';

type AppSchema = {
  'cart:title': {};
  'cart:items': { count: number };
  'cart:code': { code: string };
};
const catalog = parseCatalog('{"title":"Cart","items":"{count, number}","code":"{code, select, other {Code}}"}', { locale: 'en', namespace: 'cart' });
const store = createStore<AppSchema>({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
const { SayloProvider, useI18n } = createSayloReact<AppSchema>();

function Cart() {
  const snapshot = useI18n();
  snapshot.t('cart:title');
  snapshot.t('cart:items', { count: 3 });
  // @ts-expect-error required count
  snapshot.t('cart:items');
  // @ts-expect-error numeric count
  snapshot.t('cart:items', { count: '3' });
  // @ts-expect-error unknown key
  snapshot.t('cart:missing');
  const key = Math.random() > 0.5 ? 'cart:items' : 'cart:code';
  // @ts-expect-error union key and args are not correlated
  snapshot.t(key, { count: 3 });
  if (key === 'cart:items') snapshot.t(key, { count: 3 }); else snapshot.t(key, { code: 'A' });
  snapshot.setLocale('en');
  const transition: void | Promise<void> = snapshot.setLocale('en');
  void transition;
  const namespace: Promise<void> | undefined = snapshot.loadNamespace?.('cart');
  void namespace;
  // @ts-expect-error immutable snapshot
  snapshot.stateRevision = 3;
  return <p>{snapshot.t('cart:title')}</p>;
}
export const app = <SayloProvider instance={store}><Cart /></SayloProvider>;
declare const lazy: I18n<AppSchema>;
export const lazyApp = <SayloProvider instance={lazy}><Cart /></SayloProvider>;
const other = createStore<{ 'other:title': {} }>({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
// @ts-expect-error provider instance must use this factory's schema
export const wrongApp = <SayloProvider instance={other} />;
