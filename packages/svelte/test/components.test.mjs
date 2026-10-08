import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { render } from 'svelte/server';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { compileFixtures } from './compile-fixtures.mjs';

const output = await compileFixtures('server');
const { default: Parent } = await import(new URL('Parent.mjs', output));
const { primary, secondary } = await import(new URL('bindings.mjs', output));
const catalogs = ['ko', 'en'].map(locale => parseCatalog(JSON.stringify({ title: locale === 'ko' ? '한국어' : 'English' }), { locale, namespace: 'demo' }));

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

test('compiled Svelte client preserves DOM state and releases subscriptions', async () => {
  const result = await promisify(execFile)(process.execPath, ['--conditions=browser', '--test', 'test/client.mjs'], {
    cwd: new URL('..', import.meta.url), windowsHide: true,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
  });
  assert.match(result.stdout, /fail 0/);
});
