import assert from 'node:assert/strict';
import test from 'node:test';
import { createBaseSchema, createI18n, createServerI18n, createStore, createTranslator, decodeBootSnapshot,
  parseCatalog, serializeBootSnapshot } from '@0disoft/saylo-core';
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

function sourceFixture() {
  const catalogs = new Map(['en', 'fr'].map(locale => [locale,
    parseCatalog(JSON.stringify({ title: locale === 'en' ? 'Hello {name}' : 'Bonjour {name}' }), { locale, namespace: 'demo' })]));
  const outcome = locale => ({ sessionId: 'pseudo-test', status: 'present', key: { locale, namespace: 'demo' },
    catalogVersion: 1, namespaceSchemaFingerprint: createBaseSchema(catalogs.get(locale)).fingerprint, catalog: catalogs.get(locale) });
  const manifest = { sessionId: 'pseudo-test', registryRevision: 1, baseLocale: 'en', availableLocales: ['en', 'fr'],
    availableNamespaces: ['demo'], catalogs: ['en', 'fr'].map(locale => {
      const { catalog, sessionId, ...metadata } = outcome(locale); return metadata;
    }) };
  const calls = [], gates = new Map();
  const source = { readManifest: () => manifest, loadCatalog: async locale => {
    calls.push(locale); if (gates.has(locale)) await gates.get(locale).promise; return outcome(locale);
  } };
  const create = options => createI18n({ catalogSource: source, locale: 'en', initialNamespaces: ['demo'],
    initialCatalogs: [outcome('en')], ...options });
  return { source, calls, gates, create };
}

test('eager previews publish immediately, keep old snapshots pinned, and survive catalog edits', t => {
  const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog({ title: 'Hello {name}' })] });
  t.after(() => store.dispose());
  const old = store.getSnapshot(), revisions = [];
  store.subscribe(snapshot => revisions.push(snapshot.stateRevision));
  store.setPseudoLocale('accent');
  const accent = store.getSnapshot();
  store.setPseudoLocale('accent');
  assert.equal(store.getSnapshot(), accent);
  store.replaceCatalogs([catalog({ title: 'World {name}' })]);
  assert.equal(store.getSnapshot().pseudoLocale, 'accent');
  store.setPseudoLocale();
  assert.deepEqual(revisions, [1, 2, 3]);
  assert.equal(store.t('demo:title', { name: 'Ada' }), 'World Ada');
  assert.equal(old.t('demo:title', { name: 'Ada' }), 'Hello Ada');
  assert.match(accent.t('demo:title', { name: 'Ada' }), /Ĥëľľö/);
  const before = store.getSnapshot();
  assert.throws(() => store.setPseudoLocale('unknown'), /pseudoLocale/);
  assert.equal(store.getSnapshot(), before);
  store.dispose();
  assert.throws(() => store.setPseudoLocale('accent'), /disposed/);
});

test('lazy preview does not load catalogs or complete in-flight locale and refresh requests', async t => {
  const f = sourceFixture(), instance = f.create();
  t.after(() => instance.dispose());
  assert.throws(() => f.create({ pseudoLocale: null }), /pseudoLocale/);
  assert.throws(() => instance.setPseudoLocale('unknown'), /pseudoLocale/);
  const gate = Promise.withResolvers(); f.gates.set('fr', gate);
  const initial = instance.getServerSnapshot();
  let localeDone = false, refreshDone = false;
  const switching = instance.setLocale('fr').then(() => { localeDone = true; });
  const refreshing = instance.refresh().then(() => { refreshDone = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls, ['fr']);
  instance.setPseudoLocale('accent');
  const preview = instance.getSnapshot();
  instance.setPseudoLocale('accent');
  assert.equal(instance.getSnapshot(), preview);
  assert.equal(preview.locale, 'en');
  assert.match(instance.t('demo:title', { name: 'Ada' }), /Ĥëľľö/);
  await Promise.resolve();
  assert.equal(localeDone, false); assert.equal(refreshDone, false);
  assert.deepEqual(f.calls, ['fr']);
  gate.resolve(); await Promise.all([switching, refreshing]);
  assert.equal(instance.getSnapshot().locale, 'fr');
  assert.equal(instance.getSnapshot().pseudoLocale, 'accent');
  instance.setPseudoLocale();
  assert.equal(instance.t('demo:title', { name: 'Ada' }), 'Bonjour Ada');
  assert.equal(instance.getServerSnapshot(), initial);
  assert.equal(initial.t('demo:title', { name: 'Ada' }), 'Hello Ada');
  assert.deepEqual(f.calls, ['fr']);
});

test('reentrant preview changes are ordered for every subscriber and subscriber errors retain commits', async t => {
  for (const kind of ['eager', 'lazy']) await t.test(kind, t => {
    const instance = kind === 'eager'
      ? createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog({ title: 'Hello' })] }) : sourceFixture().create();
    t.after(() => instance.dispose());
    const seen = [];
    instance.subscribe(snapshot => {
      seen.push(['first', snapshot.pseudoLocale, snapshot.stateRevision]);
      if (snapshot.pseudoLocale === 'accent') instance.setPseudoLocale('long');
    });
    instance.subscribe(snapshot => seen.push(['second', snapshot.pseudoLocale, snapshot.stateRevision]));
    instance.setPseudoLocale('accent');
    assert.deepEqual(seen, [['first', 'accent', 1], ['second', 'accent', 1], ['first', 'long', 2], ['second', 'long', 2]]);
    const off = instance.subscribe(() => { throw new Error('subscriber failed'); });
    assert.throws(() => instance.setPseudoLocale(), AggregateError);
    assert.equal(instance.getSnapshot().pseudoLocale, undefined);
    off();
  });
});

test('SSR preview survives normal and compact boot serialization and rejects conflicting modes', async t => {
  const f = sourceFixture();
  const server = await createServerI18n({ catalogSource: f.source, locale: 'fr', initialNamespaces: ['demo'], pseudoLocale: 'accent' });
  t.after(() => server.dispose());
  const expected = server.t('demo:title', { name: 'Ada' });
  for (const compact of [false, true]) {
    const boot = decodeBootSnapshot(serializeBootSnapshot(server.getBootSnapshot(), { compact }));
    assert.equal(boot.pseudoLocale, 'accent');
    assert.throws(() => createI18n({ catalogSource: f.source, initialSnapshot: boot, pseudoLocale: 'long' }), { code: 'INVALID_BOOT' });
    const client = createI18n({ catalogSource: f.source, initialSnapshot: boot });
    t.after(() => client.dispose());
    assert.equal(client.t('demo:title', { name: 'Ada' }), expected);
    client.setPseudoLocale();
    assert.equal(client.t('demo:title', { name: 'Ada' }), 'Bonjour Ada');
    assert.equal(client.getServerSnapshot().pseudoLocale, 'accent');
    assert.equal(client.getBootSnapshot().pseudoLocale, undefined);
    assert.throws(() => decodeBootSnapshot(JSON.stringify({ ...boot, pseudoLocale: 'unknown' })), { code: 'INVALID_BOOT' });
  }
});
