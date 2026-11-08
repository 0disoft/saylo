import assert from 'node:assert/strict';
import test from 'node:test';
import { createTranslator, parseCatalog } from '@0disoft/saylo-core';
import { createBoundTranslator } from '../dist/translator.js';
import { createTextFormatter } from '../dist/formatters.js';

const catalog = messages => parseCatalog(JSON.stringify(messages), { locale: 'en', namespace: 'demo' });
const translator = (base, pseudoLocale) => createTranslator({ locale: 'en', baseCatalogs: [base],
  ...(pseudoLocale ? { pseudoLocale } : {}) });
const flatten = parts => parts.map(part => part.type === 'text' ? part.value : flatten(part.children)).join('');

test('pseudo rendering preserves argument values and leaves catalogs unchanged', () => {
  const base = catalog({ greeting: 'Hello {name}', chinese: '你好', spaced: '  Hello  ',
    numbers: '{n, number, ::currency/USD}', date: '{at, date, short}' });
  const before = JSON.stringify(base), args = { name: 'Ada <link>raw</link>' };
  const normal = translator(base), accent = translator(base, 'accent'), long = translator(base, 'long');
  assert.equal(accent.t('demo:greeting', args), '［Ĥëľľö～～］ Ada <link>raw</link>');
  assert.equal(long.t('demo:greeting', args), '［Hello～～～～～］ Ada <link>raw</link>');
  assert.equal(accent.t('demo:spaced'), '  ［Ĥëľľö～～］  ');
  assert.match(long.t('demo:chinese'), /^［你好～～］$/);
  for (const preview of [accent, long]) {
    assert.equal(preview.locale, 'en');
    assert.equal(preview.t('demo:numbers', { n: 1234.5 }), normal.t('demo:numbers', { n: 1234.5 }));
    assert.equal(preview.t('demo:date', { at: new Date('2026-11-08T00:00:00Z') }),
      normal.t('demo:date', { at: new Date('2026-11-08T00:00:00Z') }));
  }
  assert.equal(JSON.stringify(base), before);
  assert.equal(normal.t('demo:greeting', args), 'Hello Ada <link>raw</link>');
  assert.equal(Object.hasOwn(normal, 'pseudoLocale'), false);
});

test('nested select, exact plural branches, offsets and ordinal rules retain ICU semantics', () => {
  const base = catalog({ value: '{kind, select, a {{n, plural, offset:1 =0 {None} one {One with {name}} other {Many # for {name}}}} other {Other}}',
    rank: '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}' });
  const t = translator(base, 'long');
  assert.equal(t.t('demo:value', { kind: 'a', n: 0, name: 'Ada' }), '［None～～～～］');
  assert.equal(t.t('demo:value', { kind: 'a', n: 2, name: 'Ada' }), '［One with～～～～～～～～］ Ada');
  assert.equal(t.t('demo:value', { kind: 'a', n: 4, name: 'Ada' }), '［Many～～～～］ 3 ［for～～～］ Ada');
  assert.equal(t.t('demo:rank', { n: 22 }), '22［nd～～］');
});

test('rich tag identities and interpolation escaping remain intact in both surfaces', () => {
  const base = parseCatalog(JSON.stringify({ rich: 'Hello <link><strong>{name}</strong> world</link>!',
    branches: '{n, plural, one {<link>One {name}</link>} other {<link>Many {name}</link>}}' }), {
    locale: 'en', namespace: 'demo', richText: { rich: ['link', 'strong'], branches: ['link'] },
  });
  const t = translator(base, 'accent'), args = { name: '<img src=x>' };
  const parts = t.tParts('demo:rich', args);
  const link = parts.find(part => part.type === 'tag');
  assert.equal(link.name, 'link');
  assert.equal(link.children[0].name, 'strong');
  assert.equal(flatten(link.children[0].children), args.name);
  assert.ok(Object.isFrozen(link.children[0].children));
  assert.equal(t.t('demo:rich', args), '［Ĥëľľö～～］ <link><strong><img src=x></strong> ［ŵöřľď～～］</link>!');
  assert.equal(t.tParts('demo:branches', { n: 2, name: 'Ada' })[0].name, 'link');
});

test('shared formatter caches keep normal, accent and long output separate', () => {
  const base = catalog({ title: 'Hello {name}' }), shared = createTextFormatter('UTC');
  const make = mode => createBoundTranslator({ locale: 'en', baseCatalogs: [base],
    ...(mode ? { pseudoLocale: mode } : {}), onFormatError: () => 'invalid' }, shared);
  for (const mode of ['accent', undefined, 'long', 'accent', undefined]) {
    const t = make(mode), output = t.t('demo:title', { name: 'Ada' });
    assert.equal(flatten(t.tParts('demo:title', { name: 'Ada' })), output);
    assert.equal(output.includes('［'), mode !== undefined);
    assert.equal(output.includes('Ĥ'), mode === 'accent');
    assert.equal(t.t('demo:title'), 'invalid');
  }
  assert.throws(() => createTranslator({ locale: 'en', baseCatalogs: [base], pseudoLocale: 'unknown' }), /pseudoLocale/);
});
