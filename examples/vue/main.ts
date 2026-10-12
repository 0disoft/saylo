import { createApp, defineComponent, h } from 'vue';
import App from './App.vue';
import { provideI18n, store } from './i18n';
import '../vanilla/style.css';

const app = createApp(defineComponent({ setup() { provideI18n(store); return () => h(App); } }));
app.mount('#root');
let stopped = false;
function cleanup() {
  if (stopped) return;
  stopped = true;
  window.removeEventListener('pagehide', pagehide);
  try { app.unmount(); } finally { store.dispose(); }
}
function pagehide(event: PageTransitionEvent) { if (!event.persisted) cleanup(); }
window.addEventListener('pagehide', pagehide);
if (import.meta.hot) import.meta.hot.dispose(cleanup);
