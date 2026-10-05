import saylo from '@saylo/vite';
import { connectDev } from '@saylo/vite/client';
import { createI18n, createStore } from '@saylo/core';
import { catalogSource, initialCatalogs as lazyCatalogs, initialLocale as lazyLocale, initialNamespaces } from 'virtual:saylo/lazy';
import { initialCatalogs, baseLocale, initialLocale, timeZone } from 'virtual:saylo';

saylo({ localesDir: './locales', baseLocale: 'ko', typegen: { outFile: 'generated.d.ts' } });
const store = createStore({ catalogs: initialCatalogs, baseLocale, locale: initialLocale, timeZone });
const stop: () => void = connectDev(store, { onDiagnostic: diagnostic => console.log(diagnostic.message) });
stop();

const lazy = createI18n({ catalogSource, locale: lazyLocale, initialNamespaces, initialCatalogs: lazyCatalogs });
const disconnect: () => void = connectDev(lazy, { catalogSource });
disconnect();
// @ts-expect-error lazy instances require their source handle
connectDev(lazy);
