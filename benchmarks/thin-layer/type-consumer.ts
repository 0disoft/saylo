import { createI18n } from '@0disoft/saylo-core/runtime';
import type { I18n, StoreSnapshot } from '@0disoft/saylo-core/runtime';
import { connectDev } from '@0disoft/saylo-vite/client';
import type { DevCatalogSource } from '@0disoft/saylo-vite/client';
import type { SayloInstance as ReactInstance } from '@0disoft/saylo-react';
import type { SayloInstance as SvelteInstance } from '@0disoft/saylo-svelte';
import { createLazyLayer, createLazyLayerSync } from '../lazy-layer.mjs';
import type { LazyLayer } from '../lazy-layer.mjs';
import type { AppSchema } from './generated.js';

declare const source: DevCatalogSource;
const options = { catalogSource: source, locale: 'ja', initialNamespaces: [], initialCatalogs: [] };
const pending: Promise<LazyLayer<AppSchema>> = createLazyLayer<AppSchema>(options);
const layer = await pending;
const core = createI18n<AppSchema>(options);
const sync: LazyLayer<AppSchema> = createLazyLayerSync<AppSchema>(options);
sync.t('demo:rows', { count: 2 });
connectDev(sync, { catalogSource: source });
// @ts-expect-error sync construction is not a Promise
const syncPromise: Promise<LazyLayer<AppSchema>> = createLazyLayerSync<AppSchema>(options);
// @ts-expect-error the sync translator retains generated argument types
sync.t('demo:rows');
const structural: I18n<AppSchema> = layer;
const react: ReactInstance<AppSchema> = layer;
const svelte: SvelteInstance<AppSchema> = layer;
const stats: number = layer.getProbeStats().instances;
void structural; void react; void svelte; void stats;
connectDev(layer, { catalogSource: source });
// @ts-expect-error the lazy bridge needs its source handle
connectDev(layer);
// @ts-expect-error construction is async
const synchronous: LazyLayer<AppSchema> = createLazyLayer<AppSchema>(options);
// @ts-expect-error seed data and serialized boot are exclusive
createLazyLayer({ ...options, initialSnapshot: '{}' });
createLazyLayer<AppSchema>({ catalogSource: source, initialSnapshot: layer.getBootSnapshot() });
createLazyLayer<AppSchema>({ catalogSource: source, initialSnapshot: JSON.stringify(layer.getBootSnapshot()) });

for (const instance of [core, layer]) {
  instance.t('demo:plain');
  instance.t('demo:greeting', { name: 'Ada' });
  instance.t('demo:greeting', { name: 1 });
  instance.t('demo:rows', { count: 21 });
  instance.t('demo:when', { at: new Date(0) });
  instance.t('demo:when', { at: 0 });
  instance.t('demo:choice', { mode: 'other', extra: 'unused branch' });
  instance.t('demo:mixed', { count: 3 });
  instance.t('demo:literal.dot');
  instance.t('demo:reserved', { lng: 'customer', ns: 'order' });
  instance.t('demo:__proto__', { constructor: 'literal' });
  instance.t('help:title');
  const snapshot: StoreSnapshot<AppSchema> = instance.getSnapshot();
  snapshot.t('demo:rows', { count: 21 });
  instance.getServerSnapshot().t('demo:plain');
  instance.subscribe(value => {
    value.t('demo:rows', { count: 2 });
    // @ts-expect-error subscription snapshots retain argument types
    value.t('demo:rows');
  });
  const loading: Promise<void> = instance.loadNamespace('demo');
  const selecting: Promise<void> = instance.setLocale('en');
  void loading; void selecting;
  // @ts-expect-error required interpolation
  instance.t('demo:greeting');
  // @ts-expect-error interpolation excludes booleans
  instance.t('demo:greeting', { name: true });
  // @ts-expect-error plural count is numeric
  instance.t('demo:rows', { count: '21' });
  // @ts-expect-error dates exclude strings
  instance.t('demo:when', { at: 'today' });
  // @ts-expect-error all branch arguments remain required
  instance.t('demo:choice', { mode: 'other' });
  // @ts-expect-error mixed numeric use narrows interpolation
  instance.t('demo:mixed', { count: '3' });
  // @ts-expect-error dots remain literal keys
  instance.t('demo:literal');
  // @ts-expect-error unknown key
  instance.t('demo:unknown');
  // @ts-expect-error extra arguments are not in the generated schema
  instance.t('demo:rows', { count: 1, extra: 2 });
  // @ts-expect-error bound snapshot retains required arguments
  snapshot.t('demo:rows');
  // @ts-expect-error SSR snapshot retains required arguments
  instance.getServerSnapshot().t('demo:rows');
  // @ts-expect-error snapshots are immutable
  snapshot.stateRevision = 1;
  // @ts-expect-error namespace names are strings
  instance.loadNamespace(3);
  const key = Math.random() > 0.5 ? 'demo:plain' : 'demo:rows';
  // @ts-expect-error union key requires narrowing before choosing args
  instance.t(key);
  // @ts-expect-error union key and args have no proven correlation
  instance.t(key, { count: 1 });
  if (key === 'demo:rows') instance.t(key, { count: 1 }); else instance.t(key);
}

type IsAny<T> = 0 extends (1 & T) ? true : false;
const checkedReturn: IsAny<Awaited<ReturnType<typeof createLazyLayer<AppSchema>>>> = false;
const checkedTranslate: IsAny<typeof layer.t> = false;
void checkedReturn; void checkedTranslate;
