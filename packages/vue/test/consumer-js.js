import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSayloVue, useVueStore, renderRichText } from '@0disoft/saylo-vue';
import { createApp, h } from 'vue';
const catalog = parseCatalog('{"title":"Title"}', { locale: 'en', namespace: 'demo' });
const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
const pluginBindings = createSayloVue();
createApp({ render: () => null }).use(pluginBindings.createPlugin(store));
// @ts-expect-error plugin requires a Saylo instance
pluginBindings.createPlugin({});
export function setup() {
  const bindings = createSayloVue();
  bindings.provideI18n(store);
  const state = bindings.useI18n();
  const title = state.value.t('demo:title');
  renderRichText(state.value.tParts('demo:title'), { strong: children => h('strong', children) });
  // @ts-expect-error renderer must return Vue children
  renderRichText([], { strong: () => ({ arbitrary: true }) });
  const direct = useVueStore(store);
  direct.value.setLocale('en');
  // @ts-expect-error locale requires a string
  direct.value.setLocale(3);
  // @ts-expect-error read-only snapshot
  state.value.locale = 'ko';
  return title;
}
