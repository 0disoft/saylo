import React, { useLayoutEffect, useRef, useState } from 'react';
import { m } from './paraglide/messages.js';
import { getLocale, setLocale, locales } from './paraglide/runtime.js';
import { controller } from './control.js';

export function Probe() {
  const input = useRef(null);
  const [state, setState] = useState('initial state');
  const text = m.probe(), locale = getLocale();
  useLayoutEffect(() => {
    controller.commit({ text, locale, locales, input: input.current, state,
      switchLocale: target => setLocale(target),
      seed() { input.current.value = 'preserved input'; setState('preserved state'); } });
  });
  return <main><h1>Paraglide locale addition benchmark</h1>
    <select id="locale" value={locale} onChange={event => setLocale(event.target.value)}>
      {locales.map(value => <option key={value} value={value}>{value}</option>)}
    </select><p id="probe">{text}</p><input ref={input} defaultValue="initial input" aria-label="preserved input" /><p>{state}</p></main>;
}
