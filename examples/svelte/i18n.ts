import { createI18n } from '@0disoft/saylo-core';
import { createSayloSvelte } from '@0disoft/saylo-svelte';
import { catalogSource, initialCatalogs, initialNamespaces, initialLocale, timeZone } from 'virtual:saylo/lazy';
import type { AppSchema } from './generated';

export const store = createI18n<AppSchema>({ catalogSource, locale: initialLocale, initialNamespaces, initialCatalogs, timeZone });
export const { setSayloContext, getI18n } = createSayloSvelte<AppSchema>();
