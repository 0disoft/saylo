import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalog, createTranslator, createStore, createBaseSchema, createBootSnapshot,
  serializeBootSnapshot, decodeBootSnapshot, createI18n, InvalidArgumentError, InvalidRichTextError } from '../dist/index.js';
import { createI18n as runtimeI18n } from '../dist/runtime.js';

const catalog = (messages, locale = 'en') => parseCatalog(JSON.stringify(messages), { locale, namespace: 'demo' });
const text = value => ({ type: 'text', value });
const tag = (name, ...children) => ({ type: 'tag', name, children });

test('nested and repeated markers preserve text t, freeze parts, and never interpret argument markup', () => {
  const base = catalog({ x: 'Hello <link><strong>{name}</strong></link> / <link>again</link>' });
  const tr = createTranslator({ locale: 'en', baseCatalogs: [base] });
  const name = '<script>alert(1)</script>';
  assert.equal(tr.t('demo:x', { name }), `Hello <link><strong>${name}</strong></link> / <link>again</link>`);
  const parts = tr.tParts('demo:x', { name });
  assert.deepEqual(parts, [text('Hello '), tag('link', tag('strong', text(name))), text(' / '), tag('link', text('again'))]);
  function frozen(value) { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }
  frozen(parts);
  assert.throws(() => parts[1].children.push(text('mutation')), TypeError);
});

test('ICU branches and formatting use source locale and UTC fallback, with the same base args', () => {
  const base = catalog({ x: '{n, plural, offset:1 =0 {<em>none</em>} one {<em># item</em>} other {<em># items</em>}}',
    choice: '{kind, select, yes {<strong>{n, number}</strong>} other {no}}', date: '<time>{at, time, ::HHmm}</time>' });
  const tr = createTranslator({ locale: 'ko', baseCatalogs: [base], timeZone: 'UTC' });
  assert.deepEqual(tr.tParts('demo:x', { n: 3 }), [tag('em', text('2 items'))]);
  assert.deepEqual(tr.tParts('demo:x', { n: 0 }), [tag('em', text('none'))]);
  assert.deepEqual(tr.tParts('demo:choice', { kind: 'yes', n: 1234 }), [tag('strong', text('1,234'))]);
  assert.deepEqual(tr.tParts('demo:date', { at: new Date('2026-01-01T13:45:00Z') }), [tag('time', text('13:45'))]);
  const translated = createTranslator({ locale: 'ko', baseCatalogs: [base], translations: [catalog({ x: '<em>생략</em>' }, 'ko')] });
  assert.throws(() => translated.tParts('demo:x'), InvalidArgumentError);
  assert.deepEqual(translated.tParts('demo:x', { n: 3 }), [tag('em', text('생략'))]);
});

test('tag and scalar argument names cannot collide, including internal names and prototype properties', () => {
  const tr = createTranslator({ locale: 'en', baseCatalogs: [catalog({ x: '<name>{name}</name><constructor>{__saylo_tag_0}</constructor><__proto__>ok</__proto__>' })] });
  // Names beginning with underscore are literal text; callback aliases avoid argument keys.
  assert.deepEqual(tr.tParts('demo:x', { name: 'A', __saylo_tag_0: 'B' }),
    [tag('name', text('A')), tag('constructor', text('B')), text('<__proto__>ok</__proto__>')]);
});

test('malformed structure fails only parts; attributes/self-closing markers remain literal', () => {
  const base = catalog({ mismatch: '<a>word</b>', unclosed: '<a>word', branch: '<a>{n, plural, other {x</a>}}',
    attributed: '<a href="/">link</a>', literal: '2 < 3 <br/>', quoted: "'<a>'quoted'</a>'", empty: '<a></a>' });
  const tr = createTranslator({ locale: 'en', baseCatalogs: [base] });
  for (const key of ['mismatch', 'unclosed', 'branch', 'attributed']) {
    assert.throws(() => tr.tParts(`demo:${key}`, { n: 1 }), error => error instanceof InvalidRichTextError && error.key === `demo:${key}`);
    assert.equal(typeof tr.t(`demo:${key}`, { n: 1 }), 'string');
  }
  assert.deepEqual(tr.tParts('demo:literal'), [text('2 < 3 <br/>')]);
  assert.deepEqual(tr.tParts('demo:quoted'), [tag('a', text('quoted'))]);
  assert.deepEqual(tr.tParts('demo:empty'), [tag('a')]);
});

test('live stores advance parts but old snapshots stay pinned; failed reads do not poison caches', () => {
  const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog({ x: '<a>old</a>' })] });
  const old = store.getSnapshot();
  store.replaceCatalogs([catalog({ x: '<a>new</a>' })]);
  assert.deepEqual(store.tParts('demo:x'), [tag('a', text('new'))]);
  assert.deepEqual(old.tParts('demo:x'), [tag('a', text('old'))]);
  store.replaceCatalogs([catalog({ x: '<a>bad' })]);
  assert.throws(() => store.tParts('demo:x'), InvalidRichTextError);
  store.replaceCatalogs([catalog({ x: '<a>fixed</a>' })]);
  assert.deepEqual(store.tParts('demo:x'), [tag('a', text('fixed'))]);
  store.dispose();
});

test('existing boot wire and runtime entry carry rich parts without additional metadata', () => {
  const base = catalog({ x: '<strong>{name}</strong>' });
  const manifest = { sessionId: 'rich', registryRevision: 0, baseLocale: 'en', availableLocales: ['en'], availableNamespaces: ['demo'],
    catalogs: [{ status: 'present', key: { locale: 'en', namespace: 'demo' }, catalogVersion: 0, namespaceSchemaFingerprint: createBaseSchema(base).fingerprint }] };
  const outcome = { status: 'present', sessionId: 'rich', key: { locale: 'en', namespace: 'demo' }, catalogVersion: 0,
    namespaceSchemaFingerprint: createBaseSchema(base).fingerprint, catalog: base };
  const boot = decodeBootSnapshot(serializeBootSnapshot(createBootSnapshot({ manifest, locale: 'en', timeZone: 'UTC', stateRevision: 0,
    loadedNamespaces: ['demo'], catalogOutcomes: [outcome] })));
  for (const create of [createI18n, runtimeI18n]) {
    const instance = create({ initialSnapshot: boot, catalogSource: { readManifest: () => manifest, loadCatalog: async () => outcome } });
    assert.deepEqual(instance.tParts('demo:x', { name: 'SSR' }), [tag('strong', text('SSR'))]);
    assert.deepEqual(instance.getServerSnapshot().tParts('demo:x', { name: 'SSR' }), instance.tParts('demo:x', { name: 'SSR' }));
    instance.dispose();
  }
});
