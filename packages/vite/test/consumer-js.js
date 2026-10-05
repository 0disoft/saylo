import saylo from '@saylo/vite';
import { connectDev } from '@saylo/vite/client';
import { createStore } from '@saylo/core';
import { initialCatalogs, baseLocale, initialLocale } from 'virtual:saylo';

saylo({ localesDir: './locales', baseLocale: 'ko' });
const store = createStore({ catalogs: initialCatalogs, baseLocale, locale: initialLocale });
const stop = connectDev(store, { onDiagnostic: diagnostic => console.log(diagnostic.diagnostics) });
stop();
