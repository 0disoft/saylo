import { createStore, parseCatalog } from '@0disoft/saylo-core';
import type { I18n } from '@0disoft/saylo-core';
import { createApp, defineComponent, h } from 'vue';
import type { VNodeChild } from 'vue';
import { createSayloVue, useVueStore, useVueSelector, renderRichText } from '@0disoft/saylo-vue';
import type { RichTextRenderers, StrictRichTextRenderers } from '@0disoft/saylo-vue';
import type { AppRichTextSchema } from '../../typegen/test/rich-generated.js';

const strictRenderers = {
  link: children => h('a', { href: '/terms' }, children),
  strong: children => h('strong', children),
} satisfies StrictRichTextRenderers<AppRichTextSchema, 'demo:terms'>;
renderRichText([], strictRenderers);
renderRichText([], {}); // Legacy partial renderer maps remain accepted.
// @ts-expect-error all allowed tags need renderers
const missingRenderer: StrictRichTextRenderers<AppRichTextSchema, 'demo:terms'> = { link: children => children };
const unknownRenderer = { ...strictRenderers,
  // @ts-expect-error misspelled tags are rejected on object literals
  lnik: () => null,
} satisfies StrictRichTextRenderers<AppRichTextSchema, 'demo:terms'>;
const emptyRenderers = {} satisfies StrictRichTextRenderers<AppRichTextSchema, 'demo:empty'>;
const forbiddenRenderer = {
  // @ts-expect-error an empty rich contract permits no renderer names
  link: () => null,
} satisfies StrictRichTextRenderers<AppRichTextSchema, 'demo:empty'>;
// @ts-expect-error messages without explicit rich contracts cannot select strict renderers
type NoContract = StrictRichTextRenderers<AppRichTextSchema, 'demo:literal'>;
void missingRenderer; void unknownRenderer; void emptyRenderers; void forbiddenRenderer;
type AppSchema = { 'demo:title': {}; 'demo:items': { count: number }; 'demo:code': { code: string } };
const catalog = parseCatalog('{"title":"Title","items":"{count, number}","code":"{code}"}', { locale: 'en', namespace: 'demo' });
const store = createStore<AppSchema>({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
const pluginBindings = createSayloVue<AppSchema>();
const app = createApp(defineComponent({ setup: () => () => null }));
app.use(pluginBindings.createPlugin(store));
const wrongSchema = createStore<{ 'other:title': {} }>({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
// @ts-expect-error plugin instance must retain the factory schema
pluginBindings.createPlugin(wrongSchema);
// @ts-expect-error app.use plugin does not accept extra options
app.use(pluginBindings.createPlugin(store), {});
export function setup() {
  const state = useVueStore(store);
  state.value.t('demo:title');
  const renderers: RichTextRenderers = { strong: children => h('strong', children) };
  const nodes: VNodeChild[] = renderRichText(state.value.tParts('demo:title'), renderers);
  renderRichText(state.value.tParts('demo:code', { code: 'A' }));
  // @ts-expect-error renderer must be a function, not an element name
  renderRichText([], { strong: 'strong' });
  // @ts-expect-error rich translation retains required arguments
  state.value.tParts('demo:code');
  void nodes;
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
  const title = bindings.useI18nSelector(snapshot => snapshot.t('demo:title'));
  const titleText: string = title.value;
  // @ts-expect-error selection is readonly
  title.value = 'changed';
  // @ts-expect-error selection retains the schema
  bindings.useI18nSelector(snapshot => snapshot.t('demo:missing'));
  // @ts-expect-error selection retains required arguments
  bindings.useI18nSelector(snapshot => snapshot.tParts('demo:code'));
  const action = useVueSelector(store, snapshot => snapshot.setLocale);
  const selectedTransition: void | Promise<void> = action.value('en');
  void titleText; void selectedTransition;
  const other = createStore<{ 'other:title': {} }>({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
  // @ts-expect-error incompatible schema
  bindings.provideI18n(other);
  return state;
}
declare const lazy: I18n<AppSchema>;
export function lazySetup() {
  const selected = useVueSelector(lazy, snapshot => snapshot.loadNamespace);
  const loading: Promise<void> | undefined = selected.value?.('demo');
  void loading;
  return useVueStore(lazy);
}
