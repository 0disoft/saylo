import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createI18n } from '@saylo/core';
import type { I18n } from '@saylo/core';
import { createSayloReact } from '@saylo/react';
import { connectDev } from '@saylo/vite/client';
import { catalogSource, initialCatalogs, initialLocale, initialNamespaces } from 'virtual:saylo/lazy';
import type { AppSchema } from '../generated.js';

const instance = createI18n<AppSchema>({ catalogSource, initialCatalogs, locale: initialLocale, initialNamespaces });
const bindings = createSayloReact<AppSchema>();
connectDev(instance, { catalogSource });
function View() {
  const { t, setLocale } = bindings.useI18n();
  return createElement('button', { onClick: () => setLocale('en') }, t('demo:greeting', { name: 'Saylo' }));
}
const element = document.getElementById('app');
if (!element) throw new Error('Missing app element.');
createRoot(element).render(createElement(bindings.SayloProvider, { instance }, createElement(View)));

export function checkTypes(typed: I18n<AppSchema>) {
  typed.t('demo:items', { count: 2 });
  // @ts-expect-error required argument
  typed.t('demo:items');
  // @ts-expect-error numeric argument
  typed.t('demo:items', { count: '2' });
  // @ts-expect-error unknown key
  typed.t('demo:missing');
}
