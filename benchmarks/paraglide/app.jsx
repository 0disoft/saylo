import React, { useLayoutEffect, useRef, useState } from 'react';
import { m } from './paraglide/messages.js';
import { getLocale } from './paraglide/runtime.js';
import { controller } from './control.js';

export function Probe() {
  const input = useRef(null);
  const [state, setState] = useState('initial state');
  const text = m.probe();
  const unchanged = m.message1({ name: 'benchmark' });
  useLayoutEffect(() => {
    controller.commit({ text, locale: getLocale(), input: input.current, state,
      seed() { input.current.value = 'preserved input'; setState('preserved state'); } });
  });
  return <main><h1>Paraglide live update benchmark</h1><p id="probe">{text}</p><p>{unchanged}</p>
    <input ref={input} defaultValue="initial input" aria-label="preserved input" /><p>{state}</p></main>;
}
