import { createStore, parseCatalog } from '@0disoft/saylo-core';
import type { I18n } from '@0disoft/saylo-core';
import { createSayloReact } from '@0disoft/saylo-react';

type AppSchema = {
  'cart:title': {};
  'cart:items': { count: number };
  'cart:code': { code: string };
};
const catalog = parseCatalog('{"title":"Cart","items":"{count, number}","code":"{code, select, other {Code}}"}', { locale: 'en', namespace: 'cart' });
const store = createStore<AppSchema>({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
const { SayloProvider, useI18n, useI18nSelector } = createSayloReact<AppSchema>();

function Cart() {
  const countLabel: string = useI18nSelector(snapshot => snapshot.t('cart:items', { count: 3 }));
  const revision: number = useI18nSelector(snapshot => snapshot.stateRevision);
  const switchLocale = useI18nSelector(snapshot => snapshot.setLocale);
  switchLocale('en');
  void countLabel; void revision;
  // @ts-expect-error selector retains required args
  useI18nSelector(snapshot => snapshot.t('cart:items'));
  // @ts-expect-error selector retains argument types
  useI18nSelector(snapshot => snapshot.t('cart:items', { count: '3' }));
  // @ts-expect-error selector rejects unknown keys
  useI18nSelector(snapshot => snapshot.t('cart:unknown'));
  // @ts-expect-error selection return type is inferred
  const wrongSelection: number = useI18nSelector(snapshot => snapshot.locale);
  void wrongSelection;
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

import { createHydrationAdapter } from '@0disoft/saylo-react';
const hydration = createHydrationAdapter(lazy);
export const hydratedApp = <SayloProvider instance={hydration}><Cart /></SayloProvider>;
hydration.getServerSnapshot().t('cart:items', { count: 1 });
hydration.finishHydration();
hydration.dispose();
// @ts-expect-error SSR snapshots retain the required argument contract
hydration.getServerSnapshot().t('cart:items');
