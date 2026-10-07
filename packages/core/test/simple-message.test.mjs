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

test('catalog-relative positions share exact tuples without merging Unicode columns or source positions', () => {
  const messages = { first: 'x{name}', second: 'y{name}', unicode: '😀{name}', bmp: 'ab{name}',
    multiline: 'a\n{name}', crlf: '\r\n{name}', twoLines: '\n\n{name}', lone: '\ud800{name}' };
  const config = { locale: 'en', namespace: 'bench' };
  const source = JSON.stringify(messages);
  const catalog = parseCatalog(source, config);
  const argumentStart = id => catalog.messages[id].ast[1].location.start;
  assert.equal(argumentStart('first'), argumentStart('second'));
  assert.equal(catalog.messages.first.ast[1].location, catalog.messages.second.ast[1].location);
  assert.equal(catalog.messages.first.ast[0].location, catalog.messages.second.ast[0].location);
  assert.equal(catalog.messages.first.ast[0].location.end, argumentStart('first'));
  assert.equal(argumentStart('first'), argumentStart('lone'));
  assert.notEqual(argumentStart('unicode'), argumentStart('bmp'));
  assert.deepEqual(argumentStart('unicode'), { offset: 2, line: 1, column: 2 });
  assert.deepEqual(argumentStart('bmp'), { offset: 2, line: 1, column: 3 });
  assert.equal(argumentStart('multiline'), argumentStart('crlf'));
  assert.deepEqual(argumentStart('multiline'), { offset: 2, line: 2, column: 1 });
  assert.deepEqual(argumentStart('twoLines'), { offset: 2, line: 3, column: 1 });
  assert.notEqual(argumentStart('multiline'), argumentStart('twoLines'));
  assert.notEqual(argumentStart('multiline'), argumentStart('unicode'));
  assert.notEqual(catalog.messages.first.position, catalog.messages.second.position);
  assert.equal(catalog.messages.first.position.offset, source.indexOf('"x{name}"'));
  assert.equal(catalog.messages.second.position.offset, source.indexOf('"y{name}"'));
  for (const [id, text] of Object.entries(messages))
    assert.deepEqual(catalog.messages[id].ast, parse(text, options('en')));
  assert.throws(() => { argumentStart('first').column = 0; }, TypeError);
  const independent = parseCatalog(source, config);
  assert.notEqual(argumentStart('first'), independent.messages.first.ast[1].location.start);
  const next = parseCatalog(JSON.stringify({ ...messages, first: 'z{name}' }), config, catalog);
  assert.equal(next.messages.second, catalog.messages.second);
  assert.notEqual(next.messages.first.ast[1].location.start, argumentStart('first'));
  assert.deepEqual(next.messages.first.ast, parse('z{name}', options('en')));
});

test('a failed simple parse after a shared position preserves fallback ICU diagnostics', () => {
  const source = JSON.stringify({ good: '😀\n{name}', bad: '😀\n{name}{broken' });
  assert.throws(() => parseCatalog(source, { locale: 'en', namespace: 'bench' }), error => {
    assert.ok(error instanceof CatalogError);
    assert.equal(error.diagnostics[0].code, 'INVALID_ICU');
    assert.equal(error.diagnostics[0].id, 'bad');
    assert.equal(error.diagnostics[0].position.offset, source.indexOf('{broken'));
    return true;
  });
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
