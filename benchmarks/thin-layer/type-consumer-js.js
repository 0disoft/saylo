import { createI18n } from '@0disoft/saylo-core/runtime';
import { createLazyLayer, createLazyLayerSync } from '../lazy-layer.mjs';
/** @type {import('@0disoft/saylo-vite/client').DevCatalogSource} */
const source = /** @type {never} */ (undefined);
const options = { catalogSource: source, locale: 'ja', initialNamespaces: [], initialCatalogs: [] };
/** @type {import('../lazy-layer.mjs').LazyLayer<import('./generated.js').AppSchema>} */
const layer = await createLazyLayer(options);
/** @type {import('@0disoft/saylo-core/runtime').I18n<import('./generated.js').AppSchema>} */
const core = createI18n(options);
/** @type {import('../lazy-layer.mjs').LazyLayer<import('./generated.js').AppSchema>} */
const sync = createLazyLayerSync(options);
for (const instance of [core, layer, sync]) {
  instance.t('demo:plain');
  instance.t('demo:greeting', { name: 'Ada' });
  instance.t('demo:rows', { count: 2 });
  instance.t('demo:when', { at: new Date(0) });
  instance.getSnapshot().t('demo:rows', { count: 1 });
  // @ts-expect-error required args in checkJs
  instance.t('demo:rows');
  // @ts-expect-error numeric count in checkJs
  instance.t('demo:rows', { count: '2' });
  // @ts-expect-error date excludes strings in checkJs
  instance.t('demo:when', { at: 'today' });
  // @ts-expect-error unknown generated key in checkJs
  instance.t('demo:unknown');
  // @ts-expect-error branch requirements in checkJs
  instance.t('demo:choice', { mode: 'other' });
}
