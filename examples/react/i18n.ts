import { createStore } from '@saylo/core';
import { createSayloReact } from '@saylo/react';
import { initialCatalogs, baseLocale, initialLocale, timeZone } from 'virtual:saylo';

type StaticKey = 'demo:heading' | 'demo:description' | 'demo:formTitle' | 'demo:name'
  | 'demo:namePlaceholder' | 'demo:note' | 'demo:notePlaceholder' | 'demo:count'
  | 'demo:openDialog' | 'demo:dialogTitle' | 'demo:dialogNote' | 'demo:closeDialog';
// Handwritten until baseline type generation is implemented.
export type AppSchema = Record<StaticKey, {}> & { 'demo:summary': { count: number } };

export const store = createStore<AppSchema>({ baseLocale, locale: initialLocale, catalogs: initialCatalogs, timeZone });
export const { SayloProvider, useI18n } = createSayloReact<AppSchema>();
