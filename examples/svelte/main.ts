import { mount, unmount } from 'svelte';
import App from './App.svelte';
import { store } from './i18n';
import '../vanilla/style.css';

const app = mount(App, { target: document.getElementById('root')! });
let stopped = false;
function cleanup() {
  if (stopped) return;
  stopped = true;
  window.removeEventListener('pagehide', cleanup);
  void unmount(app).finally(() => store.dispose());
}
window.addEventListener('pagehide', cleanup, { once: true });
if (import.meta.hot) import.meta.hot.dispose(cleanup);
