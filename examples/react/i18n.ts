import { createI18n } from '@0disoft/saylo-core';
import type { DevSchemaRecoveryDiagnostic } from '@0disoft/saylo-core';
import { createSayloReact } from '@0disoft/saylo-react';
import { catalogSource, initialCatalogs, initialNamespaces, initialLocale, timeZone } from 'virtual:saylo/lazy';

import type { DemoSchema } from './selected-keys.mjs';
export type { DemoSchema as AppSchema } from './selected-keys.mjs';

const recoveryObservers = new Set<(event: DevSchemaRecoveryDiagnostic) => void>();
export function observeSchemaRecovery(listener: (event: DevSchemaRecoveryDiagnostic) => void) {
  recoveryObservers.add(listener);
  return () => { recoveryObservers.delete(listener); };
}

export const store = createI18n<DemoSchema>({ catalogSource, locale: initialLocale, initialNamespaces, initialCatalogs, timeZone,
  devSchemaRecovery: import.meta.env.DEV ? { onDiagnostic: event => {
    for (const observer of recoveryObservers) observer(event);
  } } : false });
export const { SayloProvider, useI18n } = createSayloReact<DemoSchema>();
