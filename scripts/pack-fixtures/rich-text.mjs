import assert from 'node:assert/strict';
import { createStore, parseCatalog, InvalidRichTextError } from '@0disoft/saylo-core';
import { createTranslator } from '@0disoft/saylo-core/runtime';
import { renderRichText } from '@0disoft/saylo-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const base = parseCatalog(JSON.stringify({ message: '<link>Hello <strong>{name}</strong></link>' }), { locale: 'en', namespace: 'rich' });
const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [base] });
const expected = [{ type: 'tag', name: 'link', children: [
  { type: 'text', value: 'Hello ' },
  { type: 'tag', name: 'strong', children: [{ type: 'text', value: '<script>text</script>' }] },
] }];
assert.deepEqual(store.tParts('rich:message', { name: '<script>text</script>' }), expected);
assert.deepEqual(createTranslator({ locale: 'en', baseCatalogs: [base] }).tParts('rich:message', { name: '<script>text</script>' }), expected);
assert.equal(renderToStaticMarkup(createElement('p', null, renderRichText(expected, {
  link: children => createElement('a', { href: '/orders' }, children),
  strong: children => createElement('strong', null, children),
}))), '<p><a href="/orders">Hello <strong>&lt;script&gt;text&lt;/script&gt;</strong></a></p>');
assert.equal(store.t('rich:message', { name: 'Ada' }), '<link>Hello <strong>Ada</strong></link>');
const invalid = parseCatalog('{"message":"<link>unclosed {name}"}', { locale: 'en', namespace: 'rich' });
store.replaceCatalogs([invalid]);
assert.throws(() => store.tParts('rich:message', { name: 'Ada' }), InvalidRichTextError);
store.dispose();
console.log('[pack] Installed core, parser-free runtime and React rich text SSR passed.');
