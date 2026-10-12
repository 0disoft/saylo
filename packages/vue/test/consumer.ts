import { createStore, parseCatalog } from '@0disoft/saylo-core';
import type { I18n } from '@0disoft/saylo-core';
import { createSayloVue, useVueStore } from '@0disoft/saylo-vue';
type AppSchema = { 'demo:title': {}; 'demo:items': { count: number }; 'demo:code': { code: string } };
const catalog = parseCatalog('{"title":"Title","items":"{count, number}","code":"{code}"}', { locale: 'en', namespace: 'demo' });
const store = createStore<AppSchema>({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
export function setup() {
  const state = useVueStore(store);
  state.value.t('demo:title');
  state.value.t('demo:items', { count: 3 });
  // @ts-expect-error required argument
  state.value.t('demo:items');
  // @ts-expect-error incorrect argument type
  state.value.t('demo:items', { count: '3' });
  // @ts-expect-error unknown key
  state.value.t('demo:missing');
  const key = Math.random() > 0.5 ? 'demo:items' : 'demo:code';
  // @ts-expect-error key and arguments must stay correlated
  state.value.t(key, { count: 3 });
  // @ts-expect-error read-only ref
  state.value = store.getSnapshot();
  // @ts-expect-error immutable snapshot
  state.value.locale = 'ko';
  const transition: void | Promise<void> = state.value.setLocale('en');
  const namespace: Promise<void> | undefined = state.value.loadNamespace?.('demo');
  void transition; void namespace;
  const bindings = createSayloVue<AppSchema>();
  bindings.provideI18n(store); bindings.useI18n().value.t('demo:title');
  const other = createStore<{ 'other:title': {} }>({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
  // @ts-expect-error incompatible schema
  bindings.provideI18n(other);
  return state;
}
declare const lazy: I18n<AppSchema>;
export function lazySetup() { return useVueStore(lazy); }
