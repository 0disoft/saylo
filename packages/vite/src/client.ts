import type { I18n, ParsedCatalog, Schema, Store } from '@0disoft/saylo-core';
import { EagerSync } from './dev-sync.js';
import type { DevSyncState } from './dev-sync.js';
export type { DevSyncState } from './dev-sync.js';
export { createSupportReport, createSupportRecorder } from './support-report.js';
export type { SupportEnvironment, SupportDiagnostic, SupportEvent, SupportReport, SupportReportOptions, SupportRecorder } from './support-report.js';
import { DIAGNOSTIC_EVENT, REQUEST_EVENT, SNAPSHOT_EVENT } from './types.js';
import type { EagerCatalogEvent, LiveDiagnostic } from './types.js';
import { freezeCatalogs } from './freeze.js';
import { connectLazyDev } from './lazy-connection.js';
import { deliverDiagnostic } from './diagnostic-observers.js';
import type { ConnectLazyDevOptions } from './lazy-connection.js';
export { freezeCatalogs } from './freeze.js';
export { createDevCatalogSource } from './catalog-source.js';
export { createStaticCatalogSource } from './static-catalog-source.js';
export type { StaticCatalogLoader } from './static-catalog-source.js';
export type { DevCatalogSource, DevCatalogSourceOptions } from './catalog-source.js';
export type { ConnectLazyDevOptions } from './lazy-connection.js';

type HotContext = NonNullable<ImportMeta['hot']>;
export interface ConnectDevOptions {
  readonly hot?: HotContext;
  readonly onUpdate?: (catalogs: readonly ParsedCatalog[]) => void;
  readonly onDiagnostic?: (diagnostic: LiveDiagnostic) => void;
  readonly onSyncState?: (state: DevSyncState) => void;
  /** Timeout per snapshot attempt. At most three attempts; defaults to 5000ms. */
  readonly requestTimeoutMs?: number;
}

const bindings = new WeakMap<object, () => void>();
const hotBindings = new WeakMap<HotContext, Set<() => void>>();
const noop = () => {};

export function connectDev<S extends Schema>(store: Store<S>, options?: ConnectDevOptions): () => void;
export function connectDev<S extends Schema>(store: I18n<S>, options: ConnectLazyDevOptions): () => void;
export function connectDev<S extends Schema>(store: Store<S> | I18n<S>, options: ConnectDevOptions | ConnectLazyDevOptions = {}): () => void {
  if ('refresh' in store) {
    if (!('catalogSource' in options)) throw new Error('Lazy connectDev requires catalogSource.');
    return connectLazyDev(store, options);
  }
  const existing = bindings.get(store);
  if (existing) return existing;
  const eagerOptions = options as ConnectDevOptions;
  const hot = eagerOptions.hot ?? import.meta.hot;
  if (!hot) return noop;
  const timeoutMs = eagerOptions.requestTimeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new RangeError('requestTimeoutMs must be a positive timer duration.');
  let unwatchDispose = noop;
  const report = (error: unknown, operation: 'handshake' | 'observer' = 'handshake') => {
    if (bindings.get(store) === stop) deliverDiagnostic(options.onDiagnostic, { message: error instanceof Error ? error.message : String(error), diagnostics: [], operation });
  };
  const sync = new EagerSync({ timeoutMs,
    scope: () => ({ locale: store.getSnapshot().locale, namespaces: [...store.getSnapshot().loadedNamespaces] }),
    send: request => hot.send(REQUEST_EVENT, request), report,
    onState: state => { if (bindings.get(store) === stop) eagerOptions.onSyncState?.(state); },
    commit: payload => {
      if (bindings.get(store) !== stop) return false;
      if (payload.baseLocale !== store.getSnapshot().baseLocale) { report(new Error('Plugin and store baseLocale differ.')); return false; }
      try { store.replaceCatalogs(freezeCatalogs(payload.catalogs)); }
      catch (error) {
        report(error, error instanceof AggregateError ? 'observer' : 'handshake');
        // Subscriber errors happen after commit. Do not replay the committed revision.
        if (!(error instanceof AggregateError)) return false;
      }
      if (bindings.get(store) === stop) {
        try { options.onUpdate?.(payload.catalogs); } catch (error) { report(error, 'observer'); }
      }
      return true;
    },
  });
  const receive = (payload: EagerCatalogEvent) => sync.receive(payload);
  const disconnect = () => sync.disconnect();
  const reconnect = () => sync.reconnect();
  const receiveDiagnostic = (diagnostic: LiveDiagnostic) => {
    if (bindings.get(store) === stop && (!diagnostic.request || sync.acceptsRequest(diagnostic.request))) deliverDiagnostic(options.onDiagnostic, diagnostic);
  };
  const stop = () => {
    if (bindings.get(store) !== stop) return;
    hot.off(SNAPSHOT_EVENT, receive);
    hot.off(DIAGNOSTIC_EVENT, receiveDiagnostic);
    hot.off('vite:ws:disconnect', disconnect);
    hot.off('vite:ws:connect', reconnect);
    bindings.delete(store);
    sync.stop();
    unwatchDispose();
    hotBindings.get(hot)?.delete(stop);
  };
  let live = hotBindings.get(hot);
  if (!live) {
    live = new Set();
    hotBindings.set(hot, live);
    const stopAll = () => { for (const stop of [...live!]) stop(); };
    hot.dispose(stopAll);
    hot.prune(stopAll);
  }
  bindings.set(store, stop);
  live.add(stop);
  hot.on(SNAPSHOT_EVENT, receive);
  hot.on(DIAGNOSTIC_EVENT, receiveDiagnostic);
  hot.on('vite:ws:disconnect', disconnect);
  hot.on('vite:ws:connect', reconnect);
  // Listener registration precedes the authoritative whole-registry request.
  try { unwatchDispose = store.onDispose(stop); sync.start(); }
  catch (error) { stop(); throw error; }
  return stop;
}

export type { EagerCatalogSnapshot, EagerCatalogUpdate, EagerCatalogEvent, EagerSnapshotRequest, LiveDiagnostic } from './types.js';
