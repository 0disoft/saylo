import { STALE_CATALOG_MAX_ATTEMPTS, catalogCacheLimit } from './loading-policy.js';
import { CatalogLoader } from './catalog-loader.js';
import { createBootSnapshot, validateBootSnapshot } from './boot.js';
import { createTextFormatter } from './formatters.js';
import { CatalogLoadError, I18nDisposedError, SupersededRequestError } from './loading-errors.js';
import { aborted, nextRevision, timeoutDuration } from './loading-runtime.js';
import { normalizeFallbackLocales } from './locale-chain.js';
import { acceptOutcome, assertManifestTransition, assertNamespace, canonicalLocale, createLoadedSnapshot, keyId, manifestMembership, readManifest, scopeKeys } from './loading-registry.js';
import { captureErrorPolicy } from './translation-policy.js';
import type { CatalogOutcome, CreateI18nOptions, I18n, I18nRequestOptions } from './loading-types.js';
import type { Schema, StoreSnapshot, Translate, TranslateParts } from './types.js';

interface Waiter {
  readonly kind: 'locale' | 'namespace' | 'namespaces' | 'refresh';
  readonly value: string;
  resolve(): void;
  reject(reason: unknown): void;
  cleanup(): void;
}

/** Async desired-scope coordinator; SSR instances start from a pinned boot manifest. */
export function createI18n<S extends Schema = Schema>(options: CreateI18nOptions): I18n<S> {
  if (options.signal?.aborted) throw aborted(options.signal);
  const maxCachedCatalogs = catalogCacheLimit(options.maxCachedCatalogs);
  const source = options.catalogSource;
  const decoded = options.initialSnapshot ? validateBootSnapshot(options.initialSnapshot) : undefined;
  let manifest = readManifest(decoded?.manifest ?? source.readManifest());
  const baseLocale = manifest.baseLocale;
  const configuredFallbackLocales = options.fallbackLocales === undefined ? undefined : normalizeFallbackLocales(options.fallbackLocales);
  const decodedFallbackLocales = decoded?.fallbackLocales ?? [];
  if (decoded && configuredFallbackLocales &&
      (decodedFallbackLocales.length !== configuredFallbackLocales.length ||
       decodedFallbackLocales.some((locale, index) => locale !== configuredFallbackLocales[index])))
    throw new CatalogLoadError('INVALID_BOOT', 'Configured fallback locales differ from the SSR boot snapshot.');
  const fallbackLocales = decoded ? decodedFallbackLocales : configuredFallbackLocales ?? [];
  const unavailableFallback = fallbackLocales.find(locale => !manifestMembership(manifest).locales.has(locale));
  if (unavailableFallback) throw new RangeError(`Fallback locale is outside the manifest: ${unavailableFallback}`);
  const retiredSessions = new Set<string>();
  const timeZone = new Intl.DateTimeFormat('en', { timeZone: options.timeZone ?? decoded?.timeZone ?? 'UTC' }).resolvedOptions().timeZone;
  if (decoded && timeZone !== decoded.timeZone) throw new CatalogLoadError('INVALID_BOOT', 'Configured timeZone differs from the SSR boot snapshot.');
  const timeoutMs = timeoutDuration(options.requestTimeoutMs);
  let desiredLocale = canonicalLocale(decoded?.locale ?? options.locale!);
  if (!manifestMembership(manifest).locales.has(desiredLocale)) throw new RangeError('Initial locale is outside the manifest.');
  const initialNamespaces = decoded?.loadedNamespaces ?? options.initialNamespaces!;
  let desiredNamespaces = new Set(initialNamespaces);
  if (desiredNamespaces.size !== initialNamespaces.length) throw new RangeError('Duplicate initial namespace.');
  for (const namespace of desiredNamespaces) {
    assertNamespace(namespace);
    if (!manifestMembership(manifest).namespaces.has(namespace)) throw new RangeError('Initial namespace is outside the manifest.');
  }
  const initialKeys = scopeKeys(manifest, desiredLocale, [...desiredNamespaces].sort(), fallbackLocales);
  const initialKeyIndex = new Map(initialKeys.map(key => [keyId(key), key]));
  const initial = new Map<string, CatalogOutcome>();
  for (const outcome of decoded?.catalogOutcomes ?? options.initialCatalogs!) {
    const key = outcome?.key && initialKeyIndex.get(keyId(outcome.key));
    if (!key || initial.has(keyId(key))) throw new CatalogLoadError('INVALID_INITIAL_STATE', 'Unexpected or duplicate initial catalog outcome.');
    initial.set(keyId(key), acceptOutcome(manifest, key, outcome));
  }
  if (initial.size !== initialKeys.length) throw new CatalogLoadError('INVALID_INITIAL_STATE', 'Initial state must contain every base and target outcome.');
  const formatter = createTextFormatter(timeZone);
  const policy = captureErrorPolicy(options);
  const boot = createLoadedSnapshot<S>(manifest, desiredLocale, [...desiredNamespaces].sort(),
    initialKeys.map(key => initial.get(keyId(key))!), timeZone, formatter, decoded?.stateRevision ?? 0, fallbackLocales, policy);
  let current = boot.snapshot;
  let signature = boot.signature;
  let committedManifest = manifest;
  let committedOutcomes = initialKeys.map(key => initial.get(keyId(key))!);
  let generation = 0;
  let staleRetries = 0;
  let disposed = false;
  let scheduled = false;
  const running = new Set<number>();
  const waiters = new Set<Waiter>();
  const listeners = new Set<{ callback: (snapshot: StoreSnapshot<S>) => void }>();
  const disposers = new Set<{ callback: () => void }>();
  let protectionRevision = 0;
  let protectedCache: { readonly revision: number; readonly keys: ReadonlySet<string> } | undefined;
  function invalidateProtection() { protectionRevision++; }
  function protectedCatalogKeys(): ReadonlySet<string> {
    if (protectedCache?.revision === protectionRevision) return protectedCache.keys;
    const keys = new Set<string>();
    for (const key of scopeKeys(manifest, current.locale, current.loadedNamespaces, fallbackLocales)) keys.add(keyId(key));
    for (const key of scopeKeys(manifest, desiredLocale, [...desiredNamespaces], fallbackLocales)) keys.add(keyId(key));
    protectedCache = { revision: protectionRevision, keys };
    return protectedCache.keys;
  }
  const cacheOptions = maxCachedCatalogs === undefined
    ? { protectedKeys: protectedCatalogKeys }
    : { maxCachedCatalogs, protectedKeys: protectedCatalogKeys };
  const loader = new CatalogLoader(source, () => manifest, timeoutMs, options.schedule,
    cacheOptions);
  loader.seed([...initial.values()]);

  function assertActive() { if (disposed) throw new I18nDisposedError(); }
  function rejectWhere(predicate: (waiter: Waiter) => boolean, reason: (waiter: Waiter) => unknown) {
    for (const waiter of waiters) if (predicate(waiter)) { waiters.delete(waiter); waiter.reject(reason(waiter)); }
  }
  function rollbackDesired() {
    desiredLocale = manifestMembership(manifest).locales.has(current.locale) ? current.locale : baseLocale;
    desiredNamespaces = new Set(current.loadedNamespaces.filter(n => manifestMembership(manifest).namespaces.has(n)));
    invalidateProtection();
    generation++;
  }
  function fail(error: unknown) {
    rejectWhere(() => true, () => error);
    rollbackDesired();
    loader.trim();
  }
  function schedule() {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!disposed && !running.has(generation)) void reconcile(generation);
    });
  }

  function syncManifest(): boolean {
    const next = readManifest(source.readManifest());
    // readManifest only reuses validated, deeply frozen instances: identity proves no metadata changed.
    if (next === manifest) return false;
    if (next.baseLocale !== baseLocale) throw new CatalogLoadError('BASE_LOCALE_CHANGED', 'Source base locale cannot change during instance lifetime.');
    if (retiredSessions.has(next.sessionId)) throw new CatalogLoadError('STALE_MANIFEST', 'Source returned a retired session.');
    if (next.sessionId === manifest.sessionId && next.registryRevision < manifest.registryRevision)
      throw new CatalogLoadError('STALE_MANIFEST', 'Source manifest revision moved backwards.');
    if (JSON.stringify(next) === JSON.stringify(manifest)) return false;
    if (next.sessionId === manifest.sessionId && next.registryRevision === manifest.registryRevision)
      throw new CatalogLoadError('INVALID_MANIFEST', 'Catalog metadata changed without a registry revision.');
    assertManifestTransition(manifest, next);
    const removedFallback = fallbackLocales.find(locale => !manifestMembership(next).locales.has(locale));
    if (removedFallback) throw new CatalogLoadError('LOCALE_REMOVED', 'Configured fallback locale was removed from the manifest.');
    if (next.sessionId !== manifest.sessionId) retiredSessions.add(manifest.sessionId);
    manifest = next;
    generation++;
    loader.invalidate();
    rejectWhere(w => w.kind === 'locale' && !manifestMembership(manifest).locales.has(w.value),
      () => new CatalogLoadError('LOCALE_REMOVED', 'Requested locale was removed from the manifest.'));
    rejectWhere(w => w.kind === 'namespace' && !manifestMembership(manifest).namespaces.has(w.value),
      () => new CatalogLoadError('NAMESPACE_REMOVED', 'Requested namespace was removed from the manifest.'));
    rejectWhere(w => w.kind === 'namespaces' && (JSON.parse(w.value) as string[]).some(n => !manifestMembership(manifest).namespaces.has(n)),
      () => new CatalogLoadError('NAMESPACE_REMOVED', 'Requested namespace was removed from the manifest.'));
    if (!manifestMembership(manifest).locales.has(desiredLocale)) desiredLocale = baseLocale;
    desiredNamespaces = new Set([...desiredNamespaces].filter(n => manifestMembership(manifest).namespaces.has(n)));
    invalidateProtection();
    loader.trim();
    schedule();
    return true;
  }

  function publish(snapshot: StoreSnapshot<S>, nextSignature: string) {
    const loaded = new Set(snapshot.loadedNamespaces);
    const ready = [...waiters].filter(w => w.kind === 'refresh' ||
      (w.kind === 'locale' ? w.value === snapshot.locale : w.kind === 'namespaces'
        ? w.value === JSON.stringify(snapshot.loadedNamespaces) : loaded.has(w.value)));
    // These intents have committed, so reentrant selections cannot cancel them.
    for (const waiter of ready) { waiters.delete(waiter); waiter.cleanup(); }
    const errors: unknown[] = [];
    if (nextSignature !== signature) {
      current = snapshot;
      signature = nextSignature;
      invalidateProtection();
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        try { listener.callback(current); } catch (error) { errors.push(error); }
      }
    }
    const error = errors.length ? new AggregateError(errors, 'Subscriber failures after i18n commit; committed snapshot is retained.') : undefined;
    for (const waiter of ready) error ? waiter.reject(error) : waiter.resolve();
    if (error && !ready.length) options.onError?.(error);
  }

  async function reconcile(epoch: number) {
    running.add(epoch);
    const locale = desiredLocale;
    const namespaces = [...desiredNamespaces].sort();
    try {
      const outcomes = await Promise.all(scopeKeys(manifest, locale, namespaces, fallbackLocales).map(key => loader.load(key)));
      if (disposed || epoch !== generation) return;
      if (syncManifest()) return;
      const candidate = createLoadedSnapshot<S>(manifest, locale, namespaces, outcomes, timeZone, formatter,
        current.stateRevision, fallbackLocales, policy);
      const snapshot = candidate.signature === signature ? candidate.snapshot :
        Object.freeze({ ...candidate.snapshot, stateRevision: nextRevision(current.stateRevision) });
      staleRetries = 0;
      committedManifest = manifest;
      committedOutcomes = outcomes;
      publish(snapshot, candidate.signature);
      loader.trim();
    } catch (error) {
      if (disposed || epoch !== generation) return;
      try { if (syncManifest()) return; }
      catch (manifestError) { fail(manifestError); return; }
      if (error instanceof CatalogLoadError && error.code === 'STALE_CATALOG' && ++staleRetries < STALE_CATALOG_MAX_ATTEMPTS) {
        generation++;
        schedule();
      } else fail(error);
    } finally { running.delete(epoch); }
  }

  function request(kind: Waiter['kind'], value: string, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let listening = true;
      const cleanup = () => { if (listening) { listening = false; signal?.removeEventListener('abort', cancel); } };
      const waiter: Waiter = { kind, value, cleanup,
        resolve() { cleanup(); resolve(); }, reject(reason) { cleanup(); reject(reason); } };
      const cancel = () => { if (waiters.delete(waiter)) waiter.reject(aborted(signal!)); };
      waiters.add(waiter);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      schedule();
    });
  }
  function call(action: () => Promise<void>, signal?: AbortSignal): Promise<void> {
    try { assertActive(); if (signal?.aborted) throw aborted(signal); syncManifest(); if (signal?.aborted) throw aborted(signal); return action(); }
    catch (error) { return Promise.reject(error); }
  }

  const instance: I18n<S> = Object.freeze({
    t: ((key: string, args?: Record<string, unknown>) => (current.t as Translate<Schema>)(key, args)) as Translate<S>,
    tParts: ((key: string, args?: Record<string, unknown>) => (current.tParts as TranslateParts<Schema>)(key, args)) as TranslateParts<S>,
    getSnapshot: () => current,
    getServerSnapshot: () => boot.snapshot,
    getBootSnapshot: () => createBootSnapshot({ manifest: committedManifest, locale: current.locale, timeZone,
      stateRevision: current.stateRevision, loadedNamespaces: current.loadedNamespaces, fallbackLocales,
      catalogOutcomes: committedOutcomes }),
    getLocales: () => current.availableLocales,
    getNamespaces: () => current.availableNamespaces,
    subscribe(callback: (snapshot: StoreSnapshot<S>) => void) {
      assertActive();
      const listener = { callback }; listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    onDispose(callback: () => void) {
      assertActive();
      const listener = { callback }; disposers.add(listener);
      return () => { disposers.delete(listener); };
    },
    setLocale(locale: string, requestOptions: I18nRequestOptions = {}) { return call(() => {
      const next = canonicalLocale(locale);
      if (!manifestMembership(manifest).locales.has(next)) throw new RangeError('Locale is outside the manifest.');
      if (desiredLocale !== next) {
        desiredLocale = next;
        invalidateProtection();
        rejectWhere(w => w.kind === 'locale' && w.value !== next, w => new SupersededRequestError(w.value));
        generation++;
      }
      staleRetries = 0;
      return request('locale', next, requestOptions.signal);
    }, requestOptions.signal); },
    loadNamespace(namespace: string, requestOptions: I18nRequestOptions = {}) { return call(() => {
      assertNamespace(namespace);
      if (!manifestMembership(manifest).namespaces.has(namespace)) throw new RangeError('Namespace is outside the manifest.');
      if (!desiredNamespaces.has(namespace)) {
        rejectWhere(w => w.kind === 'namespaces', () => new CatalogLoadError('SCOPE_SUPERSEDED', 'Namespace scope was replaced by a newer selection.'));
        desiredNamespaces.add(namespace); invalidateProtection(); generation++;
      }
      staleRetries = 0;
      return request('namespace', namespace, requestOptions.signal);
    }, requestOptions.signal); },
    setNamespaces(namespaces: readonly string[], requestOptions: I18nRequestOptions = {}) { return call(() => {
      if (!Array.isArray(namespaces)) throw new TypeError('Namespaces must be an array.');
      const next = new Set<string>();
      for (const namespace of namespaces) {
        assertNamespace(namespace);
        if (!manifestMembership(manifest).namespaces.has(namespace)) throw new RangeError('Namespace is outside the manifest.');
        if (next.has(namespace)) throw new RangeError('Duplicate namespace.');
        next.add(namespace);
      }
      const value = JSON.stringify([...next].sort());
      if (value !== JSON.stringify([...desiredNamespaces].sort())) {
        rejectWhere(w => w.kind === 'namespaces' || (w.kind === 'namespace' && !next.has(w.value)),
          () => new CatalogLoadError('SCOPE_SUPERSEDED', 'Namespace scope was replaced by a newer selection.'));
        desiredNamespaces = next;
        invalidateProtection();
        generation++;
      }
      staleRetries = 0;
      return request('namespaces', value, requestOptions.signal);
    }, requestOptions.signal); },
    refresh(requestOptions: I18nRequestOptions = {}) { return call(() => { staleRetries = 0; return request('refresh', '', requestOptions.signal); }, requestOptions.signal); },
    dispose() {
      if (disposed) return;
      disposed = true;
      options.signal?.removeEventListener('abort', disposeOnAbort);
      generation++;
      const reason = new I18nDisposedError();
      rejectWhere(() => true, () => reason);
      loader.stop(reason);
      listeners.clear();
      const errors: unknown[] = [];
      for (const listener of [...disposers]) {
        if (!disposers.has(listener)) continue;
        disposers.delete(listener);
        try { listener.callback(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'Failures during i18n disposal; all cleanup was attempted.');
    },
  });
  const disposeOnAbort = () => {
    try { instance.dispose(); }
    catch (error) { try { options.onError?.(error as AggregateError); } catch { /* Disposal has already released all resources. */ } }
  };
  options.signal?.addEventListener('abort', disposeOnAbort, { once: true });
  if (options.signal?.aborted) { disposeOnAbort(); throw aborted(options.signal); }
  return instance;
}
