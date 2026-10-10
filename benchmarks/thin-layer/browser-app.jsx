import React, { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { baseLocale, initialCatalogs, initialLocale } from 'virtual:saylo';
import { createCatalogLayer } from './catalog-layer.mjs';

// Test-only eager transport bridge: not the product loader/session implementation.
const layer = await createCatalogLayer(baseLocale, initialCatalogs, initialLocale);
const listeners = new Set();
let catalogs = initialCatalogs;
let queue = Promise.resolve();
let resolveConnected;
const connected = new Promise(resolve => { resolveConnected = resolve; });
let revision = -1;
let active, inputNode, dialogNode;
let diagnosticCount = 0;
const old = layer.getSnapshot();
async function request(route, data) {
  const response = await fetch(`/__thin/${route}`, data === undefined ? {} : { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
const fail = error => { void request('fail', { message: String(error) }).catch(() => {}); };
function publish(next, locale) {
  queue = queue.then(async () => {
    await layer.replace(next, locale);
    catalogs = next;
    for (const listener of listeners) listener();
    void request('trace', { kind: 'commit', revision, locale: layer.getSnapshot().locale,
      text: layer.getSnapshot().t('demo:greeting', { name: 'Ada' }) }).catch(fail);
  });
  queue.catch(fail);
  return queue;
}
import.meta.hot.on('saylo:eager-snapshot', frame => {
  if (frame.revision <= revision) return;
  revision = frame.revision;
  void publish(frame.catalogs).then(() => resolveConnected()).catch(fail);
});
import.meta.hot.on('saylo:eager-diagnostic', diagnostic => {
  if (diagnostic?.message) { diagnosticCount++; void request('trace', { kind: 'diagnostic', message: diagnostic.message }).catch(fail); check(); }
});
import.meta.hot.send('saylo:request-eager-snapshot', {
  scope: 'eager', requestId: 'thin-layer-browser', generation: 1, locale: initialLocale, namespaces: ['demo'],
});
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
function check() {
  if (!active || !active.armed || active.acknowledging) return;
  const snapshot = layer.getSnapshot();
  const text = document.getElementById('greeting').textContent;
  if (text !== active.expected || snapshot.locale !== active.locale ||
      JSON.stringify(snapshot.availableLocales) !== JSON.stringify(active.locales) ||
      diagnosticCount < active.minDiagnostics) return;
  const preserved = inputNode === document.querySelector('input') && inputNode.value === 'typed draft' &&
    document.activeElement === inputNode && dialogNode === document.querySelector('dialog') && dialogNode.open &&
    document.getElementById('counter').textContent === '8';
  if (!preserved) { fail('Input/focus/modal/component state was lost.'); return; }
  active.acknowledging = true;
  const sample = active;
  void request('ack', { id: sample.id, text, locale: snapshot.locale, locales: snapshot.availableLocales,
    oldSnapshotText: old.t('demo:greeting', { name: 'Ada' }), diagnosticCount, preserved,
    fallbackPlural: snapshot.t('demo:rows', { count: 0 }) }).then(() => {
    active = undefined; sample.resolve();
  }).catch(fail);
}
async function control() {
  await connected;
  await request('ready', { userAgent: navigator.userAgent, react: React.version });
  while (true) {
    const command = await request('command');
    if (command.kind === 'done') return;
    let resolve;
    const done = new Promise(yes => { resolve = yes; });
    active = { ...command, resolve, armed: false, acknowledging: false };
    await request('armed', { id: command.id });
    active.armed = true;
    if (command.select) await publish(catalogs, command.select);
    check();
    await done;
  }
}
function Probe() {
  const snapshot = useSyncExternalStore(subscribe, layer.getSnapshot);
  const [count, setCount] = useState(7);
  const booted = useRef(false);
  const started = useRef(false);
  useLayoutEffect(() => {
    if (!booted.current) {
      booted.current = true;
      document.getElementById('increment').click();
      inputNode = document.querySelector('input'); dialogNode = document.querySelector('dialog');
      inputNode.value = 'typed draft';
      inputNode.dispatchEvent(new Event('input', { bubbles: true }));
      dialogNode.showModal(); inputNode.focus();
    }
    if (count === 8 && !started.current) { started.current = true; void control().catch(fail); }
    check();
  });
  return <main><p id="greeting">{snapshot.t('demo:greeting', { name: 'Ada' })}</p>
    <p id="counter">{count}</p><button id="increment" onClick={() => setCount(value => value + 1)}>Increment</button>
    <dialog><input defaultValue="initial draft" aria-label="draft" /></dialog></main>;
}
const root = createRoot(document.getElementById('root'));
root.render(<Probe />);
window.addEventListener('error', event => fail(event.message));
window.addEventListener('unhandledrejection', event => fail(event.reason));
window.addEventListener('pagehide', () => root.unmount(), { once: true });
