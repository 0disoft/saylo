import { createApp } from 'vue';
import App from './App.vue';
import { createPlugin, store } from './i18n';

const app = createApp(App).use(createPlugin(store));
app.mount('#root');
let stopped = false;
function stop() {
  if (stopped) return;
  stopped = true;
  window.removeEventListener('pagehide', pagehide);
  try { app.unmount(); } finally { store.dispose(); }
}
function pagehide(event: PageTransitionEvent) { if (!event.persisted) stop(); }
window.addEventListener('pagehide', pagehide);
if (import.meta.hot) import.meta.hot.dispose(stop);
