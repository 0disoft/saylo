import { createI18n } from '@0disoft/saylo-core';
import { createSayloVue } from '@0disoft/saylo-vue';
import { catalogSource, initialCatalogs, initialNamespaces, initialLocale, timeZone } from 'virtual:saylo/lazy';
import type { AppSchema } from './generated';

export const store = createI18n<AppSchema>({ catalogSource, locale: initialLocale, initialNamespaces, initialCatalogs, timeZone });
export const { createPlugin, useI18n } = createSayloVue<AppSchema>();
