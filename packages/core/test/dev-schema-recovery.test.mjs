import assert from 'node:assert/strict';
import test from 'node:test';
import { InvalidArgumentError, NamespaceNotLoadedError, UnknownMessageError, createBaseSchema, createI18n,
  createStore, decodeBootSnapshot, parseCatalog, serializeBootSnapshot } from '@0disoft/saylo-core';

const catalog = (messages, locale = 'en') => parseCatalog(JSON.stringify(messages), { locale, namespace: 'demo' });
const create = (messages, options = {}) => createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog(messages)], ...options });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('required argument edits retain the prior message with current input, then use the repaired call', async t => {
  const events = [], store = create({ title: 'Hello {name}' }, { devSchemaRecovery: { onDiagnostic: event => events.push(event) } });
  t.after(() => store.dispose());
  assert.equal(store.t('demo:title', { name: 'Ada' }), 'Hello Ada');
  store.replaceCatalogs([catalog({ title: 'Welcome {name} from {company}' })]);
  assert.equal(store.t('demo:title', { name: 'Lin' }), 'Hello Lin');
  assert.equal(store.t('demo:title', { name: 'Max' }), 'Hello Max');
  assert.deepEqual(events, []);
  await flush(); assert.equal(events.length, 1); assert.equal(events[0].reason, 'required-argument-added');
  assert.equal(store.t('demo:title', { name: 'Max', company: 'Rodisoft' }), 'Welcome Max from Rodisoft');
  await flush(); assert.equal(events.at(-1).status, 'resolved');
  assert.equal(JSON.stringify(events).includes('Rodisoft'), false);
});

test('deleted rich keys retain their structure and current values without treating input as markup', t => {
  const rich = messages => parseCatalog(JSON.stringify(messages), { locale: 'en', namespace: 'demo',
    richText: { title: ['strong', 'link'] } });
  const store = createStore({ baseLocale: 'en', locale: 'en',
    catalogs: [rich({ title: '<link>Hello <strong>{name}</strong></link>', keep: 'Keep' })], devSchemaRecovery: { onDiagnostic() {} } });
  t.after(() => store.dispose());
  store.tParts('demo:title', { name: 'Ada' });
  store.replaceCatalogs([catalog({ keep: 'Keep' })]);
  const parts = store.tParts('demo:title', { name: '<script>Lin</script>' });
  assert.equal(parts[0].name, 'link'); assert.equal(parts[0].children[1].name, 'strong');
  assert.deepEqual(parts[0].children[1].children, [{ type: 'text', value: '<script>Lin</script>' }]);
  assert.ok(Object.isFrozen(parts[0].children));
  // Text and parts keep independent successful-render histories.
  assert.throws(() => store.t('demo:title', { name: 'Lin' }), UnknownMessageError);
});

test('strict defaults and unrelated argument/key errors remain strict', t => {
  for (const devSchemaRecovery of [undefined, false]) {
    const store = create({ title: 'Hello {name}' }, { devSchemaRecovery });
    t.after(() => store.dispose());
    store.t('demo:title', { name: 'Ada' });
    store.replaceCatalogs([catalog({ title: 'Hello {name} {extra}' })]);
    assert.throws(() => store.t('demo:title', { name: 'Ada' }), InvalidArgumentError);
    store.replaceCatalogs([catalog({ keep: 'Keep' })]);
    assert.throws(() => store.t('demo:title', { name: 'Ada' }), UnknownMessageError);
  }
  const store = create({ count: '{n, number}', unseen: 'Unseen' }, { devSchemaRecovery: { onDiagnostic() {} } });
  t.after(() => store.dispose());
  store.t('demo:count', { n: 1 });
  store.replaceCatalogs([catalog({ count: '{n, number} {extra}' })]);
  assert.throws(() => store.t('demo:count', { n: 'wrong' }), InvalidArgumentError);
  assert.throws(() => store.t('demo:count', { n: 1, extra: false }), InvalidArgumentError);
  store.replaceCatalogs([catalog({ count: '{n, number} {first} {second, number}' })]);
  assert.throws(() => store.t('demo:count', { n: 1, second: 'wrong' }), InvalidArgumentError);
  assert.equal(store.t('demo:count', { n: 2 }), '2');
  assert.throws(() => store.t('demo:unseen'), UnknownMessageError);
  assert.throws(() => store.t('demo:unknown'), UnknownMessageError);
  assert.throws(() => store.t('other:title'), NamespaceNotLoadedError);
});

test('old snapshots cannot learn future recovery messages or overwrite repaired history', t => {
  const store = create({ title: 'First {name}' }, { devSchemaRecovery: { onDiagnostic() {} } });
  t.after(() => store.dispose());
  const first = store.getSnapshot(); first.t('demo:title', { name: 'Ada' });
  store.replaceCatalogs([catalog({ title: 'Second {name} {extra}' })]);
  const second = store.getSnapshot();
  assert.equal(second.t('demo:title', { name: 'Lin' }), 'First Lin');
  store.t('demo:title', { name: 'Lin', extra: 'X' });
  first.t('demo:title', { name: 'Old read' });
  store.replaceCatalogs([catalog({ keep: 'Keep' })]);
  assert.equal(store.t('demo:title', { name: 'Max', extra: 'Y' }), 'Second Max Y');
  assert.equal(second.t('demo:title', { name: 'Max' }), 'First Max');
});

test('history eviction, locale separation and custom error policy ordering remain explicit', t => {
  const store = create({ a: 'A', b: 'B' }, { devSchemaRecovery: { maxEntries: 1, onDiagnostic() {} },
    onMissingKey: () => 'custom' });
  t.after(() => store.dispose()); store.t('demo:a'); store.t('demo:b');
  store.replaceCatalogs([catalog({ keep: 'Keep' })]);
  assert.equal(store.t('demo:a'), 'custom'); assert.equal(store.t('demo:b'), 'B');
  const localized = createStore({ baseLocale: 'en', locale: 'en',
    catalogs: [catalog({ title: 'Hello {name}' }), catalog({ title: 'Bonjour {name}' }, 'fr')],
    devSchemaRecovery: { onDiagnostic() {} } });
  t.after(() => localized.dispose()); localized.t('demo:title', { name: 'Ada' });
  localized.replaceCatalogs([catalog({ title: 'Hello {name} {extra}' }), catalog({ title: 'Bonjour {name}' }, 'fr')]);
  localized.setLocale('fr');
  assert.throws(() => localized.t('demo:title', { name: 'Lin' }), InvalidArgumentError);
});

function lazyFixture(options) {
  let version = 1, current = catalog({ title: 'Hello {name}', keep: 'Keep' });
  const outcome = () => ({ sessionId: 'recovery', status: 'present', key: { locale: 'en', namespace: 'demo' },
    catalogVersion: version, namespaceSchemaFingerprint: createBaseSchema(current).fingerprint, catalog: current });
  const source = { readManifest: () => {
    const { catalog, sessionId, ...metadata } = outcome();
    return { sessionId, registryRevision: version, baseLocale: 'en', availableLocales: ['en'], availableNamespaces: ['demo'], catalogs: [metadata] };
  }, loadCatalog: async () => outcome() };
  return { source, create: extra => createI18n({ catalogSource: source, locale: 'en', initialNamespaces: ['demo'],
    initialCatalogs: [outcome()], ...options, ...extra }), update(messages) { current = catalog(messages); version++; } };
}

test('lazy updates retain text and boot data carries neither history nor recovery configuration', async t => {
  const f = lazyFixture({ devSchemaRecovery: { onDiagnostic() {} } }), instance = f.create();
  t.after(() => instance.dispose());
  instance.t('demo:title', { name: 'PRIVATE_INPUT' });
  f.update({ title: 'New {name} {extra}', keep: 'Keep' }); await instance.refresh();
  assert.equal(instance.t('demo:title', { name: 'Lin' }), 'Hello Lin');
  instance.setPseudoLocale('long');
  assert.equal(instance.t('demo:title', { name: 'Lin' }), '［Hello～～～～～］ Lin');
  const json = serializeBootSnapshot(instance.getBootSnapshot());
  assert.equal(json.includes('PRIVATE_INPUT'), false); assert.equal(json.includes('devSchemaRecovery'), false);
  assert.equal(json.includes('Hello'), false);
  const restored = createI18n({ catalogSource: f.source, initialSnapshot: decodeBootSnapshot(json) });
  t.after(() => restored.dispose());
  assert.throws(() => restored.t('demo:title', { name: 'Lin' }), InvalidArgumentError);
  f.update({ keep: 'Keep' }); await instance.refresh();
  assert.match(instance.t('demo:title', { name: 'Max' }), /Max/);
  await instance.setNamespaces([]);
  assert.throws(() => instance.t('demo:title', { name: 'Max' }), NamespaceNotLoadedError);
});
