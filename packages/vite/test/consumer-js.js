import saylo from '@saylo/vite';
import { connectDev } from '@saylo/vite/client';
import { createI18n, createStore } from '@saylo/core';
import { catalogSource, initialCatalogs as lazyCatalogs, initialLocale as lazyLocale, initialNamespaces } from 'virtual:saylo/lazy';
import { initialCatalogs, baseLocale, initialLocale } from 'virtual:saylo';

saylo({ localesDir: './locales', baseLocale: 'ko' });
const store = createStore({ catalogs: initialCatalogs, baseLocale, locale: initialLocale });
const stop = connectDev(store, { onDiagnostic: diagnostic => console.log(diagnostic.diagnostics) });
stop();
const lazy = createI18n({ catalogSource, locale: lazyLocale, initialNamespaces, initialCatalogs: lazyCatalogs });
connectDev(lazy, { catalogSource });
// @ts-expect-error checkJs also requires the lazy source handle
connectDev(lazy);
