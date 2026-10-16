import { createI18n } from '@0disoft/saylo-core';
import { createSayloReact } from '@0disoft/saylo-react';
import { catalogSource, initialCatalogs, initialNamespaces, initialLocale, timeZone } from 'virtual:saylo/lazy';
import type { AppSchema } from './generated';

export const store = createI18n<AppSchema>({ catalogSource, initialCatalogs, initialNamespaces, locale: initialLocale, timeZone });
export const { SayloProvider, useI18n, useI18nSelector } = createSayloReact<AppSchema>();
