import React, { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { connectDev } from '@0disoft/saylo-vite/client';
import { catalogSource, initialCatalogs, initialLocale, initialNamespaces, timeZone } from 'virtual:saylo/lazy';
import { create } from '__FACTORY__';

// Benchmark-only adapter: both variants consume the actual public dev source
// and bridge. No synthetic manifest, catalog reply or socket event is injected.
const instance = await create({ catalogSource, initialCatalogs, locale: initialLocale, initialNamespaces, timeZone });
const boots = Number(sessionStorage.getItem('lazy-probe-boots') ?? 0) + 1;
sessionStorage.setItem('lazy-probe-boots', String(boots));
const diagnostics = [], errors = [];
let stop, ready = false, input, dialog, retained;
const bind = () => { stop = connectDev(instance, { catalogSource, onDiagnostic: value => {
  if (value.message) diagnostics.push(value.message);
} }); };
bind();
window.addEventListener('error', event => errors.push(String(event.message)));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));

function Probe() {
  const snapshot = useSyncExternalStore(instance.subscribe, instance.getSnapshot);
  const [count, setCount] = useState(7);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      input = document.querySelector('input'); dialog = document.querySelector('dialog');
      if (boots === 1) {
        input.value = 'typed draft'; dialog.showModal(); input.focus(); input.setSelectionRange(2, 7);
        setCount(8);
      }
    }
    ready = boots > 1 || count === 8;
  });
  const loaded = name => snapshot.loadedNamespaces.includes(name);
  return <main><p id="greeting">{loaded('demo') ? snapshot.t('demo:greeting', { name: 'Ada' }) : 'unloaded'}</p>
    <p id="help">{loaded('help') ? snapshot.t('help:title', { name: 'Ada' }) : 'unloaded'}</p>
    <p id="counter">{count}</p><dialog><input defaultValue="initial draft" aria-label="draft" /></dialog></main>;
}
createRoot(document.getElementById('root')).render(<Probe />);
const read = () => {
  const snapshot = instance.getSnapshot();
  return { ready, boots, locale: snapshot.locale, loadedNamespaces: snapshot.loadedNamespaces,
    text: document.getElementById('greeting')?.textContent, help: document.getElementById('help')?.textContent,
    cachedCatalogs: catalogSource.getCatalogs().length, manifestRevision: catalogSource.readManifest().registryRevision,
    retainedText: retained?.t('demo:greeting', { name: 'Ada' }), diagnostics: [...diagnostics], errors: [...errors],
    preserved: input === document.querySelector('input') && input.value === 'typed draft' &&
      document.activeElement === input && input.selectionStart === 2 && input.selectionEnd === 7 &&
      dialog === document.querySelector('dialog') && dialog.open && document.getElementById('counter')?.textContent === '8',
    inputValue: input?.value, counter: document.getElementById('counter')?.textContent, dialogOpen: dialog?.open };
};
window.__lazyProbe = {
  read,
  async action(kind, value) {
    if (kind === 'namespace') await instance.loadNamespace(value);
    else if (kind === 'locale') await instance.setLocale(value);
    else if (kind === 'retain') retained = instance.getSnapshot();
    else if (kind === 'detach') stop();
    else if (kind === 'rebind') bind();
    else throw new Error(`Unknown browser command: ${kind}`);
    return read();
  },
};
window.addEventListener('pagehide', () => instance.dispose(), { once: true });
