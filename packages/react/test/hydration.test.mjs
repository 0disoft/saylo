import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement as h, StrictMode, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { createBaseSchema, createI18n, createStore, decodeBootSnapshot, parseCatalog, serializeBootSnapshot } from '@saylo/core';
import { createHydrationAdapter, createSayloReact } from '@saylo/react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { hydrateRoot } = await import('react-dom/client');
after(() => dom.window.close());

function sourceFixture() {
  const catalog = (text, locale = 'ko') => parseCatalog(JSON.stringify({ title: text, when: '{at, date, short}' }), { locale, namespace: 'demo' });
  let records = [catalog('서버 문구 </script><script>bad</script>'), catalog('English', 'en')];
  let version = 1;
  const fingerprint = () => createBaseSchema(records[0]).fingerprint;
  const outcome = locale => ({ sessionId: 'ssr', status: 'present', key: { locale, namespace: 'demo' }, catalogVersion: version,
    namespaceSchemaFingerprint: fingerprint(), catalog: records.find(c => c.locale === locale) });
  const source = {
    readManifest: () => ({ sessionId: 'ssr', registryRevision: version - 1, baseLocale: 'ko', availableLocales: ['en', 'ko'], availableNamespaces: ['demo'],
      catalogs: records.map(c => ({ key: { locale: c.locale, namespace: 'demo' }, status: 'present', catalogVersion: version, namespaceSchemaFingerprint: fingerprint() })) }),
    loadCatalog: async locale => outcome(locale),
  };
  return { source, create: (locale = 'ko') => createI18n({ catalogSource: source, locale, initialNamespaces: ['demo'], timeZone: 'Asia/Seoul',
    initialCatalogs: [...new Set(['ko', locale])].map(outcome) }),
    change(text) { records = [catalog(text), records[1]]; version++; } };
}

test('SSR requests render isolated locales and subsequent requests see the current source', async t => {
  const f = sourceFixture();
  const { SayloProvider, useI18n } = createSayloReact();
  function View() { const { t, locale } = useI18n(); return h('h1', { lang: locale }, t('demo:title')); }
  const render = locale => {
    const instance = f.create(locale);
    try { return renderToString(h(SayloProvider, { instance }, h(View))); }
    finally { instance.dispose(); }
  };
  const [ko, en] = await Promise.all([Promise.resolve().then(() => render('ko')), Promise.resolve().then(() => render('en'))]);
  assert.match(ko, /서버 문구 &lt;\/script&gt;/);
  assert.match(en, /lang="en">English/);
  f.change('이후 요청 문구');
  assert.match(render('ko'), /이후 요청 문구/);
});

test('hydration uses boot-bound t, buffers multiple newer catalogs, and preserves DOM/input/state at release', async t => {
  const f = sourceFixture();
  const server = f.create();
  const { SayloProvider, useI18n } = createSayloReact();
  const frames = [];
  const fixedDate = new Date('2026-01-01T16:00:00Z');
  let latestHook;
  function Form() {
    const snapshot = useI18n();
    latestHook = snapshot;
    frames.push(snapshot.t('demo:title'));
    const [count, setCount] = useState(0);
    return h('section', null, h('h1', null, snapshot.t('demo:title')), h('p', null, snapshot.t('demo:when', { at: fixedDate })),
      h('input', { defaultValue: '' }), h('button', { onClick: () => setCount(v => v + 1) }, `${count}`), h('dialog', { open: count > 0 }, 'confirmation'));
  }
  const app = instance => h(StrictMode, null, h(SayloProvider, { instance }, h(Form)));
  const html = renderToString(app(server));
  const wire = serializeBootSnapshot(server.getBootSnapshot());
  server.dispose();
  const container = document.createElement('div');
  container.innerHTML = `${html}<script id="boot" type="application/json">${wire}</script>`;
  document.body.append(container);
  assert.equal(container.querySelectorAll('script').length, 1);
  const boot = decodeBootSnapshot(container.querySelector('#boot').textContent);
  container.querySelector('#boot').remove();
  f.change('중간 문구');
  const client = createI18n({ catalogSource: f.source, initialSnapshot: boot });
  const adapter = createHydrationAdapter(client);
  await client.refresh();
  const input = container.querySelector('input');
  input.value = 'hydration 전 입력';
  input.focus(); input.setSelectionRange(3, 3);
  const errors = [];
  frames.length = 0;
  let root;
  await act(() => { root = hydrateRoot(container, app(adapter), { onRecoverableError: error => errors.push(error) }); });
  t.after(async () => { await act(() => root.unmount()); adapter.dispose(); client.dispose(); container.remove(); });
  assert.deepEqual(errors, []);
  assert.ok(frames.every(text => text === boot.catalogOutcomes[0].catalog.messages.title.source));
  const heldHook = latestHook;
  let commits = 0;
  adapter.subscribe(() => commits++);
  await act(() => container.querySelector('button').click());
  f.change('최신 문구');
  await act(() => client.refresh());
  assert.equal(commits, 0);
  assert.equal(adapter.getSnapshot(), adapter.getServerSnapshot());
  frames.length = 0;
  await act(() => adapter.finishHydration());
  assert.equal(commits, 1);
  assert.ok(frames.every(text => text === '최신 문구'));
  assert.equal(container.querySelector('h1').textContent, '최신 문구');
  assert.equal(container.querySelector('input'), input);
  assert.equal(input.value, 'hydration 전 입력');
  assert.equal(document.activeElement, input);
  assert.equal(input.selectionStart, 3);
  assert.equal(container.querySelector('button').textContent, '1');
  assert.equal(container.querySelector('dialog').open, true);
  assert.equal(heldHook.t('demo:title'), boot.catalogOutcomes[0].catalog.messages.title.source);
  assert.equal(adapter.getServerSnapshot().t('demo:title'), heldHook.t('demo:title'));
  adapter.finishHydration();
  assert.equal(commits, 1);
  await act(() => adapter.setLocale('en'));
  assert.equal(container.querySelector('h1').textContent, 'English');
  assert.equal(commits, 2);
});

test('hydration adapters have independent barriers and clean up without disposing the shared instance', () => {
  const catalog = locale => parseCatalog(JSON.stringify({ title: locale }), { locale, namespace: 'demo' });
  const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: ['ko', 'en'].map(catalog) });
  const one = createHydrationAdapter(store);
  const two = createHydrationAdapter(store);
  let notifications = 0;
  two.subscribe(() => notifications++);
  one.dispose(); one.dispose();
  store.setLocale('en');
  assert.equal(two.getSnapshot().locale, 'ko');
  two.finishHydration();
  assert.equal(two.getSnapshot().locale, 'en');
  assert.equal(notifications, 1);
  store.dispose();
  assert.throws(() => two.subscribe(() => {}), /disposed/);
  two.finishHydration();
});
