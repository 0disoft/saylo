import { createI18n } from '@saylo/core';
import { createSayloReact } from '@saylo/react';
import { catalogSource, initialCatalogs, initialNamespaces, initialLocale, timeZone } from 'virtual:saylo/lazy';

import type { AppSchema } from './generated';
export type { AppSchema } from './generated';

export const store = createI18n<AppSchema>({ catalogSource, locale: initialLocale, initialNamespaces, initialCatalogs, timeZone });
export const { SayloProvider, useI18n } = createSayloReact<AppSchema>();
