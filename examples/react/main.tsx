import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { connectDev } from '@0disoft/saylo-vite/client';
import type { LiveDiagnostic } from '@0disoft/saylo-vite/client';
import type { ParsedCatalog } from '@0disoft/saylo-core';
import { catalogSource, initialCatalogs } from 'virtual:saylo/lazy';
import { SayloProvider, store, useI18n } from './i18n';
import '../vanilla/style.css';

function CatalogPanel() {
  const [catalogs, setCatalogs] = useState<readonly ParsedCatalog[]>(initialCatalogs.flatMap(o => o.status === 'present' ? [o.catalog] : []));
  const [diagnostic, setDiagnostic] = useState<LiveDiagnostic>({ message: '', diagnostics: [] });
  useEffect(() => connectDev(store, { catalogSource, onUpdate: setCatalogs, onDiagnostic: setDiagnostic }), []);
  const source = (locale: string) => {
    const catalog = catalogs.find(c => c.locale === locale && c.namespace === 'demo');
    return catalog ? JSON.stringify(Object.fromEntries(Object.entries(catalog.messages).map(([key, message]) => [key, message.source])), null, 2) : '아직 로드하지 않았습니다.';
  };
  const details = diagnostic.diagnostics.length
    ? diagnostic.diagnostics.map(d => `${d.sourceName}${d.id ? ` [${d.id}]` : ''}: ${d.message}`).join('\n')
    : diagnostic.message;
  return <section className="panel editor">
    <div className="panel-header"><h2>불러온 파일 문구</h2><span className="badge">JSON</span></div>
    <p className="hint">vanilla 데모와 같은 번역 파일을 사용합니다. <code>examples/vanilla/locales/ko/demo.json</code>을 수정하고 저장하세요.</p>
    <label>기준 문구 · 한국어<textarea className="code" rows={12} spellCheck={false} aria-label="한국어 카탈로그" readOnly value={source('ko')} /></label>
    <label>번역 문구 · English<textarea className="code" rows={12} spellCheck={false} aria-label="영어 카탈로그" readOnly value={source('en')} /></label>
    <p className="hint" role="status">{diagnostic.message ? '갱신 중 오류가 발생했습니다. 아래 진단을 확인하세요.'
      : import.meta.hot ? '파일을 저장하면 React 화면에 자동 반영됩니다.' : '빌드된 카탈로그를 사용합니다.'}</p>
    <pre id="error" role="alert">{details}</pre>
    <p className="footnote">로케일·namespace 파일 추가와 삭제도 반영합니다. 번역 파일 오류는 마지막 정상 상태를 유지합니다.</p>
  </section>;
}

function App() {
  const snapshot = useI18n();
  const { t, locale, setLocale } = snapshot;
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [count, setCount] = useState('2');
  const [confirmation, setConfirmation] = useState('');
  const [open, setOpen] = useState(false);
  const [pendingLocale, setPendingLocale] = useState<string>();
  const [pendingNamespace, setPendingNamespace] = useState<string>();
  const [transitionError, setTransitionError] = useState('');
  const localeGeneration = useRef(0);
  async function selectLocale(value: string) {
    const generation = ++localeGeneration.current;
    setPendingLocale(value);
    setTransitionError('');
    try { await setLocale(value); }
    catch (error) { if (generation === localeGeneration.current) setTransitionError(error instanceof Error ? error.message : String(error)); }
    finally { if (generation === localeGeneration.current) setPendingLocale(undefined); }
  }
  async function loadNamespace(namespace: string) {
    setPendingNamespace(namespace);
    setTransitionError('');
    try { await store.loadNamespace(namespace); }
    catch (error) { setTransitionError(error instanceof Error ? error.message : String(error)); }
    finally { setPendingNamespace(undefined); }
  }
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return <>
    <main>
      <header>
        <a className="brand" href="/">Saylo <span>React demo · StrictMode</span></a>
        <label className="locale-control">화면 언어
          <select id="locale" aria-label="화면 언어" value={pendingLocale ?? locale} onChange={event => { void selectLocale(event.target.value); }}>
            {snapshot.availableLocales.map(value => <option key={value} value={value}>{({ ko: '한국어', en: 'English' } as Record<string, string>)[value] ?? value}</option>)}
          </select>
        </label>
      </header>
      <section className="intro">
        <p className="eyebrow">REACT LIVE CATALOG PREVIEW</p>
        <h1>{t('demo:heading')}</h1>
        <p>{t('demo:description')}</p>
        {pendingLocale && <p role="status">{pendingLocale} 문구를 불러오는 중입니다.</p>}
        <p role="alert" id="transition-error">{transitionError}</p>
      </section>
      <div className="layout">
        <section className="panel preview">
          <div className="panel-header"><h2>{t('demo:formTitle')}</h2><span id="revision" className="badge">revision {snapshot.stateRevision}</span></div>
          <form id="order-form" onSubmit={event => { event.preventDefault(); setOpen(true); }}>
            <label>{t('demo:name')}<input id="name" autoComplete="off" placeholder={t('demo:namePlaceholder')} value={name} onChange={event => setName(event.target.value)} /></label>
            <label>{t('demo:note')}<textarea id="note" rows={4} placeholder={t('demo:notePlaceholder')} value={note} onChange={event => setNote(event.target.value)} /></label>
            <label>{t('demo:count')}<input id="count" type="number" min={0} max={100} value={count} onChange={event => setCount(event.target.value)} /></label>
            <p id="summary" className="summary" aria-live="polite">{t('demo:summary', { count: Number(count) })}</p>
            <button type="submit">{t('demo:openDialog')}</button>
          </form>
          <p className="hint">입력값은 React state로 관리합니다. 번역 파일을 저장해도 입력과 열린 모달이 유지됩니다.</p>
          <p className="hint">사용 가능한 namespace: <span id="namespaces">{snapshot.availableNamespaces.join(', ')}</span></p>
          <p className="hint">불러온 namespace: <span id="loaded-namespaces">{snapshot.loadedNamespaces.join(', ')}</span></p>
          {snapshot.availableNamespaces.filter(namespace => !snapshot.loadedNamespaces.includes(namespace)).map(namespace =>
            <button key={namespace} type="button" disabled={pendingNamespace !== undefined} onClick={() => { void loadNamespace(namespace); }}>
              {pendingNamespace === namespace ? '불러오는 중' : `${namespace} 불러오기`}
            </button>)}
        </section>
        <CatalogPanel />
      </div>
    </main>
    <dialog id="confirmation" ref={dialog} onClose={() => setOpen(false)}>
      <form method="dialog">
        <h2>{t('demo:dialogTitle')}</h2>
        <label>{t('demo:dialogNote')}<input id="confirmation-note" autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        <button>{t('demo:closeDialog')}</button>
        <p className="hint">번역 파일을 저장해도 이 창은 열린 채 유지됩니다.</p>
      </form>
    </dialog>
  </>;
}

const root = createRoot(document.getElementById('root')!);
root.render(<StrictMode><SayloProvider instance={store}><App /></SayloProvider></StrictMode>);
function cleanup() { window.removeEventListener('pagehide', cleanup); root.unmount(); store.dispose(); }
window.addEventListener('pagehide', cleanup, { once: true });
if (import.meta.hot) import.meta.hot.dispose(cleanup);
