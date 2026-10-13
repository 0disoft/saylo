import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement as h, useState } from 'react';
import { renderToString, renderToStaticMarkup } from 'react-dom/server';
import { parseCatalog, createStore } from '@0disoft/saylo-core';
import { createSayloReact, renderRichText, createHydrationAdapter } from '@0disoft/saylo-react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot, hydrateRoot } = await import('react-dom/client');
after(() => dom.window.close());
const catalog = (value, locale = 'en') => parseCatalog(JSON.stringify({ message: value }), { locale, namespace: 'rich' });
const mappings = { link: children => h('a', { href: '#order' }, children), strong: children => h('strong', null, children) };

test('SSR renders nested mapped tags, escaped values and unknown/prototype tags as children', () => {
  const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog('<link>Hello <strong>{name}</strong></link> <script>safe</script> <constructor>end</constructor>')] });
  const html = renderToStaticMarkup(h('p', null, renderRichText(store.tParts('rich:message', { name: '<img src=x>' }), mappings)));
  assert.equal(html, '<p><a href="#order">Hello <strong>&lt;img src=x&gt;</strong></a> safe end</p>');
  const inherited = Object.create({ link: () => h('script', null, 'unsafe') });
  assert.equal(renderToStaticMarkup(h('p', null, renderRichText(store.tParts('rich:message', { name: 'Ada' }), inherited))), '<p>Hello Ada safe end</p>');
  store.dispose();
});

test('catalog edits and literal insertion retain mapped component state, node identity and focus', async t => {
  const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog('<link>{name}</link> <strong>old</strong> <link>Other</link>')] });
  const { SayloProvider, useI18n } = createSayloReact();
  function Counter({ children }) {
    const [count, setCount] = useState(0);
    return h('button', { onClick: () => setCount(count + 1) }, children, ` ${count}`);
  }
  const renderers = { ...mappings, link: children => h(Counter, null, children) };
  function App() { return h('p', null, renderRichText(useI18n().tParts('rich:message', { name: 'Ada' }), renderers)); }
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  t.after(async () => { await act(() => root.unmount()); store.dispose(); container.remove(); });
  await act(() => root.render(h(SayloProvider, { instance: store }, h(App))));
  const button = container.querySelector('button');
  const second = container.querySelectorAll('button')[1];
  await act(() => button.click());
  button.focus();
  await act(() => store.replaceCatalogs([catalog('New prefix <link>{name}</link> <strong>new</strong> <link>Other changed</link>')]));
  assert.equal(container.querySelector('button'), button);
  assert.equal(button.textContent, 'Ada 1');
  assert.equal(container.querySelectorAll('button')[1], second);
  assert.equal(second.textContent, 'Other changed 0');
  assert.equal(document.activeElement, button);
  assert.equal(container.querySelector('strong').textContent, 'new');
});

test('hydration stays on the pinned rich snapshot until its barrier finishes', async t => {
  const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog('<link>boot</link>')] });
  const adapter = createHydrationAdapter(store);
  const { SayloProvider, useI18n } = createSayloReact();
  function App() { return h('p', null, renderRichText(useI18n().tParts('rich:message'), mappings)); }
  const app = h(SayloProvider, { instance: adapter }, h(App));
  const container = document.body.appendChild(document.createElement('div'));
  container.innerHTML = renderToString(app);
  const link = container.querySelector('a');
  store.replaceCatalogs([catalog('<link>updated</link>')]);
  const errors = [];
  let root;
  t.after(async () => { if (root) await act(() => root.unmount()); adapter.dispose(); store.dispose(); container.remove(); });
  await act(() => { root = hydrateRoot(container, app, { onRecoverableError: error => errors.push(error.message) }); });
  assert.equal(link.textContent, 'boot');
  assert.equal(container.querySelector('a'), link);
  await act(() => adapter.finishHydration());
  assert.equal(link.textContent, 'updated');
  assert.equal(container.querySelector('a'), link);
  assert.deepEqual(errors, []);
});
