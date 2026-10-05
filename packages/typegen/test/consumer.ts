import { createStore } from '@saylo/core';
import type { AppSchema } from './generated.js';
import { fixtureCatalog } from './fixture.mjs';

const store = createStore<AppSchema>({ baseLocale: 'ko', locale: 'ko', catalogs: [fixtureCatalog] });
store.t('cart:plain');
store.t('cart:dotted.key');
store.t('cart:amount', { count: 3 });
store.t('cart:when', { at: new Date() });
store.t('cart:when', { at: 0 });
store.t('cart:greeting', { name: 'A' });
store.t('cart:greeting', { name: 0 });
store.t('cart:choice', { mode: 'other', extra: 'Required in all branches' });
store.t('cart:__proto__', { constructor: 'Literal property' });
// @ts-expect-error required count
store.t('cart:amount');
// @ts-expect-error count is numeric
store.t('cart:amount', { count: '3' });
// @ts-expect-error valid time types are Date or number
store.t('cart:when', { at: 'today' });
// @ts-expect-error even an unused branch argument is required by the baseline
store.t('cart:choice', { mode: 'other' });
// @ts-expect-error mixed interpolation and numeric use narrows to number
store.t('cart:mixed', { count: '3' });
// @ts-expect-error literal dotted key does not become a nested namespace
store.t('cart:dotted');
// @ts-expect-error no unknown key
store.t('cart:unknown');
const key = Math.random() > 0.5 ? 'cart:plain' : 'cart:amount';
// @ts-expect-error union must be narrowed
store.t(key);
if (key === 'cart:plain') store.t(key); else store.t(key, { count: 3 });
