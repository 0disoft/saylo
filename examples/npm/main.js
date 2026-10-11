import { createStore } from '@0disoft/saylo-core';
import { connectDev } from '@0disoft/saylo-vite/client';
import { initialCatalogs, baseLocale, initialLocale, timeZone } from 'virtual:saylo';

const store = createStore({ catalogs: initialCatalogs, baseLocale, locale: initialLocale, timeZone });
const localeSelect = document.getElementById('locale');
const nameInput = document.getElementById('name');
const dialog = document.getElementById('confirmation');
const status = document.getElementById('status');
const dialogStatus = document.getElementById('dialog-status');
const labels = [...document.querySelectorAll('[data-i18n]')];
const controls = new AbortController();
const listen = (element, event, callback) => element.addEventListener(event, callback, { signal: controls.signal });
let localeList = '';
let diagnosticMessage = '';
let renderMessage = '';

function renderStatus(message) {
  status.textContent = message;
  dialogStatus.textContent = message;
}

function refreshStatus() {
  const message = diagnosticMessage || renderMessage;
  renderStatus(message
    ? `${message}\nFix the locale file and save again. The last valid translations remain visible.`
    : import.meta.hot ? 'Connected' : 'Production catalogs');
}

function render(snapshot) {
  try {
    // Compute all translations before changing text; keep controls and dialog identity.
    const translations = labels.map(node => [node, snapshot.t(node.dataset.i18n, { name: nameInput.value || 'Saylo' })]);
    for (const [node, text] of translations) node.textContent = text;
    const nextList = snapshot.availableLocales.join(',');
    if (nextList !== localeList) {
      localeSelect.replaceChildren(...snapshot.availableLocales.map(locale => new Option(locale, locale)));
      localeList = nextList;
    }
    localeSelect.value = snapshot.locale;
    document.documentElement.lang = snapshot.locale;
  } catch (error) {
    renderMessage = error instanceof Error ? error.message : String(error);
    refreshStatus();
    return;
  }
  const recovered = Boolean(renderMessage);
  renderMessage = '';
  if (recovered) refreshStatus();
}

render(store.getSnapshot());
const unsubscribe = store.subscribe(render);
renderStatus(import.meta.hot ? 'Live catalog updates' : 'Production catalogs');
const disconnect = import.meta.hot ? connectDev(store, {
  hot: import.meta.hot,
  onDiagnostic: diagnostic => {
    diagnosticMessage = diagnostic.message || '';
    refreshStatus();
  },
  onUpdate: refreshStatus,
}) : () => {};
listen(localeSelect, 'change', () => store.setLocale(localeSelect.value));
listen(nameInput, 'input', () => render(store.getSnapshot()));
listen(document.getElementById('open-dialog'), 'click', () => dialog.showModal());
listen(document.getElementById('close-dialog'), 'click', () => dialog.close());

function cleanup() { disconnect(); controls.abort(); unsubscribe(); store.dispose(); }
listen(window, 'pagehide', event => { if (!event.persisted) cleanup(); });
if (import.meta.hot) import.meta.hot.dispose(cleanup);
