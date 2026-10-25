import { createI18n, decodeBootSnapshot } from '@0disoft/saylo-core/runtime';
import { catalogSource } from 'virtual:saylo/lazy';
import type { AppSchema } from './generated';

const boot = decodeBootSnapshot(document.querySelector('#saylo-boot')!.textContent!);
const instance = createI18n<AppSchema>({ initialSnapshot: boot, catalogSource, maxCachedCatalogs: 6 });
const name = document.querySelector<HTMLInputElement>('#name')!;
const select = document.querySelector<HTMLSelectElement>('#locale')!;
const loadCart = document.querySelector<HTMLButtonElement>('#load-cart')!;
const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
const report = (cause: unknown) => { document.querySelector('#error')!.textContent = String(cause); };

function render() {
  const snapshot = instance.getSnapshot();
  const heading = snapshot.t('common:hello', { name: name.value });
  document.querySelector('#greeting')!.textContent = heading;
  document.querySelector('#dialog-greeting')!.textContent = heading;
  document.title = heading;
  document.documentElement.lang = snapshot.locale;
  select.value = snapshot.locale;
  if (snapshot.loadedNamespaces.includes('cart'))
    document.querySelector('#cart')!.textContent = snapshot.t('cart:items', { count: 2 });
}
const unsubscribe = instance.subscribe(render);
name.addEventListener('input', render);
select.disabled = loadCart.disabled = false;
select.addEventListener('change', () => { void (async () => {
  select.disabled = true;
  document.querySelector('#error')!.textContent = '';
  try {
    await instance.setLocale(select.value);
    const url = new URL(location.href);
    url.pathname = `/${instance.getSnapshot().locale}/`;
    history.replaceState(history.state, '', url);
  } catch (cause) { report(cause); }
  finally { render(); select.disabled = false; }
})(); });
loadCart.addEventListener('click', () => { void (async () => {
  loadCart.disabled = true;
  try { await instance.loadNamespace('cart'); }
  catch (cause) { report(cause); }
  finally { loadCart.disabled = false; }
})(); });
document.querySelector('#open-dialog')!.addEventListener('click', () => dialog.showModal());
document.querySelector('#close-dialog')!.addEventListener('click', () => dialog.close());
// A persisted back/forward-cache page still owns its instance and event handlers.
window.addEventListener('pagehide', event => { if (!event.persisted) { unsubscribe(); instance.dispose(); } });
