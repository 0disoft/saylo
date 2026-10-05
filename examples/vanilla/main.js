import { CatalogError, createStore, parseCatalog } from '@saylo/core';
import ko from './locales/ko.json';
import en from './locales/en.json';

const element = id => document.getElementById(id);
const editors = { ko: element('ko-editor'), en: element('en-editor') };
const initial = { ko, en };
for (const [locale, messages] of Object.entries(initial)) editors[locale].value = JSON.stringify(messages, null, 2);
const readCatalogs = () => Object.entries(editors).map(([locale, editor]) =>
  parseCatalog(editor.value, { locale, namespace: 'demo', sourceName: `${locale}.json` }));
const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: readCatalogs() });
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
  document.documentElement.lang = snapshot.locale;
  const nextList = snapshot.availableLocales.join(',');
  if (nextList !== localeList) {
    localeSelect.replaceChildren(...snapshot.availableLocales.map(locale => new Option({ ko: '한국어', en: 'English' }[locale] ?? locale, locale)));
    localeList = nextList;
  }
  localeSelect.value = snapshot.locale;
}

function apply() {
  try {
    store.replaceCatalogs(readCatalogs());
    error.textContent = '';
    element('status').textContent = '문구를 반영했습니다. 입력한 값은 그대로 유지됩니다.';
  } catch (cause) {
    error.textContent = cause instanceof CatalogError
      ? cause.diagnostics.map(d => `${d.sourceName}${d.id ? ` [${d.id}]` : ''}: ${d.message}`).join('\n')
      : String(cause);
    element('status').textContent = cause instanceof AggregateError
      ? '카탈로그는 반영됐지만 화면 호출이 새 스키마와 맞지 않습니다.'
      : '문구를 반영하지 않았습니다. 마지막 정상 상태를 유지합니다.';
  }
}

const unsubscribe = store.subscribe(render);
render(store.getSnapshot());
on(element('apply'), 'click', apply);
on(localeSelect, 'change', () => store.setLocale(localeSelect.value));
on(count, 'input', () => render(store.getSnapshot()));
on(element('order-form'), 'submit', event => {
  event.preventDefault();
  element('confirmation').showModal();
});
on(element('restore'), 'click', () => {
  for (const [locale, messages] of Object.entries(initial)) editors[locale].value = JSON.stringify(messages, null, 2);
  apply();
});
on(document, 'keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); apply(); }
});
function cleanup() { controls.abort(); unsubscribe(); store.dispose(); }
on(window, 'pagehide', cleanup);
if (import.meta.hot) import.meta.hot.dispose(cleanup);
