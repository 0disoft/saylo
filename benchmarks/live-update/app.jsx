import React, { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createI18n } from '@0disoft/saylo-core';
import { createSayloReact } from '@0disoft/saylo-react';
import { connectDev } from '@0disoft/saylo-vite/client';
import { catalogSource, initialCatalogs, initialLocale, initialNamespaces } from 'virtual:saylo/lazy';
import { beginBrowserSample, finishBrowserSample } from 'virtual:saylo-benchmark/browser-profile';

const instance = createI18n({ catalogSource, initialCatalogs, locale: initialLocale, initialNamespaces });
const { SayloProvider, useI18n } = createSayloReact();
let active;
let ready = false;
let inputNode;
const receipts = new Map();
async function request(route, data) {
  const response = await fetch(`/__bench/${route}`, data === undefined ? {} : { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
const fail = error => { void request('fail', { message: String(error) }).catch(() => {}); };
import.meta.hot.on('saylo:catalog', reply => {
  const receivedAt = performance.now();
  const result = reply?.result;
  if (['present', 'compact', 'patch'].includes(result?.status) && result.key.locale === 'en' && result.key.namespace === 'bench') {
    const source = result.status === 'compact' ? result.catalog.messages.find(([id]) => id === 'probe')?.[1] :
      (result.status === 'patch' ? result.upsert.find(([id]) => id === 'probe')?.[1] : result.catalog.messages.probe)?.source;
    if (source !== undefined) receipts.set(source, receivedAt);
  }
});
connectDev(instance, { catalogSource, onDiagnostic: diagnostic => { if (diagnostic.message) fail(diagnostic.message); } });

async function control() {
  await request('ready', { userAgent: navigator.userAgent, react: React.version });
  while (true) {
    const command = await request('command');
    if (command.kind === 'done') return;
    if (command.kind === 'calibrate') { await request('ack', { token: command.token }); continue; }
    let resolve;
    const completed = new Promise(yes => { resolve = yes; });
    active = { ...command, resolve, acknowledging: false };
    beginBrowserSample();
    await request('armed', { token: command.token });
    await completed;
  }
}

function Probe() {
  const snapshot = useI18n();
  const input = useRef(null);
  const [state] = useState('preserved state');
  const text = snapshot.t('bench:probe');
  const unchanged = snapshot.t('bench:message1', { name: 'benchmark' });
  useLayoutEffect(() => {
    if (!ready) { ready = true; inputNode = input.current; void control().catch(fail); }
    if (!active || active.acknowledging || text !== active.expected) return;
    const committedAt = performance.now();
    const receivedAt = receipts.get(text);
    if (!Number.isFinite(receivedAt) || document.getElementById('probe').textContent !== text ||
        input.current !== inputNode || input.current.value !== 'preserved input' || state !== 'preserved state') {
      fail('Missing wire receipt, incorrect DOM, or lost input/component state.'); return;
    }
    active.acknowledging = true;
    const sample = active;
    let browserStages;
    try { browserStages = finishBrowserSample(); } catch (error) { fail(error); return; }
    void request('ack', { token: sample.token, text, browserStages, receiveToCommitMs: committedAt - receivedAt,
      commitToAckDispatchMs: performance.now() - committedAt }).then(() => {
      receipts.delete(text); active = undefined; sample.resolve();
    }).catch(fail);
  }, [snapshot]);
  return <main><h1>Saylo live update benchmark</h1><p id="probe">{text}</p><p>{unchanged}</p>
    <input ref={input} defaultValue="preserved input" aria-label="preserved input" /><p>{state}</p></main>;
}

const root = createRoot(document.getElementById('root'));
root.render(<SayloProvider instance={instance}><Probe /></SayloProvider>);
function cleanup() { root.unmount(); instance.dispose(); }
window.addEventListener('pagehide', cleanup, { once: true });
if (import.meta.hot) import.meta.hot.dispose(cleanup);
