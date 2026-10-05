import { createStore } from '@saylo/core';
import { createSayloReact } from '@saylo/react';
import { initialCatalogs, baseLocale, initialLocale, timeZone } from 'virtual:saylo';

import type { AppSchema } from './generated';
export type { AppSchema } from './generated';

export const store = createStore<AppSchema>({ baseLocale, locale: initialLocale, catalogs: initialCatalogs, timeZone });
export const { SayloProvider, useI18n } = createSayloReact<AppSchema>();
