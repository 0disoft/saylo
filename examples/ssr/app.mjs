import { createElement as h, useEffect, useState } from 'react';
import { createSayloReact } from '@0disoft/saylo-react';

export const { SayloProvider, useI18n } = createSayloReact();

export function App({ onHydrated }) {
  const { t, locale, availableLocales, setLocale } = useI18n();
  const [count, setCount] = useState(2);
  const [error, setError] = useState('');
  useEffect(() => { onHydrated?.(); }, [onHydrated]);
  return h('main', null,
    h('p', null, 'Saylo · SSR + hydration'),
    h('select', { 'aria-label': 'locale', value: locale, onChange: event => {
      void Promise.resolve(setLocale(event.target.value)).catch(reason => setError(String(reason)));
    } }, availableLocales.map(value => h('option', { key: value, value }, value))),
    h('h1', null, t('demo:heading')),
    h('p', null, t('demo:description')),
    h('label', null, t('demo:name'), h('input', { id: 'name', defaultValue: '', placeholder: t('demo:namePlaceholder') })),
    h('button', { onClick: () => setCount(value => value + 1) }, t('demo:summary', { count })),
    h('p', { role: 'alert' }, error));
}
