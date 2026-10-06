import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from '@formatjs/icu-messageformat-parser';
import { CatalogError, createTranslator, parseCatalog } from '@0disoft/saylo-core';
import { parseSimpleMessage } from '../dist/simple-message.js';

const options = locale => ({ ignoreTag: true, captureLocation: true, requiresOtherClause: true, locale: new Intl.Locale(locale) });
const simple = ['', 'plain', '한글', '😀 {name} 끝', '\ud800{name}\udc00', 'a\r\n{name}\n끝', '\r{name}\r',
  'a\u2028{name}\u2029끝', '{name}', '{first}{last}', '{name} {name}', '{__proto__}/{constructor}',
  '# <b>{name}</b> </broken>', '<tag title="x">{name}', '\0{name}\t', '{_value9}', 'a\\{name}'];

test('simple AST matches FormatJS exactly, including Unicode columns, lines and top-level tag/pound literals', () => {
  for (const locale of ['ko', 'en-GB', 'ar']) for (const source of simple) {
    const ast = parseSimpleMessage(source);
    assert.ok(ast, JSON.stringify(source));
    assert.deepEqual(ast, parse(source, options(locale)), `${locale}: ${JSON.stringify(source)}`);
    const catalog = parseCatalog(JSON.stringify({ probe: source }), { locale, namespace: 'bench' });
    assert.deepEqual(catalog.messages.probe.ast, ast);
    assert.ok(Object.isFrozen(catalog.messages.probe.ast));
    for (const node of catalog.messages.probe.ast) {
      assert.ok(Object.isFrozen(node));
      assert.ok(Object.isFrozen(node.location.start));
      assert.ok(Object.isFrozen(node.location.end));
    }
  }
});

test('simple messages keep argument contracts and formatter results', () => {
  const catalog = parseCatalog('{"probe":"😀 {name}/{name}: {__proto__}","empty":""}', { locale: 'ko', namespace: 'bench' });
  assert.deepEqual(Object.keys(catalog.messages.probe.arguments), ['name', '__proto__']);
  for (const contract of Object.values(catalog.messages.probe.arguments))
    assert.deepEqual(contract, { required: true, acceptedTypes: ['string', 'number'] });
  const translator = createTranslator({ locale: 'ko', baseCatalogs: [catalog] });
  assert.equal(translator.t('bench:probe', JSON.parse('{"name":"제로디","__proto__":"safe"}')), '😀 제로디/제로디: safe');
  assert.equal(translator.t('bench:empty'), '');
});

test('quotes, whitespace/Unicode/numeric argument names and complex ICU delegate to FormatJS', () => {
  const sources = ["I'm {name}", "'{name}'", "''{name}", "'{broken", '}', 'a{name} tail}', '{ name }', '{한글}', '{0}',
    '{name\n}', '{name\r}', '{name\r\n}', '{name\u2028}', '{name\u2029}',
    '{n, number}', '{at, date, short}', '{at, time, short}', '{n, number, ::currency/USD}',
    '{n, plural, offset:1 =0 {zero} one {{name}} other {#}}', '{n, selectordinal, one {#st} other {#th}}',
    '{who, select, a {{name}} other {text}}'];
  for (const source of sources) {
    assert.equal(parseSimpleMessage(source), undefined, source);
    assert.deepEqual(parseCatalog(JSON.stringify({ probe: source }), { locale: 'en', namespace: 'bench' }).messages.probe.ast,
      parse(source, options('en')));
  }
});

test('malformed suffixes fall back atomically and keep FormatJS error offsets mapped to escaped JSON', () => {
  for (const source of ['{', 'a{name}{', '{}', '{{name}}', '{name!}', '{name,}', "😀\n{name}{broken"]) {
    assert.equal(parseSimpleMessage(source), undefined);
    let reference;
    try { parse(source, options('en')); } catch (error) { reference = error; }
    assert.ok(reference, source);
    const json = JSON.stringify({ probe: source });
    assert.throws(() => parseCatalog(json, { locale: 'en', namespace: 'bench', sourceName: 'en/bench.json' }), error => {
      assert.ok(error instanceof CatalogError);
      assert.equal(error.diagnostics[0].code, 'INVALID_ICU');
      assert.equal(error.diagnostics[0].message, `Invalid ICU message: ${reference.message}`);
      assert.equal(error.diagnostics[0].sourceName, 'en/bench.json');
      assert.equal(error.diagnostics[0].id, 'probe');
      // This fixture uses only a newline escape before the failing final argument.
      if (source.endsWith('{broken')) assert.equal(error.diagnostics[0].position.offset, json.indexOf('{broken'));
      return true;
    });
  }
});

test('generated combinations preserve FormatJS AST at literal/argument boundaries', () => {
  const fragments = ['', 'text', '😀', '\ud800', '\udc00', '\n', '\r\n', '#<b>', '{a}', '{a}{b}', '{__proto__}'];
  for (const left of fragments) for (const right of fragments) {
    const source = `${left} {name}${right}`;
    assert.deepEqual(parseSimpleMessage(source), parse(source, options('en')));
  }
});
