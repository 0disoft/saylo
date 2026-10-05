import saylo from '@saylo/vite';
import { connectDev } from '@saylo/vite/client';
import { createStore } from '@saylo/core';
import { initialCatalogs, baseLocale, initialLocale, timeZone } from 'virtual:saylo';

saylo({ localesDir: './locales', baseLocale: 'ko' });
const store = createStore({ catalogs: initialCatalogs, baseLocale, locale: initialLocale, timeZone });
const stop: () => void = connectDev(store, { onDiagnostic: diagnostic => console.log(diagnostic.message) });
stop();
