import { CatalogLoadError, freezeCatalogs } from '@0disoft/saylo-core/runtime';

export const pairId = key => JSON.stringify([key.locale, key.namespace]);
const indexes = new WeakMap();
export function metadata(manifest, key) {
  let index = indexes.get(manifest);
  if (!index) { index = new Map(manifest.catalogs.map(meta => [pairId(meta.key), meta])); indexes.set(manifest, index); }
  return index.get(pairId(key)) ?? { key, status: 'missing', catalogVersion: 0 };
}
export const stamp = (sessionId, meta) => JSON.stringify([sessionId, meta.key.locale, meta.key.namespace, meta.status, meta.catalogVersion,
  meta.status === 'present' ? meta.namespaceSchemaFingerprint : null]);

export function assertTransition(before, after) {
  if (before.sessionId !== after.sessionId) return;
  for (const old of before.catalogs) {
    const next = metadata(after, old.key);
    if (next.catalogVersion < old.catalogVersion || next.catalogVersion === old.catalogVersion && next.status !== old.status)
      throw new CatalogLoadError('STALE_MANIFEST', 'Pair versions/status must not move backwards.');
    if (old.status === 'present' && next.status === 'present' && old.catalogVersion === next.catalogVersion &&
        old.namespaceSchemaFingerprint !== next.namespaceSchemaFingerprint) {
      const key = { locale: before.baseLocale, namespace: old.key.namespace };
      const oldBase = metadata(before, key), nextBase = metadata(after, key);
      if (old.key.locale === before.baseLocale || oldBase.status !== 'present' || nextBase.status !== 'present' ||
          oldBase.namespaceSchemaFingerprint === nextBase.namespaceSchemaFingerprint)
        throw new CatalogLoadError('INVALID_MANIFEST', 'Schema changed without a newer base pair.');
    }
  }
}

// Experiment-only coordinator support, independently implemented on the
// public CatalogSource contract. Payload/schema validation also runs at boot.
export function createSourceCache(source, manifest, timeoutMs, initial) {
  const cache = new Map(initial.map(outcome => [pairId(outcome.key), outcome]));
  const flights = new Map();
  return {
    load(key) {
      const snapshot = manifest(), expected = metadata(snapshot, key);
      const version = stamp(snapshot.sessionId, expected);
      const cached = cache.get(pairId(key));
      if (cached && stamp(cached.sessionId, cached) === version) return Promise.resolve(cached);
      if (flights.has(version)) return flights.get(version).promise;
      const controller = new AbortController();
      let resolve, reject, done = false;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const finish = () => { done = true; clearTimeout(timer); flights.delete(version); };
      const cancel = reason => { if (done) return; finish(); reject(reason); controller.abort(); };
      const timer = setTimeout(() => cancel(new CatalogLoadError('TIMEOUT', 'Catalog load timed out.')), timeoutMs);
      flights.set(version, { promise, key, version, cancel });
      Promise.resolve().then(() => done ? undefined : source.loadCatalog(key.locale, key.namespace, controller.signal)).then(result => {
        if (done) return;
        try {
          if (!result || result.status === 'failed')
            throw new CatalogLoadError(result?.code ?? 'INVALID_RESULT', result?.message ?? 'Invalid load result.');
          if (stamp(manifest().sessionId, metadata(manifest(), key)) !== version || result.sessionId !== snapshot.sessionId ||
              !result.key || pairId(result.key) !== pairId(key) || stamp(result.sessionId, result) !== version)
            throw new CatalogLoadError('STALE_CATALOG', 'Catalog result does not match requested session/pair/version.');
          if (result.status === 'present' && (result.catalog?.locale !== key.locale || result.catalog?.namespace !== key.namespace))
            throw new CatalogLoadError('INVALID_CATALOG', 'Catalog payload does not match the requested pair.');
          const accepted = Object.freeze({ sessionId: result.sessionId, key: Object.freeze({ ...key }),
            status: result.status, catalogVersion: result.catalogVersion,
            ...(result.status === 'present' ? { namespaceSchemaFingerprint: result.namespaceSchemaFingerprint,
              catalog: freezeCatalogs([result.catalog])[0] } : {}) });
          cache.set(pairId(key), accepted); finish(); resolve(accepted);
        } catch (error) { finish(); reject(error); }
      }, cause => { if (!done) { finish(); reject(new CatalogLoadError('LOAD_FAILED', 'Catalog source failed.', { cause })); } });
      return promise;
    },
    invalidate() {
      const current = manifest();
      for (const [id, outcome] of cache)
        if (stamp(outcome.sessionId, outcome) !== stamp(current.sessionId, metadata(current, outcome.key))) cache.delete(id);
      for (const flight of [...flights.values()]) if (flight.version !== stamp(current.sessionId, metadata(current, flight.key)))
        flight.cancel(new CatalogLoadError('STALE_CATALOG', 'Catalog changed while loading.'));
    },
    stop(reason) { for (const flight of [...flights.values()]) flight.cancel(reason); cache.clear(); },
  };
}
