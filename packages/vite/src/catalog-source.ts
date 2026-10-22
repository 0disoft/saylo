import { CatalogLoadError, validateCatalogManifest } from '@0disoft/saylo-core';
import type { CatalogKey, CatalogLoadResult, CatalogManifest, CatalogOutcome, CatalogSource, ParsedCatalog } from '@0disoft/saylo-core';
import { EagerSync } from './dev-sync.js';
import type { DevSyncState } from './dev-sync.js';
import { catalogId as id, catalogMetadata, immutable, matches } from './catalog-outcome.js';
import { CATALOG_EVENT, CATALOG_PUSH_EVENT, CATALOG_SCOPE_EVENT, CATALOG_REQUEST_EVENT, DIAGNOSTIC_EVENT, MANIFEST_EVENT, MANIFEST_REQUEST_EVENT } from './types.js';
import type { CatalogPush, CatalogReply, CatalogRequest, EagerCatalogEvent, LiveDiagnostic, ManifestEvent } from './types.js';
import { applyCatalogPatch } from './catalog-patch.js';
import { decodeCatalogResult } from './catalog-wire.js';
import type { PresentCatalog } from './catalog-patch.js';
import { deliverDiagnostic, diagnosticMessage } from './diagnostic-observers.js';
import { createRequestId, schedule, timeoutDuration } from './scheduling.js';
import type { DevRuntime } from './scheduling.js';

type HotContext = NonNullable<ImportMeta['hot']>;

export interface DevCatalogSource extends CatalogSource {
  getCatalogs(): readonly ParsedCatalog[];
  subscribeManifest(listener: () => void): () => void;
  subscribeDiagnostic(listener: (diagnostic: LiveDiagnostic) => void): () => void;
  /** Optional for custom sources written before synchronization-state observers. */
  getSyncState?(): DevSyncState;
  subscribeSyncState?(listener: (state: DevSyncState) => void): () => void;
  /** Reference-counted bridge lifetime; the Vite socket remains shared. */
  connect(): () => void;
  dispose(): void;
}
export interface DevCatalogSourceOptions {
  readonly hot?: HotContext;
  readonly requestTimeoutMs?: number;
  readonly runtime?: DevRuntime;
  /** Subscribe cached pairs to atomic server pushes. Generated Vite sources enable this. */
  readonly push?: boolean;
}

interface Pending {
  request: CatalogRequest;
  readonly key: CatalogKey;
  readonly baseline: PresentCatalog | undefined;
  resolve(result: CatalogLoadResult): void;
  reject(error: unknown): void;
  cleanup(): void;
}

/** Generic pair lookup. No per-namespace loader map is needed during development. */
export function createDevCatalogSource(initial: CatalogManifest, initialCatalogs: readonly CatalogOutcome[], options: DevCatalogSourceOptions = {}): DevCatalogSource {
  const hot = options.hot ?? import.meta.hot;
  if (!hot) throw new Error('createDevCatalogSource requires a Vite hot context.');
  let manifest = validateCatalogManifest(initial);
  const timeoutMs = timeoutDuration(options.requestTimeoutMs);
  const identity = (options.runtime?.createId ?? createRequestId)();
  let sequence = 0;
  let generation = 1;
  let refs = 0;
  let disposed = false;
  let ready = false;
  let sync: EagerSync | undefined;
  const cache = new Map(initialCatalogs.map(outcome => [id(outcome.key), immutable(outcome)]));
  const pending = new Map<string, Pending>();
  const listeners = new Set<() => void>();
  const diagnostics = new Set<(diagnostic: LiveDiagnostic) => void>();
  const syncListeners = new Set<(state: DevSyncState) => void>();
  if (options.push !== undefined && typeof options.push !== 'boolean') throw new TypeError('push must be a boolean.');
  const sendScope = (clear = false) => {
    if (!options.push || !sync) return;
    hot.send(CATALOG_SCOPE_EVENT, { owner: identity, sessionId: manifest.sessionId,
      catalogs: clear ? [] : [...cache.values()].map(outcome => ({ key: outcome.key, catalogVersion: outcome.catalogVersion, status: outcome.status,
        ...(outcome.status === 'present' ? { namespaceSchemaFingerprint: outcome.namespaceSchemaFingerprint } : {}) })) });
  };
  let syncState: DevSyncState = Object.freeze({ status: 'idle', attempt: 0, maxAttempts: 3 });
  const notify = (diagnostic: LiveDiagnostic) => {
    for (const listener of [...diagnostics]) {
      if (disposed || !diagnostics.has(listener)) continue;
      deliverDiagnostic(listener, diagnostic);
    }
  };
  const report = (error: unknown, operation: 'handshake' | 'observer' = 'handshake') => notify({ message: diagnosticMessage(error), diagnostics: [], operation });
  const observeState = (state: DevSyncState) => {
    syncState = state;
    for (const listener of [...syncListeners]) {
      if (disposed || !syncListeners.has(listener)) continue;
      try { listener(state); } catch (error) { try { report(error, 'observer'); } catch { /* observer errors do not block other listeners */ } }
    }
  };
  function failPending(error: unknown) {
    for (const entry of [...pending.values()]) { entry.cleanup(); entry.reject(error); }
  }
  function send(entry: Pending) {
    try { hot!.send(CATALOG_REQUEST_EVENT, entry.request); }
    catch (error) { entry.cleanup(); entry.reject(error); }
  }
  function resume() {
    for (const entry of [...pending.values()]) {
      pending.delete(entry.request.requestId);
      entry.request = { ...entry.request, generation, requestId: `${identity}:${++sequence}` };
      pending.set(entry.request.requestId, entry);
      if (ready) send(entry);
    }
  }
  const receiveManifest = (event: ManifestEvent) => {
    if (!sync || !event?.manifest) return;
    // Reuse the same identity/revision handshake as the eager bridge; no AST is sent here.
    sync.receive({ ...event, sessionId: event.manifest.sessionId, revision: event.manifest.registryRevision,
      baseLocale: event.manifest.baseLocale, catalogs: [] } as EagerCatalogEvent);
  };
  const receivePush = (event: CatalogPush) => {
    if (!options.push || !sync || event?.owner !== identity || event.kind !== 'patch' || !event.manifest) return;
    sync.receive({ ...event, kind: 'update', sessionId: event.manifest.sessionId, revision: event.manifest.registryRevision,
      baseLocale: event.manifest.baseLocale, catalogs: [], push: event } as EagerCatalogEvent);
  };
  const receiveCatalog = (reply: CatalogReply) => {
    const entry = reply?.request && pending.get(reply.request.requestId);
    if (!entry || !ready || reply.request.generation !== entry.request.generation ||
        reply.request.locale !== entry.key.locale || reply.request.namespace !== entry.key.namespace) return;
    try {
      const wire = decodeCatalogResult(reply.result);
      if (wire?.status === 'patch' && !entry.request.known) throw new Error('Unexpected patch in a full catalog reply.');
      const result = wire?.status === 'patch' ? applyCatalogPatch(entry.baseline, wire) : wire;
      if (!result || (result.status !== 'failed' && (!result.key || id(result.key) !== id(entry.key) || !matches(manifest, result))))
        throw new CatalogLoadError('STALE_CATALOG', 'Catalog reply does not match the current pair stamp.');
      if (result.status === 'failed') { entry.cleanup(); entry.resolve(result); return; }
      const accepted = immutable(result);
      cache.set(id(accepted.key), accepted);
      sendScope();
      entry.cleanup();
      entry.resolve(accepted);
    } catch (error) {
      if (reply.result?.status === 'patch' && entry.request.known) {
        // One full retry, within the original timeout; superseded delta replies are ignored.
        pending.delete(entry.request.requestId);
        const { known: _known, ...request } = entry.request;
        entry.request = { ...request, requestId: `${identity}:${++sequence}` };
        pending.set(entry.request.requestId, entry);
        send(entry);
      } else { entry.cleanup(); entry.reject(error); }
    }
  };
  const receiveDiagnostic = (diagnostic: LiveDiagnostic) => {
    if (!diagnostic.request || sync?.acceptsRequest(diagnostic.request)) notify(diagnostic);
  };
  const disconnect = () => { ready = false; generation++; sync?.disconnect(); resume(); };
  const reconnect = () => {
    try { sendScope(); sync?.reconnect(); }
    catch (error) { report(error); }
  };
  function start() {
    if (sync || disposed) return;
    sync = new EagerSync({ timeoutMs,
      ...(options.runtime ? { runtime: options.runtime } : {}),
      onState: observeState,
      scope: () => ({ locale: manifest.baseLocale, namespaces: [] }),
      send: request => hot!.send(MANIFEST_REQUEST_EVENT, request),
      report: (error, operation = 'handshake') => { if (operation === 'handshake') failPending(error); report(error, operation); },
      commit: envelope => {
        try {
          const next = validateCatalogManifest((envelope as EagerCatalogEvent & { manifest: CatalogManifest }).manifest);
          if (next.baseLocale !== manifest.baseLocale) throw new Error('Source baseLocale changed.');
          const push = (envelope as EagerCatalogEvent & { push?: CatalogPush }).push;
          const replacements = new Map<string, CatalogOutcome>();
          if (push) {
            if (!Array.isArray(push.outcomes)) throw new Error('Invalid catalog push outcomes.');
            for (const wire of push.outcomes) {
              const decoded = decodeCatalogResult(wire);
              if (!decoded || decoded.status === 'failed') throw new Error('Failed catalog push.');
              const key = id(decoded.key), baseline = cache.get(key);
              if (!baseline) continue; // Another source on the shared socket owns this pair.
              if (replacements.has(key)) throw new Error('Duplicate catalog push outcome.');
              const result = decoded.status === 'patch' ? applyCatalogPatch(baseline.status === 'present' ? baseline : undefined, decoded) : decoded;
              if (!matches(next, result)) throw new CatalogLoadError('STALE_CATALOG', 'Pushed catalog does not match its manifest.');
              replacements.set(key, immutable(result));
            }
          }
          const changed = JSON.stringify(next) !== JSON.stringify(manifest);
          const wasReady = ready;
          manifest = next;
          ready = true;
          for (const [key, result] of replacements) cache.set(key, result);
          // Keep one stale present baseline per available pair for request-scoped deltas.
          const metadata = catalogMetadata(manifest);
          for (const [key, result] of cache) if (result.sessionId !== manifest.sessionId ||
              (metadata.get(key)?.status !== 'present' && (!options.push || result.status === 'present')) ||
              (options.push && (!manifest.availableNamespaces.includes(result.key.namespace) || !manifest.availableLocales.includes(result.key.locale)))) cache.delete(key);
          for (const entry of [...pending.values()]) {
            const accepted = cache.get(id(entry.key));
            if (accepted && matches(manifest, accepted)) { entry.cleanup(); entry.resolve(accepted); }
          }
          if (changed) for (const listener of [...listeners]) {
            if (disposed || !listeners.has(listener)) continue;
            try { listener(); }
            catch (error) { report(error, 'observer'); }
          }
          if (!wasReady && !disposed) resume();
          return true;
        } catch (error) { report(error); return false; }
      },
    });
    hot!.on(MANIFEST_EVENT, receiveManifest);
    hot!.on(CATALOG_EVENT, receiveCatalog);
    if (options.push) hot!.on(CATALOG_PUSH_EVENT, receivePush);
    hot!.on(DIAGNOSTIC_EVENT, receiveDiagnostic);
    hot!.on('vite:ws:disconnect', disconnect);
    hot!.on('vite:ws:connect', reconnect);
    try { sendScope(); sync.start(); } catch (error) { stop(); throw error; }
  }
  function stop() {
    try { sendScope(true); } catch { /* Vite owns the socket; stopping never waits for it. */ }
    if (sync) sync.stop();
    else observeState(Object.freeze({ status: 'stopped', attempt: 0, maxAttempts: 3 }));
    sync = undefined; ready = false; generation++;
    hot!.off(MANIFEST_EVENT, receiveManifest);
    hot!.off(CATALOG_EVENT, receiveCatalog);
    hot!.off(CATALOG_PUSH_EVENT, receivePush);
    hot!.off(DIAGNOSTIC_EVENT, receiveDiagnostic);
    hot!.off('vite:ws:disconnect', disconnect);
    hot!.off('vite:ws:connect', reconnect);
  }
  function maybeStop() { if (!refs && !pending.size) stop(); }
  const source: DevCatalogSource = Object.freeze({
    readManifest: () => manifest,
    getCatalogs: () => Object.freeze([...cache.values()].flatMap(o => o.status === 'present' && matches(manifest, o) ? [o.catalog] : [])),
    subscribeManifest(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    subscribeDiagnostic(listener: (diagnostic: LiveDiagnostic) => void) { diagnostics.add(listener); return () => { diagnostics.delete(listener); }; },
    getSyncState: () => syncState,
    subscribeSyncState(listener: (state: DevSyncState) => void) {
      if (disposed) return () => {};
      syncListeners.add(listener); return () => { syncListeners.delete(listener); };
    },
    connect() {
      if (disposed) throw new Error('Catalog source is disposed.');
      refs++;
      try { start(); } catch (error) { refs--; throw error; }
      let connected = true;
      return () => { if (!connected) return; connected = false; refs--; maybeStop(); };
    },
    loadCatalog(locale: string, namespace: string, signal?: AbortSignal) {
      if (disposed || signal?.aborted) return Promise.reject(new CatalogLoadError('ABORTED', 'Catalog request is no longer active.'));
      const key = { locale, namespace };
      const cached = cache.get(id(key));
      if (cached && matches(manifest, cached)) return Promise.resolve(cached);
      return new Promise<CatalogLoadResult>((resolve, reject) => {
        const baseline = cached?.status === 'present' ? cached : undefined;
        const request = { locale, namespace, generation, requestId: `${identity}:${++sequence}`,
          ...(baseline ? { known: { sessionId: baseline.sessionId, catalogVersion: baseline.catalogVersion } } : {}) };
        const abort = () => { entry.cleanup(); reject(new CatalogLoadError('ABORTED', 'Catalog request was cancelled.')); };
        const cancelTimer = (options.runtime?.schedule ?? schedule)(timeoutMs, () => { entry.cleanup(); reject(new CatalogLoadError('TIMEOUT', 'Catalog reply timed out.')); });
        const entry: Pending = { request, key, baseline, resolve, reject, cleanup: () => {
          cancelTimer(); signal?.removeEventListener('abort', abort); pending.delete(entry.request.requestId); maybeStop();
        } };
        pending.set(request.requestId, entry);
        signal?.addEventListener('abort', abort, { once: true });
        const alreadyStarted = sync !== undefined;
        try { start(); if (alreadyStarted && ready) send(entry); }
        catch (error) { entry.cleanup(); reject(error); }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      failPending(new CatalogLoadError('DISPOSED', 'Catalog source is disposed.'));
      stop(); cache.clear(); listeners.clear(); diagnostics.clear(); syncListeners.clear();
    },
  });
  hot.dispose(source.dispose);
  hot.prune(source.dispose);
  return source;
}
