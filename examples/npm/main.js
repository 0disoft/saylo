import { createStore } from '@0disoft/saylo-core';
import { connectDev } from '@0disoft/saylo-vite/client';
import { initialCatalogs, baseLocale, initialLocale, timeZone } from 'virtual:saylo';

const store = createStore({ catalogs: initialCatalogs, baseLocale, locale: initialLocale, timeZone });
const localeSelect = document.getElementById('locale');
const nameInput = document.getElementById('name');
const dialog = document.getElementById('confirmation');
const status = document.getElementById('status');
const labels = [...document.querySelectorAll('[data-i18n]')];
const controls = new AbortController();
const listen = (element, event, callback) => element.addEventListener(event, callback, { signal: controls.signal });
let localeList = '';

function render(snapshot) {
  // Update text without replacing input controls or the open dialog.
  const translations = labels.map(node => [node, snapshot.t(node.dataset.i18n, { name: nameInput.value || 'Saylo' })]);
  for (const [node, text] of translations) node.textContent = text;
  const nextList = snapshot.availableLocales.join(',');
  if (nextList !== localeList) {
    localeSelect.replaceChildren(...snapshot.availableLocales.map(locale => new Option(locale, locale)));
    localeList = nextList;
  }
  localeSelect.value = snapshot.locale;
  document.documentElement.lang = snapshot.locale;
}

render(store.getSnapshot());
const unsubscribe = store.subscribe(render);
const disconnect = import.meta.hot ? connectDev(store, {
  hot: import.meta.hot,
  onDiagnostic: diagnostic => { status.textContent = diagnostic.message || 'Connected'; },
  onUpdate: () => { status.textContent = 'Connected'; },
}) : () => {};
status.textContent = import.meta.hot ? 'Live catalog updates' : 'Production catalogs';
listen(localeSelect, 'change', () => store.setLocale(localeSelect.value));
listen(nameInput, 'input', () => render(store.getSnapshot()));
listen(document.getElementById('open-dialog'), 'click', () => dialog.showModal());
listen(document.getElementById('close-dialog'), 'click', () => dialog.close());

function cleanup() { disconnect(); controls.abort(); unsubscribe(); store.dispose(); }
listen(window, 'pagehide', cleanup);
if (import.meta.hot) import.meta.hot.dispose(cleanup);
