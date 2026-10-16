import { createRoot } from 'react-dom/client';
import App from './App';
import { SayloProvider, store } from './i18n';
import './style.css';

const root = createRoot(document.getElementById('root')!);
root.render(<SayloProvider instance={store}><App /></SayloProvider>);
let stopped = false;
function stop() {
  if (stopped) return;
  stopped = true;
  window.removeEventListener('pagehide', pagehide);
  try { root.unmount(); } finally { store.dispose(); }
}
function pagehide(event: PageTransitionEvent) { if (!event.persisted) stop(); }
window.addEventListener('pagehide', pagehide);
if (import.meta.hot) import.meta.hot.dispose(stop);
