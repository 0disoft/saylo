import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLocale, parseAcceptLanguage, resolveAcceptLanguage } from '@0disoft/saylo-core';
import * as runtime from '@0disoft/saylo-core/runtime';

test('locale helpers are exported from the parser-free runtime', () => {
  assert.equal(runtime.resolveLocale, resolveLocale);
  assert.equal(runtime.parseAcceptLanguage, parseAcceptLanguage);
  assert.equal(runtime.resolveAcceptLanguage, resolveAcceptLanguage);
});

test('locale lookup canonicalizes aliases and respects candidate and parent order', () => {
  assert.equal(resolveLocale(['EN-gb', 'fr'], ['KO', 'en', 'fr'], 'ko'), 'en');
  assert.equal(resolveLocale(['fr-CA'], ['ko', 'fr'], 'ko'), 'fr');
  assert.equal(resolveLocale(['iw-IL'], ['ko', 'he'], 'ko'), 'he');
  assert.equal(resolveLocale(['zh-Hant-TW'], ['zh', 'zh-Hant', 'ko'], 'ko'), 'zh-Hant');
  assert.equal(resolveLocale(['en-GB'], ['en', 'en-GB'], 'en'), 'en-GB');
});

test('locale lookup strips extension singletons and never guesses a regional catalog', () => {
  assert.equal(resolveLocale(['en-US-u-ca-gregory'], ['en-US', 'ko'], 'ko'), 'en-US');
  assert.equal(resolveLocale(['zh-Hant-CN-x-private1-private2'], ['zh-Hant', 'ko'], 'ko'), 'zh-Hant');
  assert.equal(resolveLocale(['en'], ['en-US', 'ko'], 'ko'), 'ko');
  assert.equal(resolveLocale(['en-AU'], ['en-GB', 'ko'], 'ko'), 'ko');
});

test('bad user candidates are skipped and empty or unsupported lists use the fallback', () => {
  for (const candidates of [[], [''], ['en_US', '*', 'en;q=1', ' fr '], ['fr']]) {
    assert.equal(resolveLocale(candidates, ['ko', 'en'], 'KO'), 'ko');
  }
  assert.equal(resolveLocale(['en_US', 'EN'], ['ko', 'en'], 'ko'), 'en');
});

test('invalid policy configuration fails instead of silently hiding app errors', () => {
  for (const resolve of [locales => resolveLocale([], locales, 'ko'), locales => resolveAcceptLanguage('', locales, 'ko')]) {
    for (const locales of [[], ['en'], ['ko', 'en_US'], ['ko', 'KO'], ['ko', 'iw', 'he']]) {
      assert.throws(() => resolve(locales), RangeError);
    }
  }
  assert.throws(() => resolveLocale([], ['ko'], 'en_US'), RangeError);
});

test('lookup and header resolution leave caller arrays untouched', () => {
  const candidates = Object.freeze(['EN-gb', 'ko']);
  const supported = Object.freeze(['KO', 'en']);
  assert.equal(resolveLocale(candidates, supported, 'KO'), 'en');
  assert.equal(resolveAcceptLanguage('en', supported, 'KO'), 'en');
  assert.deepEqual(candidates, ['EN-gb', 'ko']);
  assert.deepEqual(supported, ['KO', 'en']);
});

test('HTTP parser orders by quality with stable ties and retains immutable exclusions', () => {
  const parsed = parseAcceptLanguage(' fr-CA;q=0.7, EN;q=1, ko;q=0.7, *;q=0, de;Q=0.001 ');
  assert.deepEqual(parsed, [
    { range: 'en', quality: 1 }, { range: 'fr-CA', quality: 0.7 },
    { range: 'ko', quality: 0.7 }, { range: 'de', quality: 0.001 }, { range: '*', quality: 0 },
  ]);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(parsed.every(Object.isFrozen));
});

test('HTTP parser checks quality limits and skips only malformed entries', () => {
  for (const q of ['0', '0.', '0.000', '0.001', '0.999', '1', '1.', '1.000']) {
    assert.equal(parseAcceptLanguage(`en;q=${q}`)[0]?.quality, Number(q));
  }
  for (const bad of ['en;q=-0.1', 'en;q=1.001', 'en;q=0.0001', 'en;q=.9', 'en;q=01',
    'en;q=NaN', 'en;q=1;q=0', 'en;other=x', 'en_US', 'en-*', 'en\n', 'en;q=']) {
    assert.deepEqual(parseAcceptLanguage(`${bad},ko`), [{ range: 'ko', quality: 1 }], bad);
  }
  for (const absent of [null, undefined, '', ' , ']) assert.deepEqual(parseAcceptLanguage(absent), []);
});

test('HTTP selection uses quality, parent lookup and stable ties', () => {
  assert.equal(resolveAcceptLanguage('fr;q=1,en-GB;q=0.8,ko;q=0.2', ['ko', 'en'], 'ko'), 'en');
  assert.equal(resolveAcceptLanguage('en;q=0.8,ko;q=0.8', ['ko', 'en'], 'ko'), 'en');
  assert.equal(resolveAcceptLanguage('en;q=0.2,ko;q=0.8', ['ko', 'en'], 'en'), 'ko');
  assert.equal(resolveAcceptLanguage('broken;q=oops,en;q=0.001', ['ko', 'en'], 'ko'), 'en');
});

test('q=0 cannot be resurrected by a parent lookup or wildcard', () => {
  assert.equal(resolveAcceptLanguage('en-US,en;q=0,ko;q=0.1', ['ko', 'en'], 'ko'), 'ko');
  assert.equal(resolveAcceptLanguage('en;q=0,*;q=1', ['en', 'ko'], 'ko'), 'ko');
  assert.equal(resolveAcceptLanguage('ko;q=0,*;q=1', ['ko', 'en'], 'ko'), 'en');
  assert.equal(resolveAcceptLanguage('en;q=1,en;q=0,ko;q=0.5', ['ko', 'en'], 'ko'), 'ko');
});

test('more-specific positive ranges override broad exclusions, but equal q=0 wins', () => {
  assert.equal(resolveAcceptLanguage('en;q=0,en-US;q=0.5', ['ko', 'en-US'], 'ko'), 'en-US');
  assert.equal(resolveAcceptLanguage('*;q=0,en;q=0.5', ['ko', 'en'], 'ko'), 'en');
  assert.equal(resolveAcceptLanguage('en-US;q=0,en;q=1', ['ko', 'en-US'], 'ko'), 'ko');
});

test('wildcard supplies a default after explicit ranges and exhaustion uses app fallback', () => {
  assert.equal(resolveAcceptLanguage('*;q=1,en;q=0.5', ['ko', 'en'], 'ko'), 'en');
  assert.equal(resolveAcceptLanguage('*', ['en', 'ko'], 'ko'), 'ko');
  for (const header of ['', null, undefined, 'fr', '*;q=0', 'ko;q=0,en;q=0']) {
    assert.equal(resolveAcceptLanguage(header, ['ko', 'en'], 'ko'), 'ko');
  }
});
