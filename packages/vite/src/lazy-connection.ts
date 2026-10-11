import type { I18n, ParsedCatalog, Schema } from '@0disoft/saylo-core';
import type { DevCatalogSource } from './catalog-source.js';
import type { LiveDiagnostic } from './types.js';
import type { DevSyncState } from './dev-sync.js';

export interface ConnectLazyDevOptions {
  readonly catalogSource: DevCatalogSource;
  readonly onUpdate?: (catalogs: readonly ParsedCatalog[]) => void;
  readonly onDiagnostic?: (diagnostic: LiveDiagnostic) => void;
  readonly onSyncState?: (state: DevSyncState) => void;
}
const bindings = new WeakMap<object, () => void>();

export function connectLazyDev<S extends Schema>(instance: I18n<S>, options: ConnectLazyDevOptions): () => void {
  const existing = bindings.get(instance);
  if (existing) return existing;
  const source = options.catalogSource;
  const cleanups: Array<() => void> = [];
  const report = (error: unknown, operation?: 'observer') => {
    if (bindings.get(instance) === stop) options.onDiagnostic?.({ message: error instanceof Error ? error.message : String(error), diagnostics: [], ...(operation ? { operation } : {}) });
  };
  const update = () => {
    if (bindings.get(instance) !== stop || !options.onUpdate) return;
    const catalogs = source.getCatalogs();
    try { options.onUpdate(catalogs); }
    catch (error) {
      // A passive view failure must not reject an already committed locale intent
      // or release the bridge during its first update. Diagnostic views are passive too.
      try { report(error, 'observer'); } catch { /* observers are passive */ }
    }
  };
  const observeState = (state: DevSyncState) => {
    if (bindings.get(instance) !== stop) return;
    try {
      const observation = Object.freeze({ status: state.status, attempt: state.attempt, maxAttempts: state.maxAttempts });
      options.onSyncState?.(observation);
    } catch (error) { try { report(error, 'observer'); } catch { /* observers are passive */ } }
  };
  const stop = () => {
    if (bindings.get(instance) !== stop) return;
    bindings.delete(instance);
    const errors: unknown[] = [];
    for (const cleanup of cleanups.reverse()) { try { cleanup(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Lazy bridge cleanup failed after releasing owned resources.');
  };
  bindings.set(instance, stop);
  try {
    cleanups.push(instance.onDispose(stop));
    cleanups.push(instance.subscribe(update));
    cleanups.push(source.subscribeManifest(() => { void instance.refresh().then(update).catch(report); }));
    cleanups.push(source.subscribeDiagnostic(d => options.onDiagnostic?.(d)));
    if (source.subscribeSyncState) cleanups.push(source.subscribeSyncState(observeState));
    const current = source.getSyncState?.();
    if (current) observeState(current);
    if (bindings.get(instance) !== stop) return stop;
    const release = source.connect();
    if (bindings.get(instance) !== stop) { release(); return stop; }
    cleanups.push(release);
    update();
  } catch (error) { stop(); throw error; }
  return stop;
}
