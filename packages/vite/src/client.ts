import type { ParsedCatalog, Schema, Store } from '@saylo/core';
import { DIAGNOSTIC_EVENT, REQUEST_EVENT, SNAPSHOT_EVENT } from './types.js';
import type { EagerCatalogSnapshot, LiveDiagnostic } from './types.js';

type HotContext = NonNullable<ImportMeta['hot']>;
export interface ConnectDevOptions {
  readonly hot?: HotContext;
  readonly onUpdate?: (catalogs: readonly ParsedCatalog[]) => void;
  readonly onDiagnostic?: (diagnostic: LiveDiagnostic) => void;
}

/** Restore immutability of trusted plugin-produced AST data after JSON transport. */
export function freezeCatalogs(catalogs: readonly ParsedCatalog[]): readonly ParsedCatalog[] {
  function freeze(value: unknown) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  }
  freeze(catalogs);
  return catalogs;
}

const bindings = new WeakMap<object, () => void>();
const hotBindings = new WeakMap<HotContext, Set<() => void>>();
const noop = () => {};

export function connectDev<S extends Schema>(store: Store<S>, options: ConnectDevOptions = {}): () => void {
  const existing = bindings.get(store);
  if (existing) return existing;
  const hot = options.hot ?? import.meta.hot;
  if (!hot) return noop;
  let sessionId: string | undefined;
  let revision = -1;
  let unwatchDispose = noop;
  const report = (error: unknown) => options.onDiagnostic?.({ message: error instanceof Error ? error.message : String(error), diagnostics: [] });
  const receive = (payload: EagerCatalogSnapshot) => {
    if (bindings.get(store) !== stop) return;
    if (!payload || typeof payload.sessionId !== 'string' || !Number.isSafeInteger(payload.revision) || payload.revision < 0 || !Array.isArray(payload.catalogs)) {
      report(new Error('Invalid eager snapshot envelope.'));
      return;
    }
    if (payload.sessionId === sessionId && payload.revision <= revision) return;
    if (payload.baseLocale !== store.getSnapshot().baseLocale) { report(new Error('Plugin and store baseLocale differ.')); return; }
    try { store.replaceCatalogs(freezeCatalogs(payload.catalogs)); }
    catch (error) {
      report(error);
      // Subscriber errors happen after commit. Do not replay the committed revision.
      if (!(error instanceof AggregateError)) return;
    }
    sessionId = payload.sessionId;
    revision = payload.revision;
    if (bindings.get(store) !== stop) return;
    options.onUpdate?.(payload.catalogs);
  };
  const receiveDiagnostic = (diagnostic: LiveDiagnostic) => {
    if (bindings.get(store) === stop) options.onDiagnostic?.(diagnostic);
  };
  const stop = () => {
    if (bindings.get(store) !== stop) return;
    hot.off(SNAPSHOT_EVENT, receive);
    hot.off(DIAGNOSTIC_EVENT, receiveDiagnostic);
    bindings.delete(store);
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
  // Listener registration precedes the authoritative whole-registry request.
  try { unwatchDispose = store.onDispose(stop); hot.send(REQUEST_EVENT); }
  catch (error) { stop(); throw error; }
  return stop;
}

export type { EagerCatalogSnapshot, LiveDiagnostic } from './types.js';
