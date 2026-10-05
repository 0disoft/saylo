import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createI18n } from '@0disoft/saylo-core';
import { createSayloReact } from '@0disoft/saylo-react';
import { connectDev } from '@0disoft/saylo-vite/client';
import { catalogSource, initialCatalogs, initialLocale, initialNamespaces } from 'virtual:saylo/lazy';

/** @typedef {import('../generated.js').AppSchema} AppSchema */
/** @type {import('@0disoft/saylo-core').I18n<AppSchema>} */
const instance = createI18n({ catalogSource, initialCatalogs, locale: initialLocale, initialNamespaces });
/** @type {import('@0disoft/saylo-react').SayloReactBindings<AppSchema>} */
const bindings = createSayloReact();
connectDev(instance, { catalogSource });
function View() {
  const { t, setLocale } = bindings.useI18n();
  return createElement('button', { onClick: () => setLocale('en') }, t('demo:greeting', { name: 'Saylo' }));
}
const element = document.getElementById('app');
if (!element) throw new Error('Missing app element.');
createRoot(element).render(createElement(bindings.SayloProvider, { instance }, createElement(View)));

/** @param {import('@0disoft/saylo-core').I18n<AppSchema>} typed */
export function checkTypes(typed) {
  typed.t('demo:items', { count: 2 });
  // @ts-expect-error required argument
  typed.t('demo:items');
  // @ts-expect-error numeric argument
  typed.t('demo:items', { count: '2' });
  // @ts-expect-error unknown key
  typed.t('demo:missing');
}
