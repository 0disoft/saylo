import React, { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createI18n } from '@0disoft/saylo-core';
import { createSayloReact } from '@0disoft/saylo-react';
import { connectDev } from '@0disoft/saylo-vite/client';
import { catalogSource, initialCatalogs, initialLocale, initialNamespaces } from 'virtual:saylo/lazy';
import { beginBrowserSample, finishBrowserSample } from 'virtual:saylo-benchmark/browser-profile';
import { replyStagesEnabled, captureReplyReceipt, finishReplyReceipt } from 'virtual:saylo-benchmark/reply-profile';
import { clientStagesEnabled, beginClientSample, captureClientPublication, finishClientSample } from 'virtual:saylo-benchmark/client-profile';

let active, inputNode, ready = false;
const onReply = reply => {
  const receivedAt = performance.now();
  captureReplyReceipt(active, reply, receivedAt);
  if (clientStagesEnabled && active?.replyReceipt?.receivedAt === receivedAt) beginClientSample(receivedAt);
};
// Register before the source connects so receipt precedes its synchronous decoding/freezing.
if (replyStagesEnabled) import.meta.hot.on('saylo:catalog', onReply);

const instance = createI18n({ catalogSource, initialCatalogs, locale: initialLocale, initialNamespaces });
// Before React subscribes: timestamp completed snapshot publication, not paint.
const unsubscribePublication = clientStagesEnabled ? instance.subscribe(() => {
  if (active?.phase === 'translation' && instance.getSnapshot().locale === active.locale)
    captureClientPublication(performance.now());
}) : () => {};
const { SayloProvider, useI18n } = createSayloReact();
async function request(route, data) {
  const response = await fetch(`/__bench/${route}`, data === undefined ? {} : { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
const fail = error => { void request('fail', { message: String(error) }).catch(() => {}); };
connectDev(instance, { catalogSource, onDiagnostic: diagnostic => { if (diagnostic.message) fail(diagnostic.message); } });

async function control() {
  await request('ready', { userAgent: navigator.userAgent, react: React.version });
  while (true) {
    const command = await request('command');
    if (command.kind === 'done') return;
    if (command.kind === 'calibrate') { await request('ack', { token: command.token }); continue; }
    if (instance.getSnapshot().locale !== 'en' || instance.getSnapshot().availableLocales.includes(command.locale))
      throw new Error('Locale-add baseline was not reset.');
    let resolve;
    const completed = new Promise(yes => { resolve = yes; });
    active = { ...command, phase: 'listing', resolve };
    await request('armed', { token: command.token });
    await completed;
  }
}

function Probe() {
  const snapshot = useI18n();
  const input = useRef(null);
  const [state, setState] = useState('initial state');
  const text = snapshot.t('bench:probe');
  useLayoutEffect(() => {
    if (!ready) {
      if (state === 'initial state') { input.current.value = 'preserved input'; setState('preserved state'); return; }
      ready = true; inputNode = input.current; void control().catch(fail);
    }
    if (!active) return;
    if (input.current !== inputNode || input.current.value !== 'preserved input' || state !== 'preserved state') {
      fail('Input node, input value or component state was lost.'); return;
    }
    const sample = active;
    const option = [...document.getElementById('locale').options].find(item => item.value === sample.locale);
    if (sample.phase === 'listing' && snapshot.availableLocales.includes(sample.locale)) {
      if (!option || snapshot.locale !== 'en' || text !== 'ready') { fail('Locale list DOM or current translation is incorrect.'); return; }
      sample.phase = 'list-ack';
      void (async () => {
        await request('listed', { token: sample.token });
        await request('selecting', { token: sample.token });
        sample.phase = 'translation'; sample.selectedAt = performance.now();
        beginBrowserSample('locale-add');
        await instance.setLocale(sample.locale);
      })().catch(fail);
    } else if (sample.phase === 'translation' && snapshot.locale === sample.locale && text === sample.expected) {
      const committedAt = performance.now();
      if (!option || document.getElementById('probe').textContent !== sample.expected || document.getElementById('locale').value !== sample.locale) {
        fail('First translation did not reach the DOM.'); return;
      }
      sample.phase = 'translation-ack';
      let browserStages, replyReceipt, clientStages;
      try {
        browserStages = finishBrowserSample(committedAt - sample.selectedAt);
        if (replyStagesEnabled) replyReceipt = finishReplyReceipt(sample, committedAt);
        if (clientStagesEnabled) clientStages = finishClientSample(committedAt);
      } catch (error) { fail(error); return; }
      void (async () => {
        await request('ack', { token: sample.token, text, browserStages, replyReceipt, clientStages, selectToCommitMs: committedAt - sample.selectedAt });
        sample.phase = 'resetting'; await instance.setLocale('en');
        sample.phase = 'removing'; await request('remove', { token: sample.token });
        // A delete commit may arrive before /remove returns; that is handled by the effect.
      })().catch(fail);
    } else if (sample.phase === 'removing' && !snapshot.availableLocales.includes(sample.locale)) {
      if (option || snapshot.locale !== 'en' || text !== 'ready') { fail('Removed locale or baseline translation remains in DOM.'); return; }
      sample.phase = 'removed-ack';
      void request('removed', { token: sample.token }).then(() => { active = undefined; sample.resolve(); }).catch(fail);
    }
  }, [snapshot, state]);
  return <main><h1>Saylo locale addition benchmark</h1>
    <select id="locale" value={snapshot.locale} onChange={event => { void instance.setLocale(event.target.value).catch(fail); }}>
      {snapshot.availableLocales.map(locale => <option key={locale} value={locale}>{locale}</option>)}
    </select><p id="probe">{text}</p><input ref={input} defaultValue="initial input" aria-label="preserved input" /><p>{state}</p></main>;
}

const root = createRoot(document.getElementById('root'));
root.render(<SayloProvider instance={instance}><Probe /></SayloProvider>);
function cleanup() {
  unsubscribePublication();
  if (replyStagesEnabled) import.meta.hot.off('saylo:catalog', onReply);
  root.unmount(); instance.dispose();
}
window.addEventListener('pagehide', cleanup, { once: true });
if (import.meta.hot) import.meta.hot.dispose(cleanup);
