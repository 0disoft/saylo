import { createStore } from '@0disoft/saylo-core';
import { connectDev } from '@0disoft/saylo-vite/client';
import { initialCatalogs, baseLocale, initialLocale, timeZone } from 'virtual:saylo';

const element = id => document.getElementById(id);
const editors = { ko: element('ko-editor'), en: element('en-editor') };
const store = createStore({ baseLocale, locale: initialLocale, catalogs: initialCatalogs, timeZone });
const controls = new AbortController();
const on = (target, event, callback) => target.addEventListener(event, callback, { signal: controls.signal });
const textNodes = [...document.querySelectorAll('[data-message]')];
const placeholders = [...document.querySelectorAll('[data-placeholder]')];
const localeSelect = element('locale');
const count = element('count');
const error = element('error');
let localeList = '';

function render(snapshot) {
  // Compute everything before touching DOM; preserve form controls and dialog identity.
  const text = textNodes.map(node => [node, snapshot.t(node.dataset.message)]);
  const attributes = placeholders.map(node => [node, snapshot.t(node.dataset.placeholder)]);
  const summary = snapshot.t('demo:summary', { count: Number(count.value) });
  for (const [node, value] of text) node.textContent = value;
  for (const [node, value] of attributes) node.placeholder = value;
  element('summary').textContent = summary;
  element('revision').textContent = `revision ${snapshot.stateRevision}`;
  element('namespaces').textContent = snapshot.availableNamespaces.join(', ');
  document.documentElement.lang = snapshot.locale;
  const nextList = snapshot.availableLocales.join(',');
  if (nextList !== localeList) {
    localeSelect.replaceChildren(...snapshot.availableLocales.map(locale => new Option({ ko: '한국어', en: 'English' }[locale] ?? locale, locale)));
    localeList = nextList;
  }
  localeSelect.value = snapshot.locale;
}

function showCatalogs(catalogs) {
  for (const editor of Object.values(editors)) editor.value = '';
  for (const catalog of catalogs) {
    const editor = editors[catalog.locale];
    if (catalog.namespace !== 'demo' || !editor) continue;
    editor.value = JSON.stringify(Object.fromEntries(Object.entries(catalog.messages).map(([key, message]) => [key, message.source])), null, 2);
  }
}

const unsubscribe = store.subscribe(render);
render(store.getSnapshot());
showCatalogs(initialCatalogs);
const disconnect = connectDev(store, {
  onUpdate: catalogs => {
    showCatalogs(catalogs);
    if (!error.textContent) element('status').textContent = '정상 카탈로그가 연결되어 있습니다. 파일을 저장하면 자동 반영됩니다.';
  },
  onDiagnostic: diagnostic => {
    error.textContent = diagnostic.diagnostics.length
      ? diagnostic.diagnostics.map(d => `${d.sourceName}${d.id ? ` [${d.id}]` : ''}: ${d.message}`).join('\n')
      : diagnostic.message;
    element('status').textContent = diagnostic.message
      ? '갱신 중 오류가 발생했습니다. 아래 진단을 확인하세요.'
      : '오류가 해결되어 정상 카탈로그를 사용합니다.';
  },
});
if (!import.meta.hot) element('status').textContent = '빌드된 카탈로그를 사용합니다. 파일 자동 반영은 개발 서버에서 동작합니다.';
on(localeSelect, 'change', () => store.setLocale(localeSelect.value));
on(count, 'input', () => render(store.getSnapshot()));
on(element('order-form'), 'submit', event => {
  event.preventDefault();
  element('confirmation').showModal();
});
function cleanup() { disconnect(); controls.abort(); unsubscribe(); store.dispose(); }
on(window, 'pagehide', cleanup);
if (import.meta.hot) import.meta.hot.dispose(cleanup);
