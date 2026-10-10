import { createBootSnapshot, decodeBootSnapshot, validateCatalogManifest, CatalogLoadError,
  I18nDisposedError, SupersededRequestError } from '@0disoft/saylo-core/runtime';
import { createCatalogLayer } from './catalog-layer.mjs';
import { assertTransition, createSourceCache, stamp } from './lazy-source-cache.mjs';

const canonical = value => { const locale = Intl.getCanonicalLocales(value)[0]; if (!locale) throw new RangeError('Locale must not be empty.'); return locale; };
const assertNamespace = value => {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[:/\\\x00-\x1f]/.test(value)) throw new RangeError('Invalid namespace.');
};
const catalogs = boot => boot.catalogOutcomes.filter(outcome => outcome.status === 'present').map(outcome => outcome.catalog);
const scope = boot => ({ availableLocales: boot.manifest.availableLocales,
  availableNamespaces: boot.manifest.availableNamespaces, loadedNamespaces: boot.loadedNamespaces });
const signature = boot => JSON.stringify([boot.manifest.sessionId, boot.manifest.baseLocale, boot.locale, boot.timeZone,
  boot.manifest.availableLocales, boot.manifest.availableNamespaces, boot.loadedNamespaces,
  boot.catalogOutcomes.map(outcome => stamp(outcome.sessionId, outcome))]);

// Experiment only: native i18next resource engines plus our own async desired
// scope, pair cache and publication. Reuses public Saylo boot/schema validation,
// not createI18n or its loader/coordinator implementation.
export async function createLazyLayer(options) {
  const source = options.catalogSource;
  const timeoutMs = options.requestTimeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new RangeError('Invalid timeout.');
  const initial = options.initialSnapshot === undefined ? createBootSnapshot({
    manifest: validateCatalogManifest(source.readManifest()), locale: canonical(options.locale),
    timeZone: new Intl.DateTimeFormat('en', { timeZone: options.timeZone ?? 'UTC' }).resolvedOptions().timeZone,
    stateRevision: 0, loadedNamespaces: options.initialNamespaces, catalogOutcomes: options.initialCatalogs,
  }) : decodeBootSnapshot(typeof options.initialSnapshot === 'string' ? options.initialSnapshot : JSON.stringify(options.initialSnapshot));
  if (options.timeZone !== undefined && new Intl.DateTimeFormat('en', { timeZone: options.timeZone }).resolvedOptions().timeZone !== initial.timeZone)
    throw new CatalogLoadError('INVALID_BOOT', 'Configured timezone differs from boot.');
  let manifest = initial.manifest, committedBoot = initial;
  const baseLocale = manifest.baseLocale, timeZone = initial.timeZone;
  const layer = await createCatalogLayer(baseLocale, catalogs(initial), initial.locale, { timeZone, ...scope(initial) });
  const project = (snapshot, revision) => Object.freeze({ ...snapshot, stateRevision: revision });
  let current = project(layer.getSnapshot(), initial.stateRevision), currentSignature = signature(initial);
  const serverSnapshot = current;
  let desiredLocale = current.locale, desiredNamespaces = new Set(initial.loadedNamespaces);
  let generation = 0, scheduled = false, disposed = false, staleRetries = 0;
  const running = new Set(), retired = new Set(), waiters = new Set(), listeners = new Set(), disposers = new Set();
  const cache = createSourceCache(source, () => manifest, Math.ceil(timeoutMs), initial.catalogOutcomes);
  const alive = () => { if (disposed) throw new I18nDisposedError(); };
  const rejectWhere = (predicate, reason) => {
    for (const waiter of [...waiters]) if (predicate(waiter)) { waiters.delete(waiter); waiter.reject(reason(waiter)); }
  };
  function schedule() {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; if (!disposed && !running.has(generation)) void reconcile(generation); });
  }
  function syncManifest() {
    const next = validateCatalogManifest(source.readManifest());
    if (next.baseLocale !== baseLocale) throw new CatalogLoadError('BASE_LOCALE_CHANGED', 'Base locale cannot change.');
    if (retired.has(next.sessionId)) throw new CatalogLoadError('STALE_MANIFEST', 'Retired session returned.');
    if (next.sessionId === manifest.sessionId && next.registryRevision < manifest.registryRevision)
      throw new CatalogLoadError('STALE_MANIFEST', 'Registry revision moved backwards.');
    if (JSON.stringify(next) === JSON.stringify(manifest)) return false;
    if (next.sessionId === manifest.sessionId && next.registryRevision === manifest.registryRevision)
      throw new CatalogLoadError('INVALID_MANIFEST', 'Metadata changed without a registry revision.');
    assertTransition(manifest, next);
    if (next.sessionId !== manifest.sessionId) retired.add(manifest.sessionId);
    manifest = next; generation++; cache.invalidate();
    rejectWhere(waiter => waiter.kind === 'locale' && !next.availableLocales.includes(waiter.value),
      () => new CatalogLoadError('LOCALE_REMOVED', 'Requested locale removed.'));
    rejectWhere(waiter => waiter.kind === 'namespace' && !next.availableNamespaces.includes(waiter.value),
      () => new CatalogLoadError('NAMESPACE_REMOVED', 'Requested namespace removed.'));
    if (!next.availableLocales.includes(desiredLocale)) desiredLocale = baseLocale;
    desiredNamespaces = new Set([...desiredNamespaces].filter(namespace => next.availableNamespaces.includes(namespace)));
    schedule(); return true;
  }
  function fail(error) {
    rejectWhere(() => true, () => error);
    desiredLocale = manifest.availableLocales.includes(current.locale) ? current.locale : baseLocale;
    desiredNamespaces = new Set(current.loadedNamespaces.filter(namespace => manifest.availableNamespaces.includes(namespace)));
    generation++;
  }
  function publish(boot, snapshot) {
    const nextSignature = signature(boot);
    const ready = [...waiters].filter(waiter => waiter.kind === 'refresh' ||
      (waiter.kind === 'locale' ? waiter.value === snapshot.locale : snapshot.loadedNamespaces.includes(waiter.value)));
    for (const waiter of ready) waiters.delete(waiter);
    const changed = nextSignature !== currentSignature;
    committedBoot = Object.freeze({ ...boot, stateRevision: changed ? snapshot.stateRevision : current.stateRevision });
    const errors = [];
    if (changed) {
      current = snapshot; currentSignature = nextSignature;
      for (const listener of [...listeners]) if (listeners.has(listener)) {
        try { listener.callback(current); } catch (error) { errors.push(error); }
      }
    }
    const error = errors.length ? new AggregateError(errors, 'Subscriber failures after committed snapshot.') : undefined;
    for (const waiter of ready) error ? waiter.reject(error) : waiter.resolve();
    if (error && !ready.length) options.onError?.(error);
  }
  async function reconcile(epoch) {
    running.add(epoch);
    const locale = desiredLocale, namespaces = [...desiredNamespaces].sort();
    try {
      const keys = namespaces.flatMap(namespace => [...new Set([baseLocale, locale])].map(locale => ({ locale, namespace })));
      const outcomes = await Promise.all(keys.map(key => cache.load(key)));
      if (disposed || epoch !== generation || syncManifest()) return;
      const boot = createBootSnapshot({ manifest, locale, timeZone, loadedNamespaces: namespaces,
        catalogOutcomes: outcomes, stateRevision: current.stateRevision + 1 });
      if (signature(boot) === currentSignature) { staleRetries = 0; publish(boot, current); return; }
      const native = await layer.replace(catalogs(boot), locale, scope(boot));
      if (disposed || epoch !== generation || syncManifest()) return;
      staleRetries = 0; publish(boot, project(native, boot.stateRevision));
    } catch (error) {
      if (disposed || epoch !== generation) return;
      try { if (syncManifest()) return; } catch (manifestError) { fail(manifestError); return; }
      if (error instanceof CatalogLoadError && error.code === 'STALE_CATALOG' && ++staleRetries < 3) { generation++; schedule(); }
      else fail(error);
    } finally { running.delete(epoch); }
  }
  const request = (kind, value) => new Promise((resolve, reject) => { waiters.add({ kind, value, resolve, reject }); schedule(); });
  const call = action => { try { alive(); syncManifest(); return action(); } catch (error) { return Promise.reject(error); } };
  return Object.freeze({
    t: (key, args) => current.t(key, args), getSnapshot: () => current, getServerSnapshot: () => serverSnapshot,
    getBootSnapshot: () => committedBoot, getLocales: () => current.availableLocales, getNamespaces: () => current.availableNamespaces,
    subscribe(callback) { alive(); const listener = { callback }; listeners.add(listener); return () => listeners.delete(listener); },
    onDispose(callback) { alive(); const listener = { callback }; disposers.add(listener); return () => disposers.delete(listener); },
    getProbeStats: () => layer.getProbeStats(),
    setLocale(locale) { return call(() => {
      const next = canonical(locale);
      if (!manifest.availableLocales.includes(next)) throw new RangeError('Locale is outside manifest.');
      if (next !== desiredLocale) {
        desiredLocale = next; generation++;
        rejectWhere(waiter => waiter.kind === 'locale' && waiter.value !== next, waiter => new SupersededRequestError(waiter.value));
      }
      staleRetries = 0; return request('locale', next);
    }); },
    loadNamespace(namespace) { return call(() => {
      assertNamespace(namespace);
      if (!manifest.availableNamespaces.includes(namespace)) throw new RangeError('Namespace is outside manifest.');
      if (!desiredNamespaces.has(namespace)) { desiredNamespaces.add(namespace); generation++; }
      staleRetries = 0; return request('namespace', namespace);
    }); },
    refresh() { return call(() => { staleRetries = 0; return request('refresh', ''); }); },
    dispose() {
      if (disposed) return;
      disposed = true; generation++;
      const reason = new I18nDisposedError(); rejectWhere(() => true, () => reason); cache.stop(reason); listeners.clear();
      const errors = [];
      for (const listener of [...disposers]) if (disposers.has(listener)) {
        disposers.delete(listener); try { listener.callback(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'Disposal failures after cleanup.');
    },
  });
}
