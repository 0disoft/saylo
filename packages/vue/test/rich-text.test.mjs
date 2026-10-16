import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createStore, parseCatalog } from '@0disoft/saylo-core';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document,
  Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement });
const { createApp, createSSRApp, defineComponent, h, nextTick, ref } = await import('vue');
const { renderToString } = await import('vue/server-renderer');
const { renderRichText, useVueStore } = await import('@0disoft/saylo-vue');
after(() => dom.window.close());

const catalog = value => parseCatalog(JSON.stringify({ message: value }), { locale: 'en', namespace: 'rich' });
const mappings = { link: children => h('a', { href: '#order' }, children), strong: children => h('strong', null, children) };
const markup = html => html.replace(/<!--[\s\S]*?-->/g, '');

test('SSR escapes text and maps nested own tags while unknown/inherited/non-function tags unwrap', async t => {
  const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog('<link>Hello <strong>{name}</strong></link> <script>safe</script> <constructor>end</constructor>')] });
  t.after(() => store.dispose());
  const parts = store.tParts('rich:message', { name: '<img src=x>' });
  const render = renderers => renderToString(createSSRApp({ render: () => h('p', renderRichText(parts, renderers)) }));
  assert.equal(markup(await render(mappings)), '<p><a href="#order">Hello <strong>&lt;img src=x&gt;</strong></a> safe end</p>');
  assert.equal(markup(await render(Object.create({ link: () => h('script', 'unsafe') }))), '<p>Hello &lt;img src=x&gt; safe end</p>');
  assert.equal(markup(await render({ link: 'a', constructor: null })), '<p>Hello &lt;img src=x&gt; safe end</p>');
  assert.equal(markup(await render()), '<p>Hello &lt;img src=x&gt; safe end</p>');
});

test('literal insertion preserves repeated mapped component state, nodes and focus', async t => {
  const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog('<link>{name}</link> <strong>old</strong> <link>Other</link>')] });
  const Counter = defineComponent({ setup(_, { slots }) {
    const count = ref(0);
    return () => h('button', { onClick: () => count.value++ }, [slots.default?.(), ` ${count.value}`]);
  } });
  const renderers = { ...mappings, link: children => h(Counter, null, { default: () => children }) };
  const Root = { setup() { const state = useVueStore(store);
    return () => h('p', renderRichText(state.value.tParts('rich:message', { name: 'Ada' }), renderers));
  } };
  const container = document.body.appendChild(document.createElement('div'));
  const app = createApp(Root);
  t.after(() => { app.unmount(); store.dispose(); container.remove(); });
  app.mount(container);
  const [first, second] = container.querySelectorAll('button');
  first.click(); await nextTick(); first.focus();
  store.replaceCatalogs([catalog('Prefix <link>{name}</link> <strong>new</strong> <link>Other changed</link>')]);
  await nextTick();
  assert.equal(container.querySelector('button'), first);
  assert.equal(first.textContent, 'Ada 1');
  assert.equal(container.querySelectorAll('button')[1], second);
  assert.equal(second.textContent, 'Other changed 0');
  assert.equal(document.activeElement, first);
  assert.equal(container.querySelector('strong').textContent, 'new');
});

test('matching SSR hydration retains rich nodes through a live snapshot edit', async t => {
  const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog('<link>boot</link>')] });
  const Root = { setup() { const state = useVueStore(store);
    return () => h('p', renderRichText(state.value.tParts('rich:message'), mappings));
  } };
  const container = document.body.appendChild(document.createElement('div'));
  container.innerHTML = await renderToString(createSSRApp(Root));
  const link = container.querySelector('a'), warnings = [];
  const app = createSSRApp(Root);
  app.config.warnHandler = warning => warnings.push(warning);
  t.after(() => { app.unmount(); store.dispose(); container.remove(); });
  app.mount(container); await nextTick();
  assert.equal(container.querySelector('a'), link);
  store.replaceCatalogs([catalog('Prefix <link>updated</link>')]); await nextTick();
  assert.equal(container.querySelector('a'), link);
  assert.equal(link.textContent, 'updated');
  assert.deepEqual(warnings, []);
});
