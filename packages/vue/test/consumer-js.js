import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSayloVue, useVueStore } from '@0disoft/saylo-vue';
const catalog = parseCatalog('{"title":"Title"}', { locale: 'en', namespace: 'demo' });
const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
export function setup() {
  const bindings = createSayloVue();
  bindings.provideI18n(store);
  const state = bindings.useI18n();
  const title = state.value.t('demo:title');
  const direct = useVueStore(store);
  direct.value.setLocale('en');
  // @ts-expect-error locale requires a string
  direct.value.setLocale(3);
  // @ts-expect-error read-only snapshot
  state.value.locale = 'ko';
  return title;
}
