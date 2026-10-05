import { CatalogLoader } from './catalog-loader.js';
import { createBootSnapshot, validateBootSnapshot } from './boot.js';
import { createTextFormatter } from './formatters.js';
import { CatalogLoadError, I18nDisposedError, SupersededRequestError } from './loading-errors.js';
import { acceptOutcome, assertManifestTransition, assertNamespace, canonicalLocale, createLoadedSnapshot, keyId, readManifest, scopeKeys } from './loading-registry.js';
import type { CatalogOutcome, CreateI18nOptions, I18n } from './loading-types.js';
import type { Schema, StoreSnapshot, Translate } from './types.js';

interface Waiter {
  readonly kind: 'locale' | 'namespace' | 'refresh';
  readonly value: string;
  resolve(): void;
  reject(reason: unknown): void;
}

/** Async desired-scope coordinator; SSR instances start from a pinned boot manifest. */
export function createI18n<S extends Schema = Schema>(options: CreateI18nOptions): I18n<S> {
  const source = options.catalogSource;
  const decoded = options.initialSnapshot ? validateBootSnapshot(options.initialSnapshot) : undefined;
  let manifest = readManifest(decoded?.manifest ?? source.readManifest());
  const baseLocale = manifest.baseLocale;
  const retiredSessions = new Set<string>();
  const timeZone = new Intl.DateTimeFormat('en', { timeZone: options.timeZone ?? decoded?.timeZone ?? 'UTC' }).resolvedOptions().timeZone;
  if (decoded && timeZone !== decoded.timeZone) throw new CatalogLoadError('INVALID_BOOT', 'Configured timeZone differs from the SSR boot snapshot.');
  const timeoutMs = options.requestTimeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new RangeError('requestTimeoutMs must be a positive timer duration.');
  let desiredLocale = canonicalLocale(decoded?.locale ?? options.locale!);
  if (!manifest.availableLocales.includes(desiredLocale)) throw new RangeError('Initial locale is outside the manifest.');
  const initialNamespaces = decoded?.loadedNamespaces ?? options.initialNamespaces!;
  let desiredNamespaces = new Set(initialNamespaces);
  if (desiredNamespaces.size !== initialNamespaces.length) throw new RangeError('Duplicate initial namespace.');
  for (const namespace of desiredNamespaces) {
    assertNamespace(namespace);
    if (!manifest.availableNamespaces.includes(namespace)) throw new RangeError('Initial namespace is outside the manifest.');
  }
  const initialKeys = scopeKeys(manifest, desiredLocale, [...desiredNamespaces].sort());
  const initial = new Map<string, CatalogOutcome>();
  for (const outcome of decoded?.catalogOutcomes ?? options.initialCatalogs!) {
    const key = initialKeys.find(key => outcome?.key && keyId(key) === keyId(outcome.key));
    if (!key || initial.has(keyId(key))) throw new CatalogLoadError('INVALID_INITIAL_STATE', 'Unexpected or duplicate initial catalog outcome.');
    initial.set(keyId(key), acceptOutcome(manifest, key, outcome));
  }
  if (initial.size !== initialKeys.length) throw new CatalogLoadError('INVALID_INITIAL_STATE', 'Initial state must contain every base and target outcome.');
  const formatter = createTextFormatter(timeZone);
  const boot = createLoadedSnapshot<S>(manifest, desiredLocale, [...desiredNamespaces].sort(),
    initialKeys.map(key => initial.get(keyId(key))!), timeZone, formatter, decoded?.stateRevision ?? 0);
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
  const loader = new CatalogLoader(source, () => manifest, Math.ceil(timeoutMs));
  loader.seed([...initial.values()]);

  function assertActive() { if (disposed) throw new I18nDisposedError(); }
  function rejectWhere(predicate: (waiter: Waiter) => boolean, reason: (waiter: Waiter) => unknown) {
    for (const waiter of waiters) if (predicate(waiter)) { waiters.delete(waiter); waiter.reject(reason(waiter)); }
  }
  function rollbackDesired() {
    desiredLocale = manifest.availableLocales.includes(current.locale) ? current.locale : baseLocale;
    desiredNamespaces = new Set(current.loadedNamespaces.filter(n => manifest.availableNamespaces.includes(n)));
    generation++;
  }
  function fail(error: unknown) {
    rejectWhere(() => true, () => error);
    rollbackDesired();
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
    if (next.baseLocale !== baseLocale) throw new CatalogLoadError('BASE_LOCALE_CHANGED', 'Source base locale cannot change during instance lifetime.');
    if (retiredSessions.has(next.sessionId)) throw new CatalogLoadError('STALE_MANIFEST', 'Source returned a retired session.');
    if (next.sessionId === manifest.sessionId && next.registryRevision < manifest.registryRevision)
      throw new CatalogLoadError('STALE_MANIFEST', 'Source manifest revision moved backwards.');
    if (JSON.stringify(next) === JSON.stringify(manifest)) return false;
    if (next.sessionId === manifest.sessionId && next.registryRevision === manifest.registryRevision)
      throw new CatalogLoadError('INVALID_MANIFEST', 'Catalog metadata changed without a registry revision.');
    assertManifestTransition(manifest, next);
    if (next.sessionId !== manifest.sessionId) retiredSessions.add(manifest.sessionId);
    manifest = next;
    generation++;
    loader.invalidate();
    rejectWhere(w => w.kind === 'locale' && !manifest.availableLocales.includes(w.value),
      () => new CatalogLoadError('LOCALE_REMOVED', 'Requested locale was removed from the manifest.'));
    rejectWhere(w => w.kind === 'namespace' && !manifest.availableNamespaces.includes(w.value),
      () => new CatalogLoadError('NAMESPACE_REMOVED', 'Requested namespace was removed from the manifest.'));
    if (!manifest.availableLocales.includes(desiredLocale)) desiredLocale = baseLocale;
    desiredNamespaces = new Set([...desiredNamespaces].filter(n => manifest.availableNamespaces.includes(n)));
    schedule();
    return true;
  }

  function publish(snapshot: StoreSnapshot<S>, nextSignature: string) {
    const ready = [...waiters].filter(w => w.kind === 'refresh' ||
      (w.kind === 'locale' ? w.value === snapshot.locale : snapshot.loadedNamespaces.includes(w.value)));
    // These intents have committed, so reentrant selections cannot cancel them.
    for (const waiter of ready) waiters.delete(waiter);
    const errors: unknown[] = [];
    if (nextSignature !== signature) {
      current = snapshot;
      signature = nextSignature;
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
      const outcomes = await Promise.all(scopeKeys(manifest, locale, namespaces).map(key => loader.load(key)));
      if (disposed || epoch !== generation) return;
      if (syncManifest()) return;
      const candidate = createLoadedSnapshot<S>(manifest, locale, namespaces, outcomes, timeZone, formatter, current.stateRevision + 1);
      staleRetries = 0;
      committedManifest = manifest;
      committedOutcomes = outcomes;
      publish(candidate.snapshot, candidate.signature);
    } catch (error) {
      if (disposed || epoch !== generation) return;
      try { if (syncManifest()) return; }
      catch (manifestError) { fail(manifestError); return; }
      if (error instanceof CatalogLoadError && error.code === 'STALE_CATALOG' && ++staleRetries < 3) {
        generation++;
        schedule();
      } else fail(error);
    } finally { running.delete(epoch); }
  }

  function request(kind: Waiter['kind'], value: string): Promise<void> {
    return new Promise<void>((resolve, reject) => { waiters.add({ kind, value, resolve, reject }); schedule(); });
  }
  function call(action: () => Promise<void>): Promise<void> {
    try { assertActive(); syncManifest(); return action(); }
    catch (error) { return Promise.reject(error); }
  }

  return Object.freeze({
    t: ((key: string, args?: Record<string, unknown>) => (current.t as Translate<Schema>)(key, args)) as Translate<S>,
    getSnapshot: () => current,
    getServerSnapshot: () => boot.snapshot,
    getBootSnapshot: () => createBootSnapshot({ manifest: committedManifest, locale: current.locale, timeZone,
      stateRevision: current.stateRevision, loadedNamespaces: current.loadedNamespaces, catalogOutcomes: committedOutcomes }),
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
    setLocale(locale: string) { return call(() => {
      const next = canonicalLocale(locale);
      if (!manifest.availableLocales.includes(next)) throw new RangeError('Locale is outside the manifest.');
      if (desiredLocale !== next) {
        desiredLocale = next;
        rejectWhere(w => w.kind === 'locale' && w.value !== next, w => new SupersededRequestError(w.value));
        generation++;
      }
      staleRetries = 0;
      return request('locale', next);
    }); },
    loadNamespace(namespace: string) { return call(() => {
      assertNamespace(namespace);
      if (!manifest.availableNamespaces.includes(namespace)) throw new RangeError('Namespace is outside the manifest.');
      if (!desiredNamespaces.has(namespace)) { desiredNamespaces.add(namespace); generation++; }
      staleRetries = 0;
      return request('namespace', namespace);
    }); },
    refresh() { return call(() => { staleRetries = 0; return request('refresh', ''); }); },
    dispose() {
      if (disposed) return;
      disposed = true;
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
}
