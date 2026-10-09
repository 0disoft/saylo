import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createBaseSchema, createStore, InvalidArgumentError, freezeCatalogs as freezeRootCatalogs } from '@0disoft/saylo-core';
import { freezeCatalogs } from '@0disoft/saylo-core/runtime';
import { createSayloReact, createHydrationAdapter } from '@0disoft/saylo-react';
import { renderTypes } from '@0disoft/saylo-typegen';
import { scanCatalogs } from '@0disoft/saylo-typegen/catalog-files';
import { connectDev } from '@0disoft/saylo-vite/client';
import { getServerCatalogSource } from '@0disoft/saylo-vite/server';

const { files } = await scanCatalogs('locales');
assert.equal(freezeCatalogs, freezeRootCatalogs);
const received = Object.freeze(files.map(file => Object.freeze(JSON.parse(JSON.stringify(file.catalog)))));
assert.equal(freezeCatalogs(received), received);
assert.ok(received.every(catalog => Object.isFrozen(catalog.messages) && Object.values(catalog.messages).every(message => Object.isFrozen(message.ast))));
const store = createStore({ baseLocale: 'ko', locale: 'en', catalogs: files.map(file => file.catalog) });
try {
  assert.equal(store.t('demo:greeting', { name: 'Saylo' }), 'Hello Saylo');
  assert.equal(store.t('demo:items', { count: 2 }), '2 items');
  assert.throws(() => store.t('demo:items', { count: 'wrong' }), InvalidArgumentError);
  const bindings = createSayloReact();
  function View() { return createElement('p', null, bindings.useI18n().t('demo:greeting', { name: 'Saylo' })); }
  const serverInstance = { ...store, getServerSnapshot: store.getSnapshot };
  assert.equal(renderToString(createElement(bindings.SayloProvider, { instance: serverInstance }, createElement(View))), '<p>Hello Saylo</p>');
  // Older approved releases keep their original hook surface.
  if (bindings.useI18nSelector) {
    function SelectedView() {
      const text = bindings.useI18nSelector(snapshot => snapshot.t('demo:greeting', { name: 'Selector' }));
      return createElement('p', null, text);
    }
    assert.equal(renderToString(createElement(bindings.SayloProvider, { instance: serverInstance }, createElement(SelectedView))), '<p>Hello Selector</p>');
    console.log('[pack] React selector SSR passed.');
  }
  assert.equal(renderTypes(files.filter(file => file.catalog.locale === 'ko').map(file => createBaseSchema(file.catalog))), await readFile('generated.d.ts', 'utf8'));
  connectDev(store)();
  assert.equal(typeof createHydrationAdapter, 'function');
  assert.throws(() => getServerCatalogSource('unregistered'), /unavailable/);
  store.setLocale('ko');
  assert.equal(store.t('demo:greeting', { name: 'Saylo' }), '안녕 Saylo');
  console.log('[pack] Translation, runtime argument rejection, React SSR and public subpath imports passed.');
} finally { store.dispose(); }
