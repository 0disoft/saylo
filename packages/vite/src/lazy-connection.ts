import type { I18n, ParsedCatalog, Schema } from '@saylo/core';
import type { DevCatalogSource } from './catalog-source.js';
import type { LiveDiagnostic } from './types.js';

export interface ConnectLazyDevOptions {
  readonly catalogSource: DevCatalogSource;
  readonly onUpdate?: (catalogs: readonly ParsedCatalog[]) => void;
  readonly onDiagnostic?: (diagnostic: LiveDiagnostic) => void;
}
const bindings = new WeakMap<object, () => void>();

export function connectLazyDev<S extends Schema>(instance: I18n<S>, options: ConnectLazyDevOptions): () => void {
  const existing = bindings.get(instance);
  if (existing) return existing;
  const source = options.catalogSource;
  const cleanups: Array<() => void> = [];
  const report = (error: unknown) => options.onDiagnostic?.({ message: error instanceof Error ? error.message : String(error), diagnostics: [] });
  const update = () => options.onUpdate?.(source.getCatalogs());
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
    cleanups.push(source.connect());
    update();
  } catch (error) { stop(); throw error; }
  return stop;
}
