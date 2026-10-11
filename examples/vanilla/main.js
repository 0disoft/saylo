import { createStore } from '@0disoft/saylo-core';
import { connectDev, createSupportRecorder } from '@0disoft/saylo-vite/client';
import { initialCatalogs, baseLocale, initialLocale, timeZone } from 'virtual:saylo';
import { formatDevSyncState } from '../shared/dev-status.js';

const element = id => document.getElementById(id);
const editors = { ko: element('ko-editor'), en: element('en-editor') };
const store = createStore({ baseLocale, locale: initialLocale, catalogs: initialCatalogs, timeZone });
const support = createSupportRecorder(__SAYLO_SUPPORT_ENV__);
const controls = new AbortController();
const on = (target, event, callback) => target.addEventListener(event, callback, { signal: controls.signal });
const textNodes = [...document.querySelectorAll('[data-message]')];
const placeholders = [...document.querySelectorAll('[data-placeholder]')];
const localeSelect = element('locale');
const count = element('count');
const error = element('error');
let localeList = '';
let diagnosticMessage = '';
let handshakeMessage = '';
let renderMessage = '';
let syncState;

function refreshStatus() {
  const details = [diagnosticMessage, handshakeMessage, renderMessage].filter(Boolean).join('\n');
  error.textContent = details;
  const connection = import.meta.hot ? formatDevSyncState(syncState) : '빌드된 카탈로그를 사용합니다.';
  element('status').textContent = connection + (details ? '\n아래 진단을 확인하고 문제를 수정하세요. 마지막 화면은 유지됩니다.' : '');
  element('dialog-status').textContent = connection + (details ? `\n${details}\n문제를 수정하고 다시 저장하세요.` : '');
}

function render(snapshot) {
  try {
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
      localeSelect.replaceChildren(...snapshot.availableLocales.map(locale => {
        const option = new Option({ ko: '한국어', en: 'English' }[locale] ?? locale, locale);
        option.lang = locale;
        return option;
      }));
      localeList = nextList;
    }
    localeSelect.value = snapshot.locale;
  } catch (error) {
    renderMessage = error instanceof Error ? error.message : String(error);
    refreshStatus();
    return;
  }
  if (renderMessage) { renderMessage = ''; refreshStatus(); }
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
  hot: import.meta.hot,
  onUpdate: catalogs => {
    showCatalogs(catalogs);
    refreshStatus();
  },
  onDiagnostic: diagnostic => {
    support.onDiagnostic(diagnostic);
    const details = diagnostic.diagnostics.length
      ? diagnostic.diagnostics.map(d => `${d.sourceName}${d.id ? ` [${d.id}]` : ''}: ${d.message}`).join('\n')
      : diagnostic.message;
    if (diagnostic.operation === 'handshake') handshakeMessage = details;
    else diagnosticMessage = details;
    refreshStatus();
  },
  onSyncState: state => { support.onSyncState(state); syncState = state; if (state.status === 'connected') handshakeMessage = ''; refreshStatus(); },
});
refreshStatus();
on(localeSelect, 'change', () => store.setLocale(localeSelect.value));
on(count, 'input', () => render(store.getSnapshot()));
on(element('support-export'), 'click', () => {
  element('support-report').value = JSON.stringify(support.getReport(), null, 2);
  element('support-status').textContent = '진단 자료를 만들었습니다. 내용을 확인한 뒤 필요한 곳에 직접 복사하세요.';
});
on(element('support-clear'), 'click', () => {
  support.clear();
  if (syncState) support.onSyncState(syncState);
  element('support-report').value = '';
  element('support-status').textContent = '이전 오류 기록과 생성한 자료를 지웠습니다. 현재 연결 상태는 유지합니다.';
});
on(element('order-form'), 'submit', event => {
  event.preventDefault();
  element('confirmation').showModal();
});
function cleanup() { disconnect(); controls.abort(); unsubscribe(); store.dispose(); }
on(window, 'pagehide', event => { if (!event.persisted) cleanup(); });
if (import.meta.hot) import.meta.hot.dispose(cleanup);
