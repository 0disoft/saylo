import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderRichText } from '@0disoft/saylo-react';
import { connectDev, createSupportRecorder } from '@0disoft/saylo-vite/client';
import type { DevSyncState, LiveDiagnostic } from '@0disoft/saylo-vite/client';
import type { ParsedCatalog } from '@0disoft/saylo-core';
import { catalogSource, initialCatalogs } from 'virtual:saylo/lazy';
import { SayloProvider, store, useI18n } from './i18n';
import '../vanilla/style.css';
import { formatDevSyncState } from '../shared/dev-status';
import { SupportPanel } from './SupportPanel';
import { projectDemoMessages } from './demo-messages';

function CatalogPanel({ catalogs, diagnostic, handshakeMessage, connection, renderError }: {
  catalogs: readonly ParsedCatalog[]; diagnostic: LiveDiagnostic; handshakeMessage: string; connection: string; renderError: string;
}) {
  const source = (locale: string) => {
    const catalog = catalogs.find(c => c.locale === locale && c.namespace === 'demo');
    return catalog ? JSON.stringify(Object.fromEntries(Object.entries(catalog.messages).map(([key, message]) => [key, message.source])), null, 2)
      : locale === 'en' ? 'Not loaded yet.' : '아직 로드하지 않았습니다.';
  };
  const details = diagnostic.diagnostics.length
    ? diagnostic.diagnostics.map(d => `${d.sourceName}${d.id ? ` [${d.id}]` : ''}: ${d.message}`).join('\n')
    : diagnostic.message;
  return <section className="panel editor" lang="ko">
    <div className="panel-header"><h2>불러온 파일 문구</h2><span className="badge">JSON</span></div>
    <p className="hint">vanilla 데모와 같은 번역 파일을 사용합니다. <code>examples/vanilla/locales/ko/demo.json</code>을 수정하고 저장하세요.</p>
    <label>기준 문구 · 한국어<textarea className="code" rows={12} spellCheck={false} aria-label="한국어 카탈로그" readOnly value={source('ko')} /></label>
    <label>번역 문구 · English<textarea className="code" rows={12} spellCheck={false} aria-label="English catalog" lang="en" readOnly value={source('en')} /></label>
    <p id="status" className="hint" role="status">{connection}</p>
    <pre id="error" role="alert">{[details, handshakeMessage].filter(Boolean).join('\n')}</pre>
    <p id="render-error" role="alert" className="hint">{renderError}</p>
    <p className="footnote">로케일·namespace 파일 추가와 삭제도 반영합니다. 번역 파일 오류는 마지막 정상 상태를 유지합니다.</p>
  </section>;
}

function App() {
  const [support] = useState(() => createSupportRecorder(__SAYLO_SUPPORT_ENV__));
  const [catalogs, setCatalogs] = useState<readonly ParsedCatalog[]>(initialCatalogs.flatMap(o => o.status === 'present' ? [o.catalog] : []));
  const [diagnostic, setDiagnostic] = useState<LiveDiagnostic>({ message: '', diagnostics: [] });
  const [handshakeMessage, setHandshakeMessage] = useState('');
  const [syncState, setSyncState] = useState<DevSyncState>();
  useEffect(() => connectDev(store, { catalogSource, onUpdate: setCatalogs,
    onDiagnostic: value => { support.onDiagnostic(value); if (value.operation === 'handshake') setHandshakeMessage(value.message); else setDiagnostic(value); },
    onSyncState: value => { support.onSyncState(value); setSyncState(value); if (value.status === 'connected') setHandshakeMessage(''); }
  }), []);
  const connection = import.meta.hot ? formatDevSyncState(syncState) : '빌드된 카탈로그를 사용합니다.';
  const snapshot = useI18n();
  const { locale, setLocale } = snapshot;
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [count, setCount] = useState('2');
  const lastRendered = useRef<ReturnType<typeof store.getSnapshot> | undefined>(undefined);
  const presentation = useMemo(() => projectDemoMessages(snapshot, lastRendered.current, Number(count), name || 'Saylo'), [snapshot, count, name]);
  const text = presentation.messages;
  useEffect(() => {
    // Only remember a committed render. A concurrent render that is abandoned
    // must not become the fallback shown by the next accepted render.
    if (presentation.accepted) lastRendered.current = presentation.accepted;
  }, [presentation]);
  useEffect(() => {
    if (presentation.error) support.onDiagnostic({ message: presentation.error, diagnostics: [], operation: 'observer' });
  }, [presentation.error, support]);
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
      <header lang="ko">
        <a className="brand" href="/">Saylo <span lang="en">React demo · StrictMode</span></a>
        <label className="locale-control">화면 언어
          <select id="locale" aria-label="화면 언어" value={pendingLocale ?? locale} onChange={event => { void selectLocale(event.target.value); }}>
            {snapshot.availableLocales.map(value => <option key={value} value={value} lang={value}>{({ ko: '한국어', en: 'English' } as Record<string, string>)[value] ?? value}</option>)}
          </select>
        </label>
      </header>
      <section className="intro" lang={presentation.locale}>
        <p className="eyebrow" lang="en">REACT LIVE CATALOG PREVIEW</p>
        <h1>{text.heading}</h1>
        <p>{text.description}</p>
        {pendingLocale && <p role="status" lang="ko">{pendingLocale} 문구를 불러오는 중입니다.</p>}
        <p role="alert" id="transition-error" lang="ko">{transitionError}</p>
      </section>
      <div className="layout">
        <section className="panel preview" lang={presentation.locale}>
          <div className="panel-header"><h2>{text.formTitle}</h2><span id="revision" className="badge" lang="en">revision {snapshot.stateRevision}</span></div>
          <form id="order-form" onSubmit={event => { event.preventDefault(); setOpen(true); }}>
            <label>{text.name}<input id="name" autoComplete="off" placeholder={text.namePlaceholder} value={name} onChange={event => setName(event.target.value)} /></label>
            <label>{text.note}<textarea id="note" rows={4} placeholder={text.notePlaceholder} value={note} onChange={event => setNote(event.target.value)} /></label>
            <label>{text.count}<input id="count" type="number" min={0} max={100} value={count} onChange={event => setCount(event.target.value)} /></label>
            <p id="summary" className="summary" aria-live="polite">{text.summary}</p>
            <p id="rich-preview">{renderRichText(text.rich, {
              strong: children => <strong>{children}</strong>,
              link: children => <a href="#order-form">{children}</a>,
            })}</p>
            <button type="submit">{text.openDialog}</button>
          </form>
          <p className="hint" lang="ko">입력값은 React state로 관리합니다. 번역 파일을 저장해도 입력과 열린 모달이 유지됩니다.</p>
          <p className="hint" lang="ko">사용 가능한 namespace: <span id="namespaces">{snapshot.availableNamespaces.join(', ')}</span></p>
          <p className="hint" lang="ko">불러온 namespace: <span id="loaded-namespaces">{snapshot.loadedNamespaces.join(', ')}</span></p>
          {snapshot.availableNamespaces.filter(namespace => !snapshot.loadedNamespaces.includes(namespace)).map(namespace =>
            <button key={namespace} type="button" lang="ko" disabled={pendingNamespace !== undefined} onClick={() => { void loadNamespace(namespace); }}>
              {pendingNamespace === namespace ? '불러오는 중' : `${namespace} 불러오기`}
            </button>)}
        </section>
        <CatalogPanel catalogs={catalogs} diagnostic={diagnostic} handshakeMessage={handshakeMessage} connection={connection} renderError={presentation.error} />
      </div>
      <SupportPanel recorder={support} syncState={syncState} />
    </main>
    <dialog id="confirmation" ref={dialog} lang={presentation.locale} onClose={() => setOpen(false)} aria-labelledby="dialog-title">
      <form method="dialog">
        <h2 id="dialog-title">{text.dialogTitle}</h2>
        <label>{text.dialogNote}<input id="confirmation-note" autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        <button>{text.closeDialog}</button>
        <p id="dialog-status" className="hint" role="status" lang="ko">{connection}{diagnostic.message && `\n${diagnostic.message}`}{handshakeMessage && `\n${handshakeMessage}`}</p>
        <p id="dialog-render-error" className="hint" role="alert" lang="ko">{presentation.error}</p>
        <p className="hint" lang="ko">번역 파일을 저장해도 이 창은 열린 채 유지됩니다.</p>
      </form>
    </dialog>
  </>;
}

const root = createRoot(document.getElementById('root')!);
root.render(<StrictMode><SayloProvider instance={store}><App /></SayloProvider></StrictMode>);
let stopped = false;
function cleanup() {
  if (stopped) return;
  stopped = true;
  window.removeEventListener('pagehide', pagehide);
  try { root.unmount(); } finally { store.dispose(); }
}
function pagehide(event: PageTransitionEvent) { if (!event.persisted) cleanup(); }
window.addEventListener('pagehide', pagehide);
if (import.meta.hot) import.meta.hot.dispose(cleanup);
