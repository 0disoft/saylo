import assert from 'node:assert/strict';
import { createStore, parseCatalog, InvalidRichTextError } from '@0disoft/saylo-core';
import { createTranslator } from '@0disoft/saylo-core/runtime';

const base = parseCatalog(JSON.stringify({ message: '<link>Hello <strong>{name}</strong></link>' }), { locale: 'en', namespace: 'rich' });
const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [base] });
const expected = [{ type: 'tag', name: 'link', children: [
  { type: 'text', value: 'Hello ' },
  { type: 'tag', name: 'strong', children: [{ type: 'text', value: '<script>text</script>' }] },
] }];
assert.deepEqual(store.tParts('rich:message', { name: '<script>text</script>' }), expected);
assert.deepEqual(createTranslator({ locale: 'en', baseCatalogs: [base] }).tParts('rich:message', { name: '<script>text</script>' }), expected);
assert.equal(store.t('rich:message', { name: 'Ada' }), '<link>Hello <strong>Ada</strong></link>');
const invalid = parseCatalog('{"message":"<link>unclosed {name}"}', { locale: 'en', namespace: 'rich' });
store.replaceCatalogs([invalid]);
assert.throws(() => store.tParts('rich:message', { name: 'Ada' }), InvalidRichTextError);
store.dispose();
console.log('[pack] Installed core and parser-free runtime rich text API passed.');
