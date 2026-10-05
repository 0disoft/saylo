import { createElement as h, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { createI18n, decodeBootSnapshot } from '@0disoft/saylo-core';
import { createHydrationAdapter } from '@0disoft/saylo-react';
import { connectDev } from '@0disoft/saylo-vite/client';
import { catalogSource } from 'virtual:saylo/lazy';
import { App, SayloProvider } from './app.mjs';

const client = createI18n({ catalogSource, initialSnapshot: decodeBootSnapshot(document.getElementById('saylo-boot').textContent) });
const adapter = createHydrationAdapter(client);
connectDev(client, { catalogSource });
const root = hydrateRoot(document.getElementById('root'), h(StrictMode, null,
  h(SayloProvider, { instance: adapter }, h(App, { onHydrated: adapter.finishHydration }))));
function cleanup() { window.removeEventListener('pagehide', cleanup); root.unmount(); adapter.dispose(); client.dispose(); }
window.addEventListener('pagehide', cleanup, { once: true });
if (import.meta.hot) import.meta.hot.dispose(cleanup);
