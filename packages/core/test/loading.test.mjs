import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptOutcome } from '../dist/loading-registry.js';
import { CatalogLoader } from '../dist/catalog-loader.js';
import { scheduler } from '../../../scripts/test/helpers/scheduler.mjs';
import { CatalogLoadError, I18nDisposedError, NamespaceNotLoadedError, SupersededRequestError,
  UnknownMessageError, createBaseSchema, createI18n, parseCatalog, validateCatalogManifest } from '@0disoft/saylo-core';

const catalog = (text, locale = 'ko', namespace = 'common') => parseCatalog(JSON.stringify({ title: text }), { locale, namespace });
const id = (locale, namespace) => `${locale}/${namespace}`;
const tick = () => new Promise(resolve => setImmediate(resolve));

test('catalog source concurrency is bounded at the limit and for large scopes', async t => {
  for (const count of [7, 8, 9, 128]) await t.test(`${count} catalog loads`, async t => {
    const { loader, calls, keys, active, peak } = queuedLoader(t, count);
    const pending = keys.map(key => loader.load(key));
    const complete = Promise.all(pending);
    await tick();
    const firstWave = calls.length;
    while (calls.length < count || active()) {
      for (const call of calls) call.resolve();
      await tick();
    }
    const outcomes = await complete;
    assert.equal(firstWave, Math.min(count, 8));
    assert.equal(peak(), Math.min(count, 8));
    assert.deepEqual(outcomes.map(outcome => outcome.key), keys);
    await Promise.all(keys.map(key => loader.load(key)));
    assert.equal(calls.length, count, 'completed catalogs still reuse the cache');
  });
});

test('inactive catalog cache budgets validate and evict least-recently-used outcomes', async t => {
  const load = async (loader, calls, key) => {
    const before = calls.length;
    const pending = loader.load(key);
    await tick();
    if (calls.length > before) calls.at(-1).resolve();
    return pending;
  };
  await t.test('zero, one, and exact capacity', async t => {
    for (const budget of [0, 1, 3]) await t.test(String(budget), async t => {
      const { loader, calls, keys } = queuedLoader(t, 3, { maxCachedCatalogs: budget });
      const complete = Promise.all(keys.map(key => loader.load(key)));
      await tick();
      for (const call of calls) call.resolve();
      await complete;
      const before = calls.length;
      if (budget === 0) {
        for (const key of keys) await load(loader, calls, key);
        assert.equal(calls.length - before, 3);
      } else {
        await load(loader, calls, keys[2]);
        assert.equal(calls.length, before, 'the newest catalog remains cached');
        if (budget === 1) {
          await load(loader, calls, keys[0]);
          assert.equal(calls.length, before + 1, 'a new pair evicts the previous one');
        }
      }
    });
  });

  await t.test('LRU touch and protected entries', async t => {
    const lru = queuedLoader(t, 3, { maxCachedCatalogs: 2 });
    const initial = Promise.all(lru.keys.map(key => lru.loader.load(key)));
    await tick();
    for (const call of lru.calls) call.resolve();
    await initial;
    await load(lru.loader, lru.calls, lru.keys[2]);
    const before = lru.calls.length;
    await load(lru.loader, lru.calls, lru.keys[0]);
    assert.equal(lru.calls.length, before + 1);
    await load(lru.loader, lru.calls, lru.keys[2]);
    assert.equal(lru.calls.length, before + 1, 'touching key 2 spared it from LRU eviction');
    await load(lru.loader, lru.calls, lru.keys[1]);
    assert.equal(lru.calls.length, before + 2, 'key 1 was the least recently used');

    const protectedSet = new Set([JSON.stringify(['en', 'scope0'])]);
    const pinned = queuedLoader(t, 3, { maxCachedCatalogs: 1, protectedKeys: () => protectedSet });
    const loads = Promise.all(pinned.keys.map(key => pinned.loader.load(key)));
    await tick();
    for (const call of pinned.calls) call.resolve();
    await loads;
    const pinnedCalls = pinned.calls.length;
    await load(pinned.loader, pinned.calls, pinned.keys[0]);
    assert.equal(pinned.calls.length, pinnedCalls, 'a protected outcome remains cached beyond the budget');
  });

  for (const invalid of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => queuedLoader(t, 1, { maxCachedCatalogs: invalid }), RangeError);
  }
});

test('a large protected scope has a linear cache bookkeeping budget', async t => {
  const count = 1024;
  class CountingSet extends Set {
    checks = 0;
    has(value) { this.checks++; return super.has(value); }
  }
  const pins = new CountingSet(Array.from({ length: count }, (_, i) => JSON.stringify(['en', `scope${i}`])));
  const f = queuedLoader(t, count, { maxCachedCatalogs: 0, protectedKeys: () => pins });
  f.loader.seed(f.keys.map(key => ({ sessionId: 'one', status: 'missing', key, catalogVersion: 0 })));
  assert.ok(pins.checks <= count * 2, `seeding made ${pins.checks} protection checks`);
  await Promise.all(f.keys.map(key => f.loader.load(key)));
  assert.equal(f.calls.length, 0, 'budget zero must retain every protected catalog');
  assert.ok(pins.checks <= count * 3, 'cache hits must not rescan the protected scope');
});

test('scope changes preserve LRU order when formerly protected entries become evictable', async t => {
  let pins = new Set([0, 1].map(i => JSON.stringify(['en', `scope${i}`])));
  const f = queuedLoader(t, 4, { maxCachedCatalogs: 3, protectedKeys: () => pins });
  f.loader.seed(f.keys.map(key => ({ sessionId: 'one', status: 'missing', key, catalogVersion: 0 })));
  await f.loader.load(f.keys[0]);
  pins = new Set([JSON.stringify(['en', 'scope1'])]);
  f.loader.trim();
  const restored = f.loader.load(f.keys[2]);
  await tick(); f.calls.at(-1).resolve(); await restored;
  await Promise.all([0, 1, 2].map(i => f.loader.load(f.keys[i])));
  assert.equal(f.calls.length, 1, 'recently touched and still-protected pairs survive');
  const oldest = f.loader.load(f.keys[3]);
  await tick(); f.calls.at(-1).resolve(); await oldest;
  assert.equal(f.calls.length, 2, 'the oldest unprotected pair was evicted');
  pins = new Set();
  f.restart();
  const restarted = f.loader.load(f.keys[3]);
  await tick(); f.calls.at(-1).resolve();
  assert.equal((await restarted).sessionId, 'two', 'invalidation must also retire candidate entries');
});

test('disposal cancels queued loads before they reach the source and clears timers', async t => {
  const { loader, calls, keys, clock } = queuedLoader(t);
  const pending = Promise.allSettled(keys.map(key => loader.load(key)));
  await tick();
  const reason = new I18nDisposedError();
  loader.stop(reason);
  const results = await pending;
  assert.ok(results.every(result => result.status === 'rejected' && result.reason === reason));
  assert.ok(calls.every(call => call.signal.aborted));
  assert.equal(clock.size, 0);
  for (const call of calls) call.resolve();
  await tick();
  assert.equal(calls.length, 8, 'the queued ninth catalog never starts');
});

test('timeouts retain source slots until ignored aborts actually settle', async t => {
  const { loader, calls, keys, clock, peak } = queuedLoader(t, 9, { maxCachedCatalogs: 0 });
  const expired = Promise.allSettled(keys.map(key => loader.load(key)));
  await tick();
  clock.tick(100);
  assert.ok((await expired).every(result => result.status === 'rejected' && result.reason.code === 'TIMEOUT'));
  assert.equal(clock.size, 0);
  const retry = loader.load(keys[8]);
  await tick();
  assert.equal(calls.length, 8, 'timeout cannot release unfinished physical source calls');
  calls[0].reject(new Error('late rejection after timeout'));
  await tick();
  assert.equal(calls.length, 9);
  calls[8].resolve();
  await retry;
  for (const call of calls) call.resolve();
  await tick();
  assert.equal(peak(), 8);
  assert.equal(clock.size, 0);
});

test('manifest generations share the same source limit and deduplicate queued loads', async t => {
  const { loader, calls, keys, restart, peak } = queuedLoader(t);
  const stale = Promise.allSettled(keys.map(key => loader.load(key)));
  await tick();
  restart();
  assert.ok((await stale).every(result => result.status === 'rejected' && result.reason.code === 'STALE_CATALOG'));
  const fresh = loader.load(keys[8]);
  assert.equal(loader.load(keys[8]), fresh);
  await tick();
  assert.equal(calls.length, 8);
  for (const call of calls) call.resolve();
  await tick();
  assert.equal(calls.length, 9, 'only the new-generation queued call starts');
  calls[8].resolve();
  assert.equal((await fresh).sessionId, 'two');
  assert.equal(peak(), 8);
});

test('synchronous source throws release their slot and keep the original cause', async t => {
  const { loader, calls, keys, source } = queuedLoader(t);
  const load = source.loadCatalog;
  const cause = new Error('source failed synchronously');
  source.loadCatalog = (locale, namespace, signal) => {
    if (namespace === keys[0].namespace) throw cause;
    return load(locale, namespace, signal);
  };
  const failed = assert.rejects(loader.load(keys[0]), error => error.code === 'LOAD_FAILED' && error.cause === cause);
  const successful = Promise.all(keys.slice(1).map(key => loader.load(key)));
  await tick();
  assert.equal(calls.length, 8);
  for (const call of calls) call.resolve();
  await Promise.all([failed, successful]);
});

test('i18n scope and locale changes keep one source budget and publish only complete catalogs', async t => {
  const { i18n, change, handlers, calls } = fixture(t);
  const namespaces = Array.from({ length: 16 }, (_, index) => `page${index}`);
  let active = 0, peak = 0, completed = false;
  const releases = [];
  for (const namespace of namespaces) for (const locale of ['ko', 'en']) {
    change(locale, namespace, `${locale}:${namespace}`);
    handlers.set(id(locale, namespace), outcome => {
      active++; peak = Math.max(peak, active);
      return new Promise(resolve => releases.push(() => resolve(outcome))).finally(() => { active--; });
    });
  }
  const before = i18n.getSnapshot();
  const scope = i18n.setNamespaces(namespaces);
  await tick();
  assert.equal(calls.length, 8);
  const ready = Promise.all([scope, i18n.setLocale('en')]).then(() => { completed = true; });
  await tick();
  assert.equal(calls.length, 8, 'new generations cannot allocate a second source budget');
  assert.equal(i18n.getSnapshot(), before, 'partial scopes never reach the UI');
  while (!completed) {
    for (const release of releases.splice(0)) release();
    await tick();
  }
  await ready;
  assert.equal(peak, 8);
  assert.equal(calls.length, 32, 'each base/target catalog is loaded once across generations');
  assert.equal(i18n.getSnapshot().locale, 'en');
  assert.deepEqual(i18n.getSnapshot().loadedNamespaces, [...namespaces].sort());
  for (const namespace of namespaces) assert.equal(i18n.t(`${namespace}:title`), `en:${namespace}`);
});

function queuedLoader(t, count = 9, cacheOptions) {
  const clock = scheduler();
  const namespaces = Array.from({ length: count }, (_, index) => `scope${index}`);
  const keys = namespaces.map(namespace => ({ locale: 'en', namespace }));
  let manifest = validateCatalogManifest({ sessionId: 'one', registryRevision: 0, baseLocale: 'ko',
    availableLocales: ['ko', 'en'], availableNamespaces: namespaces,
    catalogs: namespaces.map(namespace => ({ key: { locale: 'ko', namespace }, catalogVersion: 1,
      status: 'present', namespaceSchemaFingerprint: 'test-schema' })) });
  let active = 0, peak = 0;
  const calls = [];
  const source = {
    readManifest: () => manifest,
    loadCatalog(locale, namespace, signal) {
      active++; peak = Math.max(peak, active);
      return new Promise((resolve, reject) => {
        const outcome = { sessionId: manifest.sessionId, status: 'missing', key: { locale, namespace }, catalogVersion: 0 };
        calls.push({ signal, resolve: () => resolve(outcome), reject });
      }).finally(() => { active--; });
    },
  };
  const loader = new CatalogLoader(source, () => manifest, 100, clock.schedule, cacheOptions);
  t.after(() => loader.stop(new I18nDisposedError()));
  return { loader, source, calls, keys, clock, active: () => active, peak: () => peak,
    restart() { manifest = validateCatalogManifest({ ...manifest, sessionId: 'two' }); loader.invalidate(); } };
}

test('new scopes discard obsolete queued catalogs without aborting started I/O', async t => {
  for (const count of [8, 9, 128]) await t.test(`${count} obsolete catalogs`, async t => {
    const clock = scheduler();
    const f = fixture(t, { schedule: clock.schedule });
    const namespaces = Array.from({ length: count }, (_, index) => `page${index}`);
    const releases = [];
    for (const namespace of namespaces) {
      f.change('ko', namespace, namespace);
      releases.push(f.defer('ko', namespace));
    }
    const obsolete = assert.rejects(f.i18n.setNamespaces(namespaces), { code: 'SCOPE_SUPERSEDED' });
    await tick();
    assert.equal(f.calls.length, 8);
    const latest = f.i18n.setNamespaces(['cart']);
    latest.catch(() => {}); // Disposal still handles the promise if a regression assertion fails.
    await tick();
    assert.equal(f.calls.length, 8, 'unfinished physical I/O keeps its source slots');
    assert.equal(clock.size, 9, 'only eight started loads and the latest catalog retain timers');
    assert.ok(f.calls.every(call => !call.signal.aborted));
    for (const release of releases) release.release();
    await tick();
    assert.equal(f.calls.length, 9, 'the ninth physical call belongs to the latest screen');
    assert.equal(f.calls.at(-1).namespace, 'cart');
    await Promise.all([obsolete, latest]);
    assert.equal(f.i18n.t('cart:title'), '장바구니');
    assert.equal(clock.size, 0);
  });
});

test('locale supersession discards only obsolete queued targets and retains shared base loads', async t => {
  const f = fixture(t);
  const namespaces = Array.from({ length: 16 }, (_, index) => `page${index}`);
  const releases = [];
  for (const namespace of namespaces) {
    f.change('ko', namespace, namespace);
    f.change('en', namespace, `en:${namespace}`);
    releases.push(f.defer('en', namespace));
  }
  await f.i18n.setNamespaces(namespaces);
  const obsolete = assert.rejects(f.i18n.setLocale('en'), SupersededRequestError);
  await tick();
  const latest = f.i18n.setLocale('fr');
  latest.catch(() => {});
  await tick();
  for (const release of releases) release.release();
  await tick();
  assert.equal(f.calls.filter(call => call.locale === 'en').length, 8);
  assert.equal(f.calls.filter(call => call.locale === 'ko').length, 16, 'base outcomes are reused');
  await Promise.all([obsolete, latest]);
  assert.equal(f.i18n.getSnapshot().locale, 'fr');
  assert.equal(f.i18n.t('page0:title'), 'page0', 'missing target still falls back to the shared base');
});

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

test('lazy error policy covers unloaded namespaces and persists through locale and refresh', async t => {
  const seen = [];
  const { i18n, change } = fixture(t, {
    onMissingKey: context => {
      seen.push(context);
      return `${context.error.name}:${context.locale}:${context.surface}`;
    },
  });
  assert.equal(i18n.t('cart:title'), 'NamespaceNotLoadedError:ko:text');
  const parts = i18n.tParts('cart:title');
  assert.deepEqual(parts, [{ type: 'text', value: 'NamespaceNotLoadedError:ko:parts' }]);
  assert.equal(Object.isFrozen(parts), true);
  assert.equal(Object.isFrozen(parts[0]), true);
  assert.equal(i18n.t('unknown:title'), 'UnknownMessageError:ko:text');
  await i18n.setLocale('en');
  assert.equal(i18n.t('cart:title'), 'NamespaceNotLoadedError:en:text');
  await i18n.loadNamespace('cart');
  assert.equal(i18n.t('cart:title'), 'Cart');
  assert.equal(i18n.t('cart:nope'), 'UnknownMessageError:en:text');
  change('en', 'common', 'Hello');
  await i18n.refresh();
  assert.equal(i18n.t('common:title'), 'Hello');
  assert.equal(seen.at(-1).locale, 'en');
  assert.equal(seen.at(-1).baseLocale, 'ko');
});

test('source failures bypass render error policy', async t => {
  let calls = 0;
  const { i18n, handlers } = fixture(t, {
    onMissingKey: () => { calls++; return 'missing'; },
    onFormatError: () => { calls++; return 'formatted'; },
  });
  handlers.set('en/common', () => { throw new Error('source failed'); });
  await assert.rejects(i18n.setLocale('en'), error => error instanceof CatalogLoadError && error.code === 'LOAD_FAILED');
  assert.equal(calls, 0);
  assert.equal(i18n.getSnapshot().locale, 'ko');
});

test('lazy format policy remains active after locale switches and refresh', async t => {
  const parse = (text, locale = 'ko') => parseCatalog(JSON.stringify({ title: text, items: '{n, number}' }), { locale, namespace: 'common' });
  const records = new Map([['ko', parse('기준')], ['en', parse('English', 'en')]]);
  let registryRevision = 0;
  const manifest = () => ({ sessionId: 'policy', registryRevision, baseLocale: 'ko',
    availableLocales: ['ko', 'en'], availableNamespaces: ['common'],
    catalogs: [...records].map(([locale, catalog]) => ({ key: { locale, namespace: 'common' }, catalogVersion: registryRevision + 1,
      status: 'present', namespaceSchemaFingerprint: createBaseSchema(records.get('ko')).fingerprint })) });
  const outcome = locale => ({ ...manifest().catalogs.find(catalog => catalog.key.locale === locale),
    sessionId: 'policy', catalog: records.get(locale) });
  const source = { readManifest: manifest, loadCatalog: async locale => outcome(locale) };
  const seen = [];
  const i18n = createI18n({ catalogSource: source, locale: 'ko', initialNamespaces: ['common'],
    initialCatalogs: [outcome('ko')], onFormatError: context => {
      seen.push(context);
      return `formatted:${context.locale}`;
    } });
  t.after(() => i18n.dispose());
  assert.equal(i18n.t('common:items'), 'formatted:ko');
  await i18n.setLocale('en');
  assert.equal(i18n.t('common:items'), 'formatted:en');
  records.set('en', parse('Changed', 'en'));
  registryRevision++;
  await i18n.refresh();
  assert.equal(i18n.t('common:title'), 'Changed');
  assert.equal(i18n.t('common:items'), 'formatted:en');
  assert.equal(seen.at(-1).baseLocale, 'ko');
  assert.equal(seen.at(-1).error.name, 'InvalidArgumentError');
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
  const initialLocales = new Set(['ko', Intl.getCanonicalLocales(options.locale ?? 'ko')[0]]);
  for (const locale of options.fallbackLocales ?? []) initialLocales.add(Intl.getCanonicalLocales(locale)[0]);
  const config = { catalogSource: source, locale: 'ko', initialNamespaces: ['common'],
    initialCatalogs: [...initialLocales].map(locale => outcome(locale, 'common')), ...options };
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

test('reused validated manifests retain snapshots while mutable replacements still enforce revisions', async t => {
  const { source, config, calls, change } = fixture(t);
  const read = source.readManifest;
  let supplied = validateCatalogManifest(read());
  const i18n = createI18n({ ...config, catalogSource: { ...source, readManifest: () => supplied } });
  t.after(() => i18n.dispose());
  let notifications = 0;
  i18n.subscribe(() => notifications++);
  const before = i18n.getSnapshot();
  for (let index = 0; index < 3; index++) await i18n.refresh();
  assert.equal(i18n.getSnapshot(), before);
  assert.equal(calls.length, 0);
  assert.equal(notifications, 0);

  supplied = structuredClone(supplied);
  await i18n.refresh();
  assert.equal(i18n.getSnapshot(), before);
  change('ko', 'common', 'Updated');
  Object.assign(supplied, read());
  await i18n.refresh();
  assert.equal(i18n.t('common:title'), 'Updated');
  assert.equal(notifications, 1);
  const committed = i18n.getSnapshot();
  supplied.catalogs[0].catalogVersion++;
  await assert.rejects(i18n.refresh(), { code: 'INVALID_MANIFEST' });
  assert.equal(i18n.getSnapshot(), committed);

  change('ko', 'common', 'New validated revision');
  supplied = validateCatalogManifest(read());
  await i18n.refresh();
  assert.equal(i18n.t('common:title'), 'New validated revision');
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

test('explicit lazy fallback chain loads complete scope and keeps canceled and stale refreshes atomic', async t => {
  const f = fixture(t, { locale: 'fr', fallbackLocales: ['en'] });
  const before = f.i18n.getSnapshot();
  assert.equal(before.locale, 'fr');
  assert.equal(before.t('common:title'), 'Français');
  assert.deepEqual(f.i18n.getBootSnapshot().fallbackLocales, ['en']);
  assert.deepEqual(f.i18n.getBootSnapshot().catalogOutcomes.map(outcome => outcome.key.locale).sort(), ['en', 'fr', 'ko']);

  f.change('fr', 'cart', 'Panier');
  f.change('fr', 'common');
  f.change('en', 'common', 'English v2');
  const slow = f.defer('en', 'common');
  const controller = new AbortController();
  const canceled = f.i18n.refresh({ signal: controller.signal });
  await tick();
  controller.abort('caller finished');
  await assert.rejects(canceled, { code: 'ABORTED' });
  assert.equal(f.i18n.getSnapshot(), before);

  const localeWait = f.i18n.setLocale('en');
  slow.release();
  await localeWait;
  assert.equal(f.i18n.getSnapshot().locale, 'en');
  assert.equal(f.i18n.t('common:title'), 'English v2');
  await f.i18n.setLocale('fr');
  assert.equal(f.i18n.t('common:title'), 'English v2');

  f.change('en', 'common');
  await f.i18n.refresh();
  assert.equal(f.i18n.t('common:title'), '기준');
  assert.deepEqual(f.i18n.getBootSnapshot().fallbackLocales, ['en']);
});

test('i18n cache budget protects current, desired, and fallback scope and releases old screens', async t => {
  const f = fixture(t, { locale: 'fr', fallbackLocales: ['en'], maxCachedCatalogs: 0 });
  assert.equal(Object.hasOwn(f.i18n.getBootSnapshot(), 'maxCachedCatalogs'), false);
  for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => createI18n({ ...f.config, maxCachedCatalogs: invalid }), RangeError);
  assert.equal(f.calls.length, 0, 'the initial scope is seeded without loading');
  await f.i18n.refresh();
  assert.equal(f.calls.length, 0, 'initial current and fallback outcomes stay pinned at budget zero');

  const pages = Array.from({ length: 5 }, (_, index) => `page${index}`);
  for (const namespace of pages) for (const locale of ['ko', 'en', 'fr'])
    f.change(locale, namespace, `${locale}:${namespace}`);
  await f.i18n.setNamespaces(['common', ...pages]);
  assert.equal(f.i18n.t('page4:title'), 'fr:page4');
  const wide = f.calls.length;
  await f.i18n.setNamespaces(['common']);
  await f.i18n.setNamespaces(['common', ...pages]);
  assert.equal(f.i18n.t('page4:title'), 'fr:page4');
  assert.ok(f.calls.length > wide + pages.length * 2, 'released page catalogs are loaded again');

  const g = fixture(t, { locale: 'fr', fallbackLocales: ['en'], maxCachedCatalogs: 0 });
  const before = g.i18n.getSnapshot();
  g.change('en', 'common', 'English v2');
  const slow = g.defer('en', 'common');
  const switching = g.i18n.setLocale('en');
  await tick();
  assert.equal(g.i18n.getSnapshot(), before, 'a desired locale never publishes a partial snapshot');
  slow.release();
  await switching;
  assert.equal(g.i18n.t('common:title'), 'English v2');
});
