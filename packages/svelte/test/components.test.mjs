import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { render } from 'svelte/server';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { compileFixtures } from './compile-fixtures.mjs';

const output = await compileFixtures('server');
const { default: Parent } = await import(new URL('Parent.mjs', output));
const { primary, secondary } = await import(new URL('bindings.mjs', output));
const { default: RichView } = await import(new URL('RichView.mjs', output));
const catalogs = ['ko', 'en'].map(locale => parseCatalog(JSON.stringify({ title: locale === 'ko' ? '한국어' : 'English' }), { locale, namespace: 'demo' }));

test('rich component SSR maps nested snippets, escapes values and unwraps unknown/inherited tags', async t => {
  const rich = parseCatalog('{"message":"<link>Hello <strong>{name}</strong></link> <script>safe</script> <constructor>end</constructor>"}', { locale: 'en', namespace: 'rich' });
  const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [rich] });
  t.after(() => store.dispose());
  const body = render(RichView, { props: { instance: store } }).body;
  const html = body.replace(/<!--[\s\S]*?-->/g, '');
  assert.equal(html, '<p><a href="#order">Hello <strong>&lt;img src=x></strong></a> safe end</p>');
  const inherited = Object.create({ link: () => { throw new Error('Inherited snippet must not execute'); } });
  assert.equal(render(RichView, { props: { instance: store, renderers: inherited } }).body.replace(/<!--[\s\S]*?-->/g, ''), '<p>Hello &lt;img src=x> safe end</p>');
  await writeFile(new URL('rich-hydration.html', output), body);
});

test('SSR isolates request and nested contexts, releases subscriptions and rejects mismatched factories', t => {
  const first = createStore({ baseLocale: 'ko', locale: 'ko', catalogs });
  const second = createStore({ baseLocale: 'ko', locale: 'en', catalogs });
  t.after(() => { first.dispose(); second.dispose(); });
  let active = 0;
  const instance = { ...first, subscribe(listener) {
    active++;
    const off = first.subscribe(listener);
    return () => { active--; off(); };
  } };
  const html = render(Parent, { props: { instance, other: second } }).body;
  assert.match(html, /<h1>한국어<\/h1>/);
  assert.match(html, /<h1>English<\/h1>/);
  assert.equal(active, 0);
  assert.match(render(Parent, { props: { instance: second } }).body, /<h1>English<\/h1>/);
  assert.match(render(Parent, { props: { instance } }).body, /<h1>한국어<\/h1>/);
  assert.throws(() => render(Parent, { props: { instance, bindings: primary, childBindings: secondary } }).body, /same createSayloSvelte factory/);
});

test('SSR selectors isolate request and nested contexts and leave no source subscriptions', async t => {
  const ko = createStore({ baseLocale: 'ko', locale: 'ko', catalogs });
  const en = createStore({ baseLocale: 'ko', locale: 'en', catalogs });
  t.after(() => { ko.dispose(); en.dispose(); });
  let active = 0;
  const track = store => ({ ...store, subscribe(listener) {
    active++;
    const off = store.subscribe(listener);
    return () => { active--; off(); };
  } });
  const first = track(ko), second = track(en);
  const html = render(Parent, { props: { instance: first, other: second, selected: true } }).body;
  assert.match(html, /<h1>한국어<\/h1>/);
  assert.match(html, /<h1>English<\/h1>/);
  assert.equal(active, 0);
  assert.match(render(Parent, { props: { instance: second, selected: true } }).body, /<h1>English<\/h1>/);
  const koHtml = render(Parent, { props: { instance: first, selected: true } }).body;
  assert.match(koHtml, /<h1>한국어<\/h1>/);
  assert.equal(active, 0);
  await writeFile(new URL('selector-hydration.html', output), koHtml);
  assert.throws(() => render(Parent, { props: { instance: first, selected: true, childBindings: secondary } }).body, /same createSayloSvelte factory/);
});

test('compiled Svelte client preserves DOM state and releases subscriptions', async () => {
  const instance = createStore({ baseLocale: 'ko', locale: 'ko', catalogs });
  try { await writeFile(new URL('hydration.html', output), render(Parent, { props: { instance } }).body); }
  finally { instance.dispose(); }
  const result = await promisify(execFile)(process.execPath, ['--conditions=browser', '--test', 'test/client.mjs'], {
    cwd: new URL('..', import.meta.url), windowsHide: true,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
  });
  assert.match(result.stdout, /fail 0/);
});
