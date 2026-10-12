import { createI18n } from '@0disoft/saylo-core';
import { createSayloReact } from '@0disoft/saylo-react';
import { catalogSource, initialCatalogs, initialNamespaces, initialLocale, timeZone } from 'virtual:saylo/lazy';

import type { DemoSchema } from './selected-keys.mjs';
export type { DemoSchema as AppSchema } from './selected-keys.mjs';

export const store = createI18n<DemoSchema>({ catalogSource, locale: initialLocale, initialNamespaces, initialCatalogs, timeZone });
export const { SayloProvider, useI18n } = createSayloReact<DemoSchema>();
