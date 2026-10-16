import { mount, unmount } from 'svelte';
import App from './App.svelte';
import { store } from './i18n';
import './style.css';

const app = mount(App, { target: document.getElementById('root')! });
let stopped = false;
function stop() {
  if (stopped) return;
  stopped = true;
  window.removeEventListener('pagehide', pagehide);
  void unmount(app).finally(() => store.dispose());
}
function pagehide(event: PageTransitionEvent) { if (!event.persisted) stop(); }
window.addEventListener('pagehide', pagehide);
if (import.meta.hot) import.meta.hot.dispose(stop);
