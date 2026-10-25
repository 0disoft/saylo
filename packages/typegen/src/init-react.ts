/** An isolated client demo; application entry points, providers and routes remain app-owned. */
export function reactFiles(viteFile: string): Readonly<Record<string, string>> {
  return {
    'src/saylo/react.tsx': `import { useRef, useState } from 'react';
import { createSayloReact } from '@0disoft/saylo-react';
import type { AppSchema } from './generated';

export const { SayloProvider, useI18n, useI18nSelector } = createSayloReact<AppSchema>();

export function SayloDemo() {
  const i18n = useI18n();
  const [name, setName] = useState('Saylo');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  async function selectLocale(locale: string) {
    try { await i18n.setLocale(locale); }
    catch (cause) { setError(String(cause)); return; }
    const url = new URL(location.href);
    url.searchParams.set('locale', locale);
    history.replaceState(null, '', url);
    try { localStorage.setItem('SAYLO_LOCALE', locale); setError(''); }
    catch { setError('Locale changed; browser storage is unavailable.'); }
  }
  return <section lang={i18n.locale}>
    <label>Language <select id="saylo-locale" value={i18n.locale} onChange={event => { void selectLocale(event.currentTarget.value); }}>
      {i18n.availableLocales.map(locale => <option key={locale} value={locale}>{locale}</option>)}
    </select></label>
    <label>Name <input id="saylo-name" value={name} onChange={event => setName(event.currentTarget.value)} /></label>
    <h1 id="saylo-greeting">{i18n.t('saylo:greeting', { name })}</h1>
    <button type="button" onClick={() => dialog.current?.showModal()}>Open dialog</button>
    <dialog ref={dialog}><p>{i18n.t('saylo:greeting', { name })}</p>
      <button type="button" onClick={() => dialog.current?.close()}>Close</button></dialog>
    {error && <p role="status">{error}</p>}
  </section>;
}
`,
    'src/saylo/demo.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { resolveLocale } from '@0disoft/saylo-core';
import { createAppI18n } from './i18n';
import { SayloDemo, SayloProvider } from './react';

const element = document.getElementById('saylo-demo');
if (!element) throw new Error('Missing Saylo demo root.');
const app = createAppI18n();
let saved = '';
try { saved = localStorage.getItem('SAYLO_LOCALE') ?? ''; } catch { /* Browser persistence is optional. */ }
const snapshot = app.store.getSnapshot();
app.store.setLocale(resolveLocale([new URL(location.href).searchParams.get('locale') ?? '', saved, navigator.language],
  snapshot.availableLocales, snapshot.locale));
const root = createRoot(element);
root.render(<StrictMode><SayloProvider instance={app.store}><SayloDemo /></SayloProvider></StrictMode>);
let active = true;
function stop() {
  if (!active) return;
  active = false;
  removeEventListener('pagehide', leaving);
  try { root.unmount(); } finally { app.dispose(); }
}
function leaving(event: PageTransitionEvent) { if (!event.persisted) stop(); }
addEventListener('pagehide', leaving);
if (import.meta.hot) import.meta.hot.dispose(stop);
`,
    'saylo.html': `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Saylo React demo</title></head><body><div id="saylo-demo"></div>
<script type="module" src="/src/saylo/demo.tsx"></script></body></html>
`,
    'saylo.demo.config.mjs': `import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import app from ${JSON.stringify('./' + viteFile)};

export default mergeConfig(app, { build: { outDir: 'dist-saylo-demo',
  rolldownOptions: { input: fileURLToPath(new URL('./saylo.html', import.meta.url)) } } });
`,
  };
}
