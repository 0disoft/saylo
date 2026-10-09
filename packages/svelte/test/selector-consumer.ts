import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSayloSvelte, createSvelteStore, selectSvelteStore } from '@0disoft/saylo-svelte';
import type { Readable } from 'svelte/store';

type AppSchema = { 'cart:title': {}; 'cart:items': { count: number } };
const catalog = parseCatalog('{"title":"Cart","items":"{count, number}"}', { locale: 'en', namespace: 'cart' });
const source = createSvelteStore(createStore<AppSchema>({ baseLocale: 'en', locale: 'en', catalogs: [catalog] }));
const bindings = createSayloSvelte<AppSchema>();
const title: Readable<string> = selectSvelteStore(source, snapshot => snapshot.t('cart:items', { count: 3 }));
void title;
// @ts-expect-error selection preserves required args
selectSvelteStore(source, snapshot => snapshot.t('cart:items'));
// @ts-expect-error selection preserves argument types
selectSvelteStore(source, snapshot => snapshot.t('cart:items', { count: '3' }));
// @ts-expect-error selection rejects unknown keys
selectSvelteStore(source, snapshot => snapshot.t('cart:missing'));
// @ts-expect-error selected value type is inferred
const wrong: Readable<number> = selectSvelteStore(source, snapshot => snapshot.locale);
void wrong;
export function selectFromContext(): Readable<string> {
  // @ts-expect-error context selection preserves required args
  bindings.getI18nSelector(snapshot => snapshot.t('cart:items'));
  return bindings.getI18nSelector(snapshot => snapshot.t('cart:items', { count: 3 }));
}
