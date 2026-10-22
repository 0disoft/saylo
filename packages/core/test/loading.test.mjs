import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptOutcome } from '../dist/loading-registry.js';
import { scheduler } from '../../../scripts/test/helpers/scheduler.mjs';
import { CatalogLoadError, I18nDisposedError, NamespaceNotLoadedError, SupersededRequestError,
  UnknownMessageError, createBaseSchema, createI18n, parseCatalog, validateCatalogManifest } from '@0disoft/saylo-core';

const catalog = (text, locale = 'ko', namespace = 'common') => parseCatalog(JSON.stringify({ title: text }), { locale, namespace });
const id = (locale, namespace) => `${locale}/${namespace}`;
const tick = () => new Promise(resolve => setImmediate(resolve));

test('replacing required scope releases a locale switch from a previous screen and keeps cached pairs', { timeout: 2000 }, async t => {
  const { i18n, calls, defer } = fixture(t);
  await i18n.loadNamespace('cart');
  const previous = i18n.getSnapshot();
  const slow = defer('en', 'common');
  const locale = i18n.setLocale('en');
  await tick();
  const requested = ['cart'];
  const scope = i18n.setNamespaces(requested);
  requested.push('common'); // The caller does not own the internal desired scope.
  await Promise.all([locale, scope]);
  assert.equal(i18n.getSnapshot().locale, 'en');
  assert.deepEqual(i18n.getSnapshot().loadedNamespaces, ['cart']);
  assert.throws(() => i18n.t('common:title'), NamespaceNotLoadedError);
  assert.equal(previous.t('common:title'), '기준');
  slow.release(); await tick();
  assert.deepEqual(i18n.getSnapshot().loadedNamespaces, ['cart']);
  const count = calls.length;
  await i18n.setNamespaces(['common', 'cart']);
  assert.equal(calls.length, count);
  assert.equal(i18n.t('common:title'), 'English');
});

test('scope replacement rejects displaced scope and namespace waits while preserving compatible locale waits', async t => {
  const { i18n, defer } = fixture(t);
  const slow = defer('ko', 'cart');
  const namespace = assert.rejects(i18n.loadNamespace('cart'), { code: 'SCOPE_SUPERSEDED' });
  const scope = assert.rejects(i18n.setNamespaces(['common', 'cart']), { code: 'SCOPE_SUPERSEDED' });
  await tick();
  await i18n.setNamespaces([]);
  await Promise.all([namespace, scope]);
  assert.deepEqual(i18n.getSnapshot().loadedNamespaces, []);
  slow.release(); await tick();
  assert.deepEqual(i18n.getSnapshot().loadedNamespaces, []);
  await i18n.setNamespaces(['cart']);
  assert.equal(i18n.t('cart:title'), '장바구니');
});

test('invalid and pre-aborted scope replacements are atomic; equivalent scopes coalesce', async t => {
  const { i18n, calls } = fixture(t);
  const before = i18n.getSnapshot();
  for (const value of [null, 'common', ['common', 'common'], ['cart', 'missing'], ['cart', '../bad']])
    await assert.rejects(i18n.setNamespaces(value));
  const controller = new AbortController(); controller.abort('navigation');
  await assert.rejects(i18n.setNamespaces(['cart'], { signal: controller.signal }), { code: 'ABORTED' });
  assert.equal(calls.length, 0);
  assert.equal(i18n.getSnapshot(), before);
  await Promise.all([i18n.setNamespaces(['cart', 'common']), i18n.setNamespaces(['common', 'cart'])]);
  assert.deepEqual(i18n.getSnapshot().loadedNamespaces, ['cart', 'common']);
  assert.equal(calls.filter(c => c.namespace === 'cart').length, 1);
  i18n.dispose();
  await assert.rejects(i18n.setNamespaces([]), I18nDisposedError);
});

test('individual cancellation retains a shared load and removes its listener', async t => {
  const { i18n, calls, defer } = fixture(t);
  const slow = defer('en', 'common');
  const controller = new AbortController();
  const removed = t.mock.method(controller.signal, 'removeEventListener');
  const first = i18n.setLocale('en', { signal: controller.signal });
  const cancelled = assert.rejects(first, error => error.code === 'ABORTED' && error.cause === 'caller stopped');
  const second = i18n.setLocale('en');
  await tick(); controller.abort('caller stopped'); await cancelled;
  const load = calls.find(call => call.locale === 'en');
  assert.equal(load.signal.aborted, false);
  assert.equal(removed.mock.callCount(), 1);
  slow.release(); await second;
  assert.equal(i18n.getSnapshot().locale, 'en');
  assert.equal(calls.filter(call => call.locale === 'en').length, 1);
});

test('pre-aborted callers do not change desired state or start loads', async t => {
  const { i18n, calls } = fixture(t);
  const controller = new AbortController(); controller.abort('stop');
  await assert.rejects(i18n.setLocale('en', { signal: controller.signal }), { code: 'ABORTED', cause: 'stop' });
  await assert.rejects(i18n.loadNamespace('cart', { signal: controller.signal }), { code: 'ABORTED' });
  await assert.rejects(i18n.refresh({ signal: controller.signal }), { code: 'ABORTED' });
  await tick(); assert.equal(calls.length, 0); assert.equal(i18n.getSnapshot().locale, 'ko');
});

test('abort during a commit observer cannot reject an already committed caller', async t => {
  const { i18n } = fixture(t);
  const controller = new AbortController();
  const removed = t.mock.method(controller.signal, 'removeEventListener');
  i18n.subscribe(() => controller.abort());
  await i18n.setLocale('en', { signal: controller.signal });
  assert.equal(i18n.getSnapshot().locale, 'en');
  assert.equal(removed.mock.callCount(), 1);
});

test('lifetime abort disposes owned flights and cleans its listener exactly once', async t => {
  const controller = new AbortController();
  const removed = t.mock.method(controller.signal, 'removeEventListener');
  const { i18n, calls, defer } = fixture(t, { signal: controller.signal });
  const slow = defer('en', 'common');
  const pending = assert.rejects(i18n.setLocale('en'), I18nDisposedError);
  await tick(); controller.abort(); await pending;
  assert.equal(calls.find(call => call.locale === 'en').signal.aborted, true);
  assert.equal(removed.mock.callCount(), 1);
  slow.release(); i18n.dispose(); assert.equal(removed.mock.callCount(), 1);
  await assert.rejects(i18n.refresh(), I18nDisposedError);
});

test('fractional timeout normalization and exact timeout boundary use injected timers', async t => {
  const clock = scheduler();
  const { i18n, handlers, calls } = fixture(t, { requestTimeoutMs: 1.5, schedule: clock.schedule });
  handlers.set('en/common', () => new Promise(() => {}));
  const timedOut = assert.rejects(i18n.setLocale('en'), { code: 'TIMEOUT' });
  await tick(); clock.tick(1); assert.equal(calls.at(-1).signal.aborted, false);
  clock.tick(1); await timedOut;
  assert.equal(calls.at(-1).signal.reason.code, 'TIMEOUT'); assert.equal(clock.size, 0);
  assert.equal(i18n.getSnapshot().locale, 'ko');
});

test('timeout duration accepts only finite positive timer range', t => {
  const f = fixture(t), clock = scheduler();
  for (const requestTimeoutMs of [-1, 0, NaN, Infinity, 2147483648])
    assert.throws(() => createI18n({ ...f.config, requestTimeoutMs }), RangeError);
  for (const requestTimeoutMs of [Number.MIN_VALUE, 1, 1.5, 2147483647]) {
    const instance = createI18n({ ...f.config, requestTimeoutMs, schedule: clock.schedule }); instance.dispose();
  }
  const controller = new AbortController(); controller.abort('before creation');
  assert.throws(() => createI18n({ ...f.config, signal: controller.signal }), { code: 'ABORTED', cause: 'before creation' });
});

test('manifest membership rejects duplicate lists and unavailable present pairs while retaining retired tombstones', t => {
  const { source } = fixture(t);
  const manifest = source.readManifest();
  for (const invalid of [
    { ...manifest, availableLocales: [...manifest.availableLocales, manifest.availableLocales[0]] },
    { ...manifest, availableNamespaces: [...manifest.availableNamespaces, manifest.availableNamespaces[0]] },
    { ...manifest, availableLocales: manifest.availableLocales.filter(locale => locale !== 'ko') },
    { ...manifest, catalogs: [...manifest.catalogs, { ...manifest.catalogs[0], key: { locale: 'ja', namespace: 'common' } }] },
    { ...manifest, catalogs: [...manifest.catalogs, { ...manifest.catalogs[0], key: { locale: 'ko', namespace: 'retired' } }] },
  ]) assert.throws(() => validateCatalogManifest(invalid), { code: 'INVALID_MANIFEST' });
  const tombstone = { status: 'missing', key: { locale: 'ja', namespace: 'retired' }, catalogVersion: 2 };
  const accepted = validateCatalogManifest({ ...manifest, catalogs: [...manifest.catalogs, tombstone] });
  assert.deepEqual(accepted.catalogs.find(meta => meta.status === 'missing'), tombstone);
  assert.deepEqual(accepted.availableLocales, [...manifest.availableLocales].sort());
  assert.deepEqual(accepted.availableNamespaces, [...manifest.availableNamespaces].sort());
});

test('new pair versions with identical text keep the snapshot; schema and text changes still publish', async t => {
  const { i18n, change } = fixture(t);
  await i18n.setLocale('en');
  const before = i18n.getSnapshot();
  change('en', 'common', 'English');
  await i18n.refresh();
  assert.equal(i18n.getSnapshot(), before);
  change('ko', 'common', '기준 {name}');
  await i18n.refresh();
  const schemaChanged = i18n.getSnapshot();
  assert.notEqual(schemaChanged, before);
  assert.equal(schemaChanged.t('common:title', { name: 'test' }), 'English');
  change('en', 'common', 'Hello {name}');
  await i18n.refresh();
  assert.equal(i18n.t('common:title', { name: 'test' }), 'Hello test');
  assert.equal(schemaChanged.t('common:title', { name: 'test' }), 'English');
});

function fixture(t, options = {}) {
  const records = new Map([
    ['ko/common', catalog('기준')], ['en/common', catalog('English', 'en')], ['fr/common', catalog('Français', 'fr')],
    ['ko/cart', catalog('장바구니', 'ko', 'cart')], ['en/cart', catalog('Cart', 'en', 'cart')],
  ]);
  let sessionId = 'one';
  let registryRevision = 0;
  const versions = new Map([...records.keys()].map(k => [k, 1]));
  const source = {
    readManifest() {
      const namespaces = [...new Set([...records.values()].filter(c => c.locale === 'ko').map(c => c.namespace))].sort();
      const availableLocales = [...new Set([...records.values()].filter(c => namespaces.includes(c.namespace)).map(c => c.locale))].sort();
      return { sessionId, registryRevision, baseLocale: 'ko', availableLocales, availableNamespaces: namespaces,
        catalogs: [...versions].map(([key, catalogVersion]) => {
          const [locale, namespace] = key.split('/');
          const record = records.get(key);
          return { key: { locale, namespace }, catalogVersion, ...(record && namespaces.includes(namespace)
            ? { status: 'present', namespaceSchemaFingerprint: createBaseSchema(records.get(`ko/${namespace}`)).fingerprint }
            : { status: 'missing' }) };
        }) };
    },
    async loadCatalog(locale, namespace, signal) {
      calls.push({ locale, namespace, signal });
      const result = outcome(locale, namespace);
      const hook = handlers.get(id(locale, namespace));
      return hook ? hook(result, signal) : result;
    },
  };
  function outcome(locale, namespace) {
    const key = { locale, namespace };
    const record = records.get(id(locale, namespace));
    const base = records.get(id('ko', namespace));
    return { sessionId, key, catalogVersion: versions.get(id(locale, namespace)) ?? 0,
      ...(record && base ? { status: 'present', namespaceSchemaFingerprint: createBaseSchema(base).fingerprint, catalog: record } : { status: 'missing' }) };
  }
  const calls = [];
  const handlers = new Map();
  const config = { catalogSource: source, locale: 'ko', initialNamespaces: ['common'], initialCatalogs: [outcome('ko', 'common')], ...options };
  const i18n = createI18n(config);
  t.after(() => i18n.dispose());
  const change = (locale, namespace, text) => {
    const key = id(locale, namespace);
    text === undefined ? records.delete(key) : records.set(key, catalog(text, locale, namespace));
    versions.set(key, (versions.get(key) ?? 0) + 1);
    registryRevision++;
  };
  const restart = () => { sessionId = 'two'; registryRevision = 0; };
  const defer = (locale, namespace) => {
    let resolve;
    let captured;
    const promise = new Promise(yes => { resolve = yes; });
    handlers.set(id(locale, namespace), result => { captured = result; return promise; });
    return { release(result = captured) { handlers.delete(id(locale, namespace)); resolve(result); } };
  };
  return { i18n, source, calls, handlers, change, restart, defer, outcome, config };
}

test('lazy scope publishes atomically, retains old translators, and reuses loaded pairs', async t => {
  const { i18n, calls, defer } = fixture(t);
  const before = i18n.getSnapshot();
  assert.throws(() => i18n.t('cart:title'), NamespaceNotLoadedError);
  assert.throws(() => i18n.t('unknown:title'), UnknownMessageError);
  const slow = defer('en', 'common');
  const seen = [];
  i18n.subscribe(s => seen.push([s.locale, s.loadedNamespaces.join(','), s.t('cart:title')]));
  const locale = i18n.setLocale('en');
  await tick();
  const namespace = i18n.loadNamespace('cart');
  await tick();
  assert.equal(i18n.getSnapshot(), before);
  slow.release();
  await Promise.all([locale, namespace]);
  assert.deepEqual(seen, [['en', 'cart,common', 'Cart']]);
  assert.equal(before.t('common:title'), '기준');
  assert.equal(i18n.t('common:title'), 'English');
  assert.equal(calls.filter(c => c.locale === 'en' && c.namespace === 'common').length, 1);
  const after = i18n.getSnapshot();
  await i18n.setLocale('ko');
  const loaded = calls.length;
  await i18n.setLocale('en');
  assert.equal(calls.length, loaded);
  assert.equal(i18n.getSnapshot().stateRevision, after.stateRevision + 2);
  assert.ok(Object.isFrozen(after.loadedNamespaces));
});

test('superseded locale rejects only that intent and does not wait for its obsolete slow load', async t => {
  const { i18n, defer } = fixture(t);
  const slow = defer('en', 'common');
  const en = i18n.setLocale('en');
  const cancelled = assert.rejects(en, SupersededRequestError);
  const ns = i18n.loadNamespace('cart');
  await tick();
  await i18n.setLocale('fr');
  await Promise.all([cancelled, ns]);
  assert.equal(i18n.t('common:title'), 'Français');
  assert.equal(i18n.t('cart:title'), '장바구니'); // Explicit missing secondary uses base fallback.
  slow.release();
  await tick();
  assert.equal(i18n.getSnapshot().locale, 'fr');
});

test('failed lookup leaves the exact UI snapshot intact and a retry can reuse successful pairs', async t => {
  const { i18n, handlers, calls } = fixture(t);
  const before = i18n.getSnapshot();
  handlers.set('en/cart', () => ({ status: 'failed', code: 'OFFLINE', message: 'Network unavailable' }));
  const locale = i18n.setLocale('en');
  const namespace = i18n.loadNamespace('cart');
  await Promise.all([assert.rejects(locale, e => e instanceof CatalogLoadError && e.code === 'OFFLINE'), assert.rejects(namespace, CatalogLoadError)]);
  assert.equal(i18n.getSnapshot(), before);
  handlers.delete('en/cart');
  await i18n.loadNamespace('cart');
  assert.equal(i18n.getSnapshot().locale, 'ko');
  await i18n.setLocale('en');
  assert.equal(i18n.t('cart:title'), 'Cart');
  assert.equal(calls.filter(c => c.locale === 'ko' && c.namespace === 'cart').length, 1);
});

test('load exceptions and timeout are failures rather than missing catalogs', async t => {
  const { i18n, handlers } = fixture(t, { requestTimeoutMs: 10 });
  handlers.set('en/common', () => { throw new Error('socket closed'); });
  await assert.rejects(i18n.setLocale('en'), e => e instanceof CatalogLoadError && e.code === 'LOAD_FAILED' && e.cause.message === 'socket closed');
  let signal;
  handlers.set('en/common', (_, received) => { signal = received; return new Promise(() => {}); });
  await assert.rejects(i18n.setLocale('en'), e => e instanceof CatalogLoadError && e.code === 'TIMEOUT');
  assert.equal(signal.aborted, true);
  assert.equal(i18n.getSnapshot().locale, 'ko');
});

test('a changed pair version discards the slow response while an unrelated namespace revision does not', async t => {
  const { i18n, defer, change, calls } = fixture(t);
  const slow = defer('en', 'common');
  const pending = i18n.setLocale('en');
  await tick();
  change('ko', 'cart', '새 장바구니');
  slow.release();
  await pending;
  assert.equal(calls.filter(c => c.locale === 'en' && c.namespace === 'common').length, 1);
  await i18n.setLocale('ko');
  change('en', 'common', '수정 전');
  const nextSlow = defer('en', 'common');
  const next = i18n.setLocale('en');
  await tick();
  change('en', 'common', '최신 문구');
  nextSlow.release();
  await next;
  assert.equal(i18n.t('common:title'), '최신 문구');
});

test('refresh invalidates pending session loads and old session results cannot overwrite the new snapshot', async t => {
  const { i18n, defer, restart } = fixture(t);
  const slow = defer('en', 'common');
  const locale = i18n.setLocale('en');
  await tick();
  restart();
  slow.release();
  await Promise.all([locale, i18n.refresh()]);
  assert.equal(i18n.t('common:title'), 'English');
  assert.equal(i18n.getSnapshot().locale, 'en');
});

test('deleted secondary tombstone prevents late resurrection and falls back to base', async t => {
  const { i18n, defer, change } = fixture(t);
  const slow = defer('en', 'common');
  const locale = i18n.setLocale('en');
  await tick();
  change('en', 'common');
  // Keep en in the locale manifest through its cart catalog.
  slow.release();
  await Promise.all([locale, i18n.refresh()]);
  assert.equal(i18n.getSnapshot().locale, 'en');
  assert.equal(i18n.t('common:title'), '기준');
});

test('manifest additions are available to the generic loader and removals retire loaded namespaces', async t => {
  const { i18n, change } = fixture(t);
  change('ko', 'help', '도움말');
  change('en', 'help', 'Help');
  await i18n.refresh();
  assert.deepEqual(i18n.getNamespaces(), ['cart', 'common', 'help']);
  await Promise.all([i18n.loadNamespace('help'), i18n.setLocale('en')]);
  assert.equal(i18n.t('help:title'), 'Help');
  change('ko', 'help');
  change('en', 'help');
  await i18n.refresh();
  assert.throws(() => i18n.t('help:title'), UnknownMessageError);
  assert.deepEqual(i18n.getSnapshot().loadedNamespaces, ['common']);
});

test('removing the current locale selects base and empty loaded scope can be repopulated', async t => {
  const { i18n, change } = fixture(t);
  await i18n.setLocale('en');
  change('en', 'common');
  change('en', 'cart');
  await i18n.refresh();
  assert.equal(i18n.getSnapshot().locale, 'ko');
  change('ko', 'common');
  change('fr', 'common');
  await i18n.refresh();
  assert.deepEqual(i18n.getSnapshot().loadedNamespaces, []);
  assert.throws(() => i18n.t('cart:title'), NamespaceNotLoadedError);
  await i18n.loadNamespace('cart');
  assert.equal(i18n.t('cart:title'), '장바구니');
});

test('incompatible translations do not publish a mixed schema candidate', async t => {
  const { i18n, change } = fixture(t);
  change('en', 'common', '{n, number}');
  const before = i18n.getSnapshot();
  await assert.rejects(i18n.setLocale('en'));
  assert.equal(i18n.getSnapshot(), before);
  change('en', 'common', 'Recovered');
  await i18n.setLocale('en');
  assert.equal(i18n.t('common:title'), 'Recovered');
});

test('initial multi-namespace outcomes can arrive out of order but must belong to the requested scope', t => {
  const { config, outcome } = fixture(t);
  const options = { ...config, locale: 'en', initialNamespaces: ['cart', 'common'],
    initialCatalogs: [outcome('en', 'common'), outcome('ko', 'cart'), outcome('en', 'cart'), outcome('ko', 'common')] };
  const instance = createI18n(options);
  t.after(() => instance.dispose());
  assert.equal(instance.t('common:title'), 'English');
  assert.equal(instance.t('cart:title'), 'Cart');
  assert.deepEqual(instance.getSnapshot().loadedNamespaces, ['cart', 'common']);
  assert.throws(() => createI18n({ ...options,
    initialCatalogs: [...options.initialCatalogs, outcome('fr', 'common')] }), /Unexpected or duplicate initial/);
  assert.throws(() => createI18n({ ...options,
    initialCatalogs: [...options.initialCatalogs.slice(0, 3), outcome('ko', 'cart')] }), /Unexpected or duplicate initial/);
});

test('initial scope must explicitly contain every outcome and matching schema metadata', t => {
  const { config, outcome } = fixture(t);
  assert.throws(() => createI18n({ ...config, locale: 'fr', initialCatalogs: [outcome('ko', 'common')] }), /every base and target/);
  assert.throws(() => createI18n({ ...config, initialCatalogs: [...config.initialCatalogs, ...config.initialCatalogs] }), /duplicate initial/);
  assert.throws(() => createI18n({ ...config, initialCatalogs: [{ ...config.initialCatalogs[0], namespaceSchemaFingerprint: 'wrong' }] }), CatalogLoadError);
  assert.throws(() => createI18n({ ...config, initialNamespaces: ['common', 'common'] }), /Duplicate initial/);
  const empty = createI18n({ ...config, initialNamespaces: [], initialCatalogs: [] });
  t.after(() => empty.dispose());
  assert.throws(() => empty.t('common:title'), NamespaceNotLoadedError);
});

test('dispose rejects pending callers, aborts owned loads, and cleans up every listener once', async t => {
  const { i18n, defer, calls } = fixture(t);
  const slow = defer('en', 'common');
  const pending = i18n.setLocale('en');
  const rejected = assert.rejects(pending, I18nDisposedError);
  await tick();
  let cleanups = 0;
  i18n.onDispose(() => { cleanups++; throw new Error('cleanup failure'); });
  i18n.onDispose(() => cleanups++);
  const before = i18n.getSnapshot();
  assert.throws(() => i18n.dispose(), AggregateError);
  await rejected;
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(cleanups, 2);
  slow.release();
  await tick();
  i18n.dispose();
  assert.equal(i18n.getSnapshot(), before);
  await assert.rejects(i18n.loadNamespace('cart'), I18nDisposedError);
});

test('subscriber failures retain the commit and reentrant selections leave completed intents resolved', async t => {
  const { i18n } = fixture(t);
  const seen = [];
  let next;
  i18n.subscribe(s => {
    seen.push(`A:${s.locale}`);
    if (s.locale === 'en') next = i18n.setLocale('fr');
  });
  i18n.subscribe(s => seen.push(`B:${s.locale}`));
  await i18n.setLocale('en');
  await next;
  assert.deepEqual(seen, ['A:en', 'B:en', 'A:fr', 'B:fr']);
  const unsubscribe = i18n.subscribe(() => { throw new Error('render failed'); });
  await assert.rejects(i18n.setLocale('ko'), AggregateError);
  assert.equal(i18n.getSnapshot().locale, 'ko');
  unsubscribe();
  const before = i18n.getSnapshot();
  await i18n.refresh();
  assert.equal(i18n.getSnapshot(), before);
});

test('persistent stale results stop after three attempts without changing the UI', async t => {
  const { i18n, handlers, calls } = fixture(t);
  const before = i18n.getSnapshot();
  handlers.set('en/common', result => ({ ...result, catalogVersion: 0 }));
  await assert.rejects(i18n.setLocale('en'), e => e instanceof CatalogLoadError && e.code === 'STALE_CATALOG');
  assert.equal(calls.length, 3);
  assert.equal(i18n.getSnapshot(), before);
});

test('manifest revisions, known pair versions and deletion tombstones cannot move backwards', async t => {
  const { i18n, source, change } = fixture(t);
  const read = source.readManifest;
  const initial = read();
  change('en', 'common');
  await i18n.refresh();
  const before = i18n.getSnapshot();
  const deleted = read();
  source.readManifest = () => ({ ...deleted, registryRevision: deleted.registryRevision + 1,
    catalogs: deleted.catalogs.filter(c => c.key.locale !== 'en' || c.key.namespace !== 'common') });
  await assert.rejects(i18n.refresh(), e => e instanceof CatalogLoadError && e.code === 'STALE_MANIFEST');
  assert.equal(i18n.getSnapshot(), before);
  source.readManifest = () => initial;
  await assert.rejects(i18n.refresh(), e => e instanceof CatalogLoadError && e.code === 'STALE_MANIFEST');
  assert.equal(i18n.getSnapshot(), before);
});

test('a retired source session is rejected rather than rolling back the UI', async t => {
  const { i18n, source, restart } = fixture(t);
  const old = source.readManifest();
  restart();
  await i18n.refresh();
  const before = i18n.getSnapshot();
  source.readManifest = () => old;
  await assert.rejects(i18n.refresh(), e => e instanceof CatalogLoadError && e.code === 'STALE_MANIFEST');
  assert.equal(i18n.getSnapshot(), before);
});


test('accepted mutable outcomes remain independent of source changes and preserve literal IDs', () => {
  const parsed = parseCatalog('{"__proto__":"Hello {name}"}', { locale: 'ko', namespace: 'common' });
  const key = { locale: 'ko', namespace: 'common' };
  const namespaceSchemaFingerprint = createBaseSchema(parsed).fingerprint;
  const manifest = validateCatalogManifest({ sessionId: 'ownership', registryRevision: 0, baseLocale: 'ko',
    availableLocales: ['ko'], availableNamespaces: ['common'],
    catalogs: [{ key, status: 'present', catalogVersion: 1, namespaceSchemaFingerprint }] });
  const input = { sessionId: 'ownership', key, status: 'present', catalogVersion: 1,
    namespaceSchemaFingerprint, catalog: structuredClone(parsed) };
  const accepted = acceptOutcome(manifest, key, input);
  input.catalog.messages.__proto__.source = 'Changed';
  input.catalog.messages.__proto__.arguments.name.acceptedTypes.push('date');
  input.key.namespace = 'changed';
  assert.equal(accepted.key.namespace, 'common');
  assert.equal(accepted.catalog.messages.__proto__.source, 'Hello {name}');
  assert.deepEqual(accepted.catalog.messages.__proto__.arguments.name.acceptedTypes, ['string', 'number']);
  assert.ok(Object.isFrozen(accepted.catalog.messages.__proto__.ast));
  assert.equal(Object.hasOwn(accepted.catalog.messages, '__proto__'), true);
  assert.equal(acceptOutcome(manifest, accepted.key, { ...accepted, catalog: parsed }).catalog, parsed);
});
