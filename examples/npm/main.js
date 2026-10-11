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
let connectionMessage = import.meta.hot ? 'Connecting to development server' : 'Production catalogs';
let reconnecting = false;

function renderStatus(message) {
  status.textContent = message;
  dialogStatus.textContent = message;
}

function refreshStatus() {
  const message = diagnosticMessage || renderMessage;
  renderStatus(message
    ? `${connectionMessage}\n${message}\nFix the reported issue and save again. The last rendered translations remain visible.`
    : connectionMessage);
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
const onSocketDisconnect = () => {
  reconnecting = true;
  connectionMessage = 'Disconnected. Waiting for the development server; last rendered translations remain visible.';
  refreshStatus();
};
const onSocketConnect = () => {
  if (!reconnecting) return;
  reconnecting = false;
  connectionMessage = 'Reconnecting. Waiting for the current catalogs.';
  refreshStatus();
};
if (import.meta.hot) {
  // Observe the shared Vite socket without closing or replacing it.
  import.meta.hot.on('vite:ws:disconnect', onSocketDisconnect);
  import.meta.hot.on('vite:ws:connect', onSocketConnect);
}
const disconnect = import.meta.hot ? connectDev(store, {
  hot: import.meta.hot,
  onDiagnostic: diagnostic => {
    diagnosticMessage = diagnostic.message || '';
    refreshStatus();
  },
  onUpdate: () => { connectionMessage = 'Connected'; refreshStatus(); },
}) : () => {};
refreshStatus();
listen(localeSelect, 'change', () => store.setLocale(localeSelect.value));
listen(nameInput, 'input', () => render(store.getSnapshot()));
listen(document.getElementById('open-dialog'), 'click', () => dialog.showModal());
listen(document.getElementById('close-dialog'), 'click', () => dialog.close());

function cleanup() {
  if (import.meta.hot) {
    import.meta.hot.off('vite:ws:disconnect', onSocketDisconnect);
    import.meta.hot.off('vite:ws:connect', onSocketConnect);
  }
  disconnect(); controls.abort(); unsubscribe(); store.dispose();
}
listen(window, 'pagehide', event => { if (!event.persisted) cleanup(); });
if (import.meta.hot) import.meta.hot.dispose(cleanup);
