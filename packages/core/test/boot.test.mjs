import assert from 'node:assert/strict';
import test from 'node:test';
import { createBaseSchema, createBootSnapshot, createI18n, createServerI18n, decodeBootSnapshot, parseCatalog, serializeBootSnapshot } from '@0disoft/saylo-core';

function fixture() {
  const parse = (locale, namespace, messages) => parseCatalog(JSON.stringify(messages), { locale, namespace, sourceName: `${locale}/${namespace}.json` });
  const records = [parse('ko', 'demo', { title: '</script><script>bad</script>\u2028\u2029', when: '{at, date, short}', '__proto__.title': 'literal' }),
    parse('en', 'demo', { title: 'English' }), parse('ko', 'help', { title: '도움말' })];
  let revision = 0;
  const manifest = () => ({ sessionId: 'server', registryRevision: revision, baseLocale: 'ko',
    availableLocales: ['en', 'ko'], availableNamespaces: ['demo', 'help'], catalogs: records.map(c => ({
      key: { locale: c.locale, namespace: c.namespace }, status: 'present', catalogVersion: c.namespace === 'demo' ? revision + 1 : 1,
      namespaceSchemaFingerprint: createBaseSchema(records.find(b => b.locale === 'ko' && b.namespace === c.namespace)).fingerprint,
    })) });
  const outcome = (locale, namespace) => {
    const meta = manifest().catalogs.find(m => m.key.locale === locale && m.key.namespace === namespace);
    return meta ? { ...meta, sessionId: 'server', catalog: records.find(c => c.locale === locale && c.namespace === namespace) }
      : { status: 'missing', sessionId: 'server', key: { locale, namespace }, catalogVersion: 0 };
  };
  const source = { readManifest: manifest, loadCatalog: async (locale, namespace) => outcome(locale, namespace) };
  const create = (locale = 'en') => createI18n({ catalogSource: source, locale, initialNamespaces: ['demo', 'help'], timeZone: 'Asia/Seoul',
    initialCatalogs: ['demo', 'help'].flatMap(n => [...new Set(['ko', locale])].map(l => outcome(l, n))) });
  return { source, create, outcome, change() { records[0] = parse('ko', 'demo', { title: '최신 문구', when: '{at, date, short}', '__proto__.title': 'literal' }); revision++; } };
}

test('HTML-safe boot JSON restores immutable schemas, pair stamps, fallback and fixed date formatting', t => {
  const f = fixture();
  const server = f.create();
  t.after(() => server.dispose());
  const wire = serializeBootSnapshot(server.getBootSnapshot());
  assert.ok(!wire.includes('<') && !wire.includes('\u2028') && !wire.includes('\u2029'));
  assert.ok(wire.includes('\\u003c/script>'));
  const decoded = decodeBootSnapshot(wire);
  assert.ok(Object.isFrozen(decoded.catalogOutcomes[0].catalog.messages.title.ast));
  assert.equal(decoded.baseSchemas.length, 2);
  assert.equal(decoded.catalogOutcomes.find(o => o.key.locale === 'en' && o.key.namespace === 'help').status, 'missing');
  const client = createI18n({ catalogSource: f.source, initialSnapshot: decoded });
  t.after(() => client.dispose());
  assert.equal(client.getServerSnapshot(), client.getServerSnapshot());
  assert.equal(client.getServerSnapshot(), client.getSnapshot());
  assert.equal(client.t('demo:title'), 'English');
  assert.equal(client.t('help:title'), '도움말');
  assert.equal(client.t('demo:__proto__.title'), 'literal');
  assert.equal(client.t('demo:when', { at: new Date('2026-01-01T16:00:00Z') }), server.t('demo:when', { at: new Date('2026-01-01T16:00:00Z') }));
  assert.equal(decoded.catalogOutcomes[0].catalog.sourceName, 'ko/demo.json');
});

test('boot pair and schema order do not change canonical hydration data', t => {
  const server = fixture().create();
  t.after(() => server.dispose());
  const original = serializeBootSnapshot(server.getBootSnapshot());
  const reordered = JSON.parse(original);
  reordered.catalogOutcomes.reverse();
  reordered.baseSchemas.reverse();
  reordered.loadedNamespaces.reverse();
  const decoded = decodeBootSnapshot(JSON.stringify(reordered));
  assert.equal(serializeBootSnapshot(decoded), original);
  assert.equal(decoded.catalogOutcomes.find(outcome => outcome.key.locale === 'en' && outcome.key.namespace === 'help').status, 'missing');
});

test('boot decode rejects omissions, duplicates, wrong stamps, schema content and version', t => {
  const server = fixture().create();
  t.after(() => server.dispose());
  const original = serializeBootSnapshot(server.getBootSnapshot());
  const corrupt = modify => { const value = JSON.parse(original); modify(value); assert.throws(() => decodeBootSnapshot(JSON.stringify(value)), { code: 'INVALID_BOOT' }); };
  corrupt(b => b.catalogOutcomes.pop());
  corrupt(b => b.catalogOutcomes.push(b.catalogOutcomes[0]));
  corrupt(b => b.catalogOutcomes[1] = b.catalogOutcomes[0]);
  corrupt(b => b.catalogOutcomes[0].sessionId = 'wrong');
  corrupt(b => b.catalogOutcomes[0].catalogVersion++);
  corrupt(b => b.baseSchemas[0].keys.when = {});
  corrupt(b => b.baseSchemas.push(b.baseSchemas[0]));
  corrupt(b => b.baseSchemas[1] = b.baseSchemas[0]);
  corrupt(b => b.baseSchemas[0] = null);
  corrupt(b => b.format = 'saylo-boot-v2');
  corrupt(b => b.timeZone = 'invalid-zone');
  corrupt(b => b.stateRevision = -1);
  corrupt(b => b.loadedNamespaces.push('demo'));
  assert.throws(() => decodeBootSnapshot('{'), { code: 'INVALID_BOOT' });
  const boot = decodeBootSnapshot(original);
  assert.throws(() => createI18n({ catalogSource: fixture().source, initialSnapshot: boot, timeZone: 'UTC' }), { code: 'INVALID_BOOT' });
});

test('request instances stay isolated and serialized scopes track committed state rather than pending intent', async t => {
  const f = fixture();
  const en = f.create();
  const ko = f.create('ko');
  t.after(() => { en.dispose(); ko.dispose(); });
  const pinned = ko.getServerSnapshot();
  const oldBoot = ko.getBootSnapshot();
  const transition = en.setLocale('ko');
  assert.equal(en.getBootSnapshot().locale, 'en');
  await transition;
  assert.equal(en.getBootSnapshot().locale, 'ko');
  assert.equal(ko.getSnapshot(), pinned);
  f.change();
  await ko.refresh();
  assert.equal(ko.getSnapshot().t('demo:title'), '최신 문구');
  assert.equal(ko.getServerSnapshot(), pinned);
  assert.equal(ko.getBootSnapshot().manifest.registryRevision, 1);
  assert.equal(oldBoot.manifest.registryRevision, 0);
  const hydrate = createI18n({ catalogSource: f.source, initialSnapshot: oldBoot });
  t.after(() => hydrate.dispose());
  assert.equal(hydrate.t('demo:title'), pinned.t('demo:title'));
  await hydrate.refresh();
  assert.equal(hydrate.t('demo:title'), '최신 문구');
  assert.equal(hydrate.getServerSnapshot().t('demo:title'), pinned.t('demo:title'));
  assert.equal(serializeBootSnapshot(hydrate.getBootSnapshot()), serializeBootSnapshot(createBootSnapshot(hydrate.getBootSnapshot())));
});

test('revision exhaustion rejects before changing committed state and preserves boot serialization', async t => {
  const f = fixture(), seed = f.create('ko'); t.after(() => seed.dispose());
  const boot = seed.getBootSnapshot();
  const instance = createI18n({ catalogSource: f.source,
    initialSnapshot: { ...boot, stateRevision: Number.MAX_SAFE_INTEGER - 1 } });
  t.after(() => instance.dispose());
  await instance.setLocale('en');
  assert.equal(instance.getSnapshot().stateRevision, Number.MAX_SAFE_INTEGER);
  await instance.refresh(); // Unchanged state does not consume a revision.
  const committed = instance.getSnapshot(), wire = serializeBootSnapshot(instance.getBootSnapshot());
  await assert.rejects(instance.setLocale('ko'), { code: 'REVISION_OVERFLOW' });
  assert.equal(instance.getSnapshot(), committed);
  assert.equal(serializeBootSnapshot(instance.getBootSnapshot()), wire);
});

test('SSR preparation aborts owned loads without disposing the shared source', async t => {
  const f = fixture(), controller = new AbortController();
  const removed = t.mock.method(controller.signal, 'removeEventListener');
  const started = Promise.withResolvers(); let captured;
  const source = { ...f.source, loadCatalog(_locale, _namespace, signal) { captured = signal; started.resolve(); return new Promise(() => {}); } };
  const pending = assert.rejects(createServerI18n({ catalogSource: source, locale: 'ko', initialNamespaces: ['demo'], signal: controller.signal }),
    { code: 'ABORTED', cause: 'http closed' });
  await started.promise; controller.abort('http closed'); await pending;
  assert.equal(captured.aborted, true); assert.equal(removed.mock.callCount(), 1);
  await assert.rejects(createServerI18n({ catalogSource: source, locale: 'ko', initialNamespaces: ['demo'], signal: controller.signal }), { code: 'ABORTED' });
  const next = await createServerI18n({ catalogSource: f.source, locale: 'ko', initialNamespaces: ['demo'] }); next.dispose();
});

test('SSR request preparation pins the ready scope, retries changed pair stamps, and bounds waiting', async t => {
  const f = fixture();
  let changed = false;
  const source = { ...f.source, async loadCatalog(locale, namespace) {
    if (!changed) { f.change(); changed = true; }
    return f.outcome(locale, namespace);
  } };
  const server = await createServerI18n({ catalogSource: source, locale: 'ko', initialNamespaces: ['demo'], timeZone: 'Asia/Seoul' });
  t.after(() => server.dispose());
  assert.equal(server.getServerSnapshot().t('demo:title'), '최신 문구');
  assert.equal(server.getBootSnapshot().manifest.registryRevision, 1);
  const hanging = { ...source, loadCatalog: () => new Promise(() => {}) };
  await assert.rejects(createServerI18n({ catalogSource: hanging, locale: 'ko', initialNamespaces: ['demo'], requestTimeoutMs: 10 }), { code: 'TIMEOUT' });
  await assert.rejects(createServerI18n({ catalogSource: source, locale: 'ja', initialNamespaces: ['demo'] }), RangeError);
});
