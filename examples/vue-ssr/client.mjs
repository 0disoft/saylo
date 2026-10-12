import { createI18n, decodeBootSnapshot } from '@0disoft/saylo-core';
import { connectDev } from '@0disoft/saylo-vite/client';
import { catalogSource } from 'virtual:saylo/lazy';
import { createApp, observeInstance } from './app.mjs';

export function hydrate() {
  const initialSnapshot = decodeBootSnapshot(document.getElementById('saylo-boot').textContent);
  const client = createI18n({ catalogSource, initialSnapshot });
  const observed = observeInstance(client);
  const app = createApp(observed.instance);
  let disconnect, stopped = false;
  let connected = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    window.removeEventListener('pagehide', pagehide);
    try { disconnect?.(); } finally {
      connected = false;
      try { app.unmount(); } finally { client.dispose(); }
    }
  }
  function pagehide(event) { if (!event.persisted) stop(); }
  try {
    // Finish the synchronous hydration using only the server's frozen snapshot.
    app.mount('#root');
    disconnect = connectDev(client, { catalogSource, hot: import.meta.hot,
      onSyncState: state => { connected = state.status === 'connected'; } });
    window.addEventListener('pagehide', pagehide);
  } catch (error) { stop(); throw error; }
  if (import.meta.hot) import.meta.hot.dispose(stop);
  return { stop, stats: () => ({ ...observed.stats(), connected, stopped }),
    initialLocale: initialSnapshot.locale };
}
